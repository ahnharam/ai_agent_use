import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import {
    CodexTurnResult,
    probeCodexExecutable,
    resolveCodexExecutable,
} from './codexAppServerClient';
import {
    CodexRuntimeAdapter,
    canRunWithSdk,
    createRuntimeAdapter,
    isSdkRuntimeAvailable,
    resolveSelectedRuntime,
} from './runtimeAdapter';
import {
    CodexContextMode,
    CodexRuntime,
    CodexWorkflowRole,
    CodexWorkflowStore,
    CODEX_WORKFLOW_ROLES,
    WorkflowRun,
    ApprovalRequest,
    WorkflowRunKind,
    AgentRequest,
    slugify,
} from './store';

export interface CodexWorkflowSnapshot {
    run: WorkflowRun | null;
    running: boolean;
    executable: string;
    executableOk: boolean;
    executableMessage: string;
}

export interface CodexWorkflowEvent {
    type: 'state' | 'log';
    message?: string;
    run?: WorkflowRun | null;
}

export interface CodexWorkflowControllerOptions {
    extensionPath: string;
    workspaceRoot: string;
    codexExecutablePath?: string;
    defaultContextMode?: CodexContextMode;
    runtime?: CodexRuntime;
    maxRepairLoops?: number;
    alwaysUseWorktree?: boolean;
    onUpdate?: (event: CodexWorkflowEvent) => void;
}

export interface CodexWorkflowStartOptions {
    source?: string;
    priority?: number;
    runtime?: CodexRuntime;
    runKind?: WorkflowRunKind;
    approvalPolicy?: string;
    mcpSource?: string;
}

type SandboxKind = 'readOnly' | 'workspaceWrite';

const ROLE_FILE: Record<CodexWorkflowRole, string> = {
    'docs-agent': 'docs-agent.toml',
    'web-researcher': 'web-researcher.toml',
    'git-manager': 'git-manager.toml',
    designer: 'designer.toml',
    'frontend-coder': 'frontend-coder.toml',
    'backend-coder': 'backend-coder.toml',
    'qa-agent': 'qa-agent.toml',
    'doc-writer': 'doc-writer.toml',
};

export class CodexWorkflowController {
    private runtime: CodexRuntimeAdapter | null = null;
    private currentRun: WorkflowRun | null = null;
    private running = false;
    private cancelled = false;
    private executableProbe: { ok: boolean; executable: string; message: string; version?: string } = { ok: false, executable: 'codex', message: 'Not checked yet.' };
    private codexModel: string | undefined;

    constructor(private readonly options: CodexWorkflowControllerOptions) {}

    public attachRun(run: WorkflowRun): void {
        this.currentRun = run;
    }

    public getState(): CodexWorkflowSnapshot {
        const cwd = this.getWorkspaceRoot();
        const executable = resolveCodexExecutable(this.options.codexExecutablePath);
        if (!this.currentRun && cwd) {
            this.currentRun = new CodexWorkflowStore(cwd).latestRun();
        }
        return {
            run: this.currentRun,
            running: this.running,
            executable,
            executableOk: this.executableProbe.ok,
            executableMessage: this.executableProbe.message,
        };
    }

    public async start(userPrompt: string, mode?: CodexContextMode, options: CodexWorkflowStartOptions = {}): Promise<WorkflowRun> {
        const { store, run } = this.createRun(userPrompt, mode, options);
        await this.executeRun(store, run);
        return run;
    }

    public startDetached(userPrompt: string, mode?: CodexContextMode, options: CodexWorkflowStartOptions = {}): WorkflowRun {
        const { store, run } = this.createRun(userPrompt, mode, options);
        void this.executeRun(store, run);
        return run;
    }

    private createRun(userPrompt: string, mode?: CodexContextMode, options: CodexWorkflowStartOptions = {}): { store: CodexWorkflowStore; run: WorkflowRun } {
        const prompt = userPrompt.trim();
        if (!prompt) throw new Error('Codex Workflow prompt is empty.');
        const cwd = this.requireWorkspaceRoot();
        const contextMode = mode || this.options.defaultContextMode || 'fresh';
        const maxRepairLoops = Math.max(0, this.options.maxRepairLoops ?? 2);
        const store = new CodexWorkflowStore(cwd);
        const runKind = options.runKind || inferRunKind(prompt);
        const requestedRuntime = options.runtime || this.options.runtime || 'auto';
        let selectedRuntime = resolveSelectedRuntime(requestedRuntime, runKind);
        if (selectedRuntime === 'sdk' && (!canRunWithSdk(runKind) || !isSdkRuntimeAvailable())) {
            selectedRuntime = 'app-server';
        }
        const run = store.createRun(prompt, contextMode, maxRepairLoops, {
            ...options,
            runtime: requestedRuntime,
            selectedRuntime,
            runKind,
        });
        store.appendEvent(run, 'runtime.selected', { requestedRuntime, selectedRuntime, runKind });
        return { store, run };
    }

    public async resumeLatest(mode: CodexContextMode = 'resume'): Promise<void> {
        const cwd = this.requireWorkspaceRoot();
        const store = new CodexWorkflowStore(cwd);
        const latest = store.latestRun();
        if (!latest) throw new Error('No Codex Workflow run exists to resume.');
        await this.resumeExistingRun(store, latest, mode);
    }

    public async resumeRun(runId: string, mode: CodexContextMode = 'resume'): Promise<void> {
        const cwd = this.requireWorkspaceRoot();
        const store = new CodexWorkflowStore(cwd);
        const run = store.readRun(runId);
        if (!run) throw new Error(`No Codex Workflow run exists: ${runId}`);
        await this.resumeExistingRun(store, run, mode);
    }

    private async resumeExistingRun(store: CodexWorkflowStore, run: WorkflowRun, mode: CodexContextMode): Promise<void> {
        const latest = run;
        latest.contextMode = mode;
        if (latest.status === 'pendingCommitApproval' || latest.status === 'pendingPushApproval') {
            this.currentRun = store.saveRun(latest);
            this.emitState();
            return;
        }
        await this.executeRun(store, latest);
    }

    public async cancel(): Promise<void> {
        this.cancelled = true;
        if (this.currentRun) {
            const store = new CodexWorkflowStore(this.currentRun.cwd);
            this.currentRun.status = 'cancelled';
            store.saveRun(this.currentRun);
        }
        await this.runtime?.stop();
        this.runtime = null;
        this.running = false;
        this.emitState('Codex Workflow cancelled.');
    }

    public async compactAgent(role: string): Promise<void> {
        const run = this.currentRun;
        if (!run) throw new Error('No active Codex Workflow run.');
        const agent = run.agents[role];
        if (!agent?.threadId) throw new Error(`No thread id for ${role}.`);
        const runtime = await this.ensureRuntime(run, run.cwd);
        await runtime.compactThread(agent.threadId);
        agent.lastSummary = `${role} compaction requested at ${new Date().toISOString()}`;
        new CodexWorkflowStore(run.cwd).saveRun(run);
        this.emitState(`${role} context compaction requested.`);
    }

    public resetAgent(role: string): void {
        const run = this.currentRun;
        if (!run) throw new Error('No active Codex Workflow run.');
        if (!run.agents[role]) throw new Error(`Unknown agent: ${role}`);
        run.agents[role] = { role, status: 'reset', lastSummary: 'Thread id cleared. Next turn will start fresh.' };
        new CodexWorkflowStore(run.cwd).saveRun(run);
        this.emitState(`${role} reset.`);
    }

    public async approveCommit(): Promise<void> {
        const run = this.currentRun;
        if (!run) throw new Error('No active Codex Workflow run.');
        if (run.status !== 'pendingCommitApproval') throw new Error('No commit is waiting for approval.');
        const store = new CodexWorkflowStore(run.cwd);
        try {
            const approval = pendingApproval(run, 'commit');
            const conflicts = gitConflictFiles(run.git.workCwd);
            if (conflicts.length > 0) {
                this.blockApproval(store, run, 'commit', `Commit blocked because unresolved conflict files exist:\n${conflicts.join('\n')}`);
                return;
            }
            if (approval?.validationHash && approval.validationHash !== gitDiffHash(run.git.workCwd)) {
                this.blockApproval(store, run, 'commit', 'Git diff changed after commit approval was requested. Start or refresh the gitOperation run and review the latest diff.');
                return;
            }
            const files = gitLines(['status', '--short'], run.git.workCwd);
            if (files.length === 0) {
                run.approvals.commitRequired = false;
                run.status = 'completed';
                run.artifacts.finalSummary = 'No file changes to commit.';
                store.saveRun(run);
                this.emitState('No changes to commit.');
                return;
            }
            git(['add', '.'], run.git.workCwd, 60000);
            const msg = `codex workflow: ${slugify(run.userPrompt)}`;
            git(['commit', '-m', msg], run.git.workCwd, 60000);
            run.git.commitHash = git(['rev-parse', '--short', 'HEAD'], run.git.workCwd).trim();
            run.git.changedFiles = gitLines(['status', '--short'], run.git.workCwd);
            run.git.dirty = run.git.changedFiles.length > 0;
            run.git.conflictFiles = [];
            run.approvals.commitApproved = true;
            resolveApproval(run, 'commit', 'approved');
            run.approvals.pushRequired = hasRemote(run.git.workCwd);
            if (run.approvals.pushRequired) {
                upsertApproval(run, {
                    id: `${run.id}:push`,
                    runId: run.id,
                    type: 'push',
                    status: 'pending',
                    summary: `Push branch ${run.git.branch || 'current'} to origin.`,
                    validationHash: run.git.commitHash,
                    createdAt: new Date().toISOString(),
                });
            }
            run.status = run.approvals.pushRequired ? 'pendingPushApproval' : 'completed';
            store.saveRun(run);
            this.emitState(run.approvals.pushRequired ? 'Commit created. Push approval is required.' : 'Commit created.');
        } catch (e: any) {
            run.status = 'failed';
            run.git.lastError = e?.message || String(e);
            store.saveRun(run);
            this.emitState(`Commit failed: ${run.git.lastError}`);
            throw e;
        }
    }

    public async approvePush(): Promise<void> {
        const run = this.currentRun;
        if (!run) throw new Error('No active Codex Workflow run.');
        if (run.status !== 'pendingPushApproval') throw new Error('No push is waiting for approval.');
        const store = new CodexWorkflowStore(run.cwd);
        try {
            const approval = pendingApproval(run, 'push');
            if (approval?.validationHash && approval.validationHash !== run.git.commitHash) {
                this.blockApproval(store, run, 'push', 'Commit hash changed after push approval was requested. Start or refresh the gitOperation run and review the latest commit.');
                return;
            }
            const branch = run.git.branch || git(['rev-parse', '--abbrev-ref', 'HEAD'], run.git.workCwd).trim();
            resolveApproval(run, 'push', 'approved');
            run.git.pushRemote = 'origin';
            run.git.pushBranch = branch;
            run.status = 'running';
            store.saveRun(run);
            this.emitState(`Push started for origin/${branch}.`);
            void this.executeApprovedPush(store, run, branch);
        } catch (e: any) {
            run.status = 'failed';
            run.git.lastError = e?.message || String(e);
            store.saveRun(run);
            this.emitState(`Push failed: ${run.git.lastError}`);
            throw e;
        }
    }

    private blockApproval(store: CodexWorkflowStore, run: WorkflowRun, type: ApprovalRequest['type'], reason: string): void {
        const approval = pendingApproval(run, type);
        if (approval) {
            approval.status = 'blocked';
            approval.resolutionReason = reason;
            approval.resolvedAt = new Date().toISOString();
        }
        run.status = 'blocked';
        run.git.lastError = reason;
        run.artifacts.finalSummary = reason;
        store.appendEvent(run, `approval.${type}.blocked`, { reason });
        store.saveRun(run);
        this.emitState(reason);
    }

    private async executeApprovedPush(store: CodexWorkflowStore, run: WorkflowRun, branch: string): Promise<void> {
        try {
            store.appendEvent(run, 'git.push.started', { branch, remote: 'origin' });
            await gitAsync(['push', '-u', 'origin', branch], run.git.workCwd, 10 * 60 * 1000, message => {
                const trimmed = message.trim();
                if (trimmed) this.emitLog(`[git push] ${trimmed}`);
            });
            run.approvals.pushApproved = true;
            run.git.commitHash = git(['rev-parse', '--short', 'HEAD'], run.git.workCwd).trim();
            run.git.pushRemote = 'origin';
            run.git.pushBranch = branch;
            run.status = 'completed';
            run.artifacts.finalSummary = `Pushed origin/${branch} at ${run.git.commitHash}.`;
            store.appendEvent(run, 'git.push.completed', { branch, commitHash: run.git.commitHash });
            store.saveRun(run);
            this.emitState(`Pushed origin/${branch}.`);
        } catch (e: any) {
            const message = e?.message || String(e);
            run.status = 'failed';
            run.git.lastError = /non-fast-forward|fetch first|rejected/i.test(message)
                ? `Push rejected because the remote branch changed or is ahead. Fetch/rebase or merge, then start a new gitOperation run.\n${message}`
                : message;
            run.artifacts.finalSummary = run.git.lastError;
            store.appendEvent(run, 'git.push.failed', { branch, error: run.git.lastError });
            store.saveRun(run);
            this.emitState(`Push failed: ${run.git.lastError}`);
        }
    }

    public async requestMergeBackApproval(): Promise<void> {
        const run = this.currentRun;
        if (!run) throw new Error('No active Codex Workflow run.');
        if (!run.git.isRepo || !run.git.branch) throw new Error('No workflow branch is available to merge.');
        const store = new CodexWorkflowStore(run.cwd);
        run.git.mergeStatus = 'pendingApproval';
        upsertApproval(run, {
            id: `${run.id}:merge-back`,
            runId: run.id,
            type: 'merge-back',
            status: 'pending',
            summary: `Merge ${run.git.branch} back into ${run.git.originalBranch || 'the original branch'}.`,
            validationHash: run.git.commitHash || gitSafe(['rev-parse', '--short', run.git.branch], run.git.workCwd)?.trim(),
            createdAt: new Date().toISOString(),
        });
        store.saveRun(run);
        this.emitState('Merge-back approval is required.');
    }

    public async mergeBack(): Promise<void> {
        const run = this.currentRun;
        if (!run) throw new Error('No active Codex Workflow run.');
        if (!run.git.isRepo || !run.git.branch || !run.git.originalBranch) throw new Error('No merge-back target is available.');
        const store = new CodexWorkflowStore(run.cwd);
        try {
            const approval = pendingApproval(run, 'merge-back');
            const currentHash = gitSafe(['rev-parse', '--short', run.git.branch], run.git.workCwd)?.trim();
            if (approval?.validationHash && currentHash && approval.validationHash !== currentHash) {
                throw new Error('Branch hash changed after merge-back approval was requested.');
            }
            const originalStatus = gitLines(['status', '--porcelain'], run.git.originalCwd || run.cwd);
            if (originalStatus.length > 0) throw new Error('Original working tree is dirty. Merge-back is blocked.');
            git(['switch', run.git.originalBranch], run.git.originalCwd || run.cwd, 60000);
            git(['merge', '--no-ff', run.git.branch, '-m', `merge codex workflow: ${slugify(run.userPrompt)}`], run.git.originalCwd || run.cwd, 120000);
            run.git.mergeStatus = 'merged';
            resolveApproval(run, 'merge-back', 'approved');
            store.saveRun(run);
            this.emitState(`Merged ${run.git.branch} into ${run.git.originalBranch}.`);
        } catch (e: any) {
            run.git.mergeStatus = /conflict/i.test(e?.message || '') ? 'conflict' : 'failed';
            run.git.lastError = e?.message || String(e);
            store.saveRun(run);
            this.emitState(`Merge-back failed: ${run.git.lastError}`);
            throw e;
        }
    }

    public cleanupWorktree(): void {
        const run = this.currentRun;
        if (!run) throw new Error('No active Codex Workflow run.');
        if (!run.git.worktreePath) throw new Error('No workflow worktree exists for this run.');
        git(['worktree', 'remove', run.git.worktreePath], run.git.originalCwd || run.cwd, 120000);
        run.git.mergeStatus = 'cleaned';
        new CodexWorkflowStore(run.cwd).saveRun(run);
        this.emitState('Workflow worktree removed.');
    }

    private async executeRun(store: CodexWorkflowStore, run: WorkflowRun): Promise<void> {
        if (this.running) throw new Error('A Codex Workflow run is already in progress.');
        this.running = true;
        this.cancelled = false;
        this.currentRun = run;
        run.status = 'running';
        store.saveRun(run);
        store.appendEvent(run, 'run.started', { runtime: run.selectedRuntime, runKind: run.runKind });
        this.emitState('Codex Workflow started.');

        try {
            if (run.runKind === 'gitOperation') {
                await this.executeGitOperation(store, run);
                return;
            }
            const runtime = await this.ensureRuntime(run, run.cwd);
            await this.checkAuth(runtime, store, run);
            if (run.selectedRuntime === 'sdk' && canRunWithSdk(run.runKind)) {
                await this.executeSdkRun(store, run);
                return;
            }
            const readOnly = shouldSkipImplementation(run.userPrompt);

            const docs = await this.runStage(store, run, 'docs', 'docs-agent', 'readOnly', this.docsPrompt(run));
            run.artifacts.docsSummary = summarize(docs.text);
            store.saveRun(run);
            await this.processAgentRequests(store, run, 'docs', 'docs-agent', docs);

            const needsResearch = shouldRunWebResearch(run.userPrompt);
            if (needsResearch) {
                const research = await this.runStage(store, run, 'web-research', 'web-researcher', 'readOnly', this.webResearchPrompt(run));
                run.artifacts.webResearchSummary = summarize(research.text, 5000);
                store.saveRun(run);
                await this.processAgentRequests(store, run, 'web-research', 'web-researcher', research);
            }

            if (readOnly) {
                run.artifacts.assignedRoles = assignedRolesForRun(run, needsResearch, []);
                run.artifacts.finalSummary = [run.artifacts.docsSummary, run.artifacts.webResearchSummary].filter(Boolean).join('\n\n') || docs.text;
                run.status = 'completed';
                store.saveRun(run);
                this.emitState('Read-only request completed; coding/git stages skipped.');
                return;
            }

            this.prepareGit(store, run);
            const gitPlan = await this.runStage(store, run, 'git-plan', 'git-manager', 'readOnly', this.gitPlanPrompt(run));
            run.artifacts.gitPlan = summarize(gitPlan.text);
            store.saveRun(run);
            await this.processAgentRequests(store, run, 'git-plan', 'git-manager', gitPlan);

            const implementationRoles = selectImplementationRoles(run);
            run.artifacts.assignedRoles = assignedRolesForRun(run, needsResearch, implementationRoles);
            store.saveRun(run);

            const implementationSummaries: string[] = [];
            for (const role of implementationRoles) {
                const stageId = implementationStageId(role);
                const result = await this.runStage(store, run, stageId, role, 'workspaceWrite', this.implementationPrompt(run, role));
                const summary = summarize(result.text);
                setImplementationSummary(run, role, summary);
                implementationSummaries.push(`${role}: ${summary}`);
                if (result.diff) run.artifacts.lastDiff = result.diff.slice(0, 20000);
                store.saveRun(run);
                const answers = await this.processAgentRequests(store, run, stageId, role, result);
                if (answers) {
                    const followup = await this.runStage(store, run, `${stageId}-agent-requests-followup`, role, 'workspaceWrite', this.agentRequestFollowupPrompt(run, role, answers));
                    const followupSummary = summarize(followup.text);
                    setImplementationSummary(run, role, followupSummary);
                    implementationSummaries.push(`${role} follow-up: ${followupSummary}`);
                    if (followup.diff) run.artifacts.lastDiff = followup.diff.slice(0, 20000);
                    store.saveRun(run);
                }
            }
            run.artifacts.coderSummary = summarize(implementationSummaries.join('\n\n'), 6000);
            store.saveRun(run);

            let qa = await this.runStage(store, run, 'qa', 'qa-agent', 'workspaceWrite', this.qaPrompt(run));
            run.artifacts.qaSummary = summarize(qa.text);
            run.artifacts.qaEvidence = summarize(`${qa.text || ''}\n${qa.error || ''}`, 4000);
            store.saveRun(run);

            while (!qaPassed(qa) && run.repairAttempts < run.maxRepairLoops) {
                this.assertNotCancelled();
                run.repairAttempts += 1;
                store.saveRun(run);
                const repairRoles = selectRepairRoles(run, qa, implementationRoles);
                const repairSummaries: string[] = [];
                for (const role of repairRoles) {
                    const repair = await this.runStage(store, run, `${implementationStageId(role)}-repair-${run.repairAttempts}`, role, 'workspaceWrite', this.repairPrompt(run, role, qa));
                    const repairSummary = summarize(repair.text);
                    setImplementationSummary(run, role, repairSummary);
                    repairSummaries.push(`${role}: ${repairSummary}`);
                    if (repair.diff) run.artifacts.lastDiff = repair.diff.slice(0, 20000);
                    store.saveRun(run);
                }
                run.artifacts.coderSummary = summarize(repairSummaries.join('\n\n') || run.artifacts.coderSummary || '', 6000);
                qa = await this.runStage(store, run, `qa-retry-${run.repairAttempts}`, 'qa-agent', 'workspaceWrite', this.qaPrompt(run));
                run.artifacts.qaSummary = summarize(qa.text);
                run.artifacts.qaEvidence = summarize(`${qa.text || ''}\n${qa.error || ''}`, 4000);
                store.saveRun(run);
            }

            if (!qaPassed(qa)) {
                run.status = 'failed';
                run.artifacts.finalSummary = `QA failed after ${run.repairAttempts} repair attempt(s).`;
                store.saveRun(run);
                this.emitState(run.artifacts.finalSummary);
                return;
            }

            const doc = await this.runStage(store, run, 'doc-summary', 'doc-writer', 'readOnly', this.docPrompt(run));
            run.artifacts.docSummary = summarize(doc.text, 6000);
            run.artifacts.finalSummary = run.artifacts.docSummary || run.artifacts.qaSummary || run.artifacts.coderSummary;
            store.saveRun(run);

            const changedFiles = gitLines(['status', '--short'], run.git.workCwd);
            run.git.changedFiles = changedFiles;
            if (run.git.isRepo && changedFiles.length > 0) {
                const diffHash = gitDiffHash(run.git.workCwd);
                run.git.diffHash = diffHash;
                run.approvals.commitRequired = true;
                upsertApproval(run, {
                    id: `${run.id}:commit`,
                    runId: run.id,
                    type: 'commit',
                    status: 'pending',
                    summary: `Commit ${changedFiles.length} changed file(s) for this workflow run.`,
                    diff: run.artifacts.lastDiff,
                    validationHash: diffHash,
                    createdAt: new Date().toISOString(),
                });
                run.status = 'pendingCommitApproval';
                store.saveRun(run);
                this.emitState('Workflow passed QA. Commit approval is required.');
            } else {
                run.status = 'completed';
                store.saveRun(run);
                this.emitState('Workflow completed with no git commit required.');
            }
        } catch (e: any) {
            if (this.cancelled) {
                run.status = 'cancelled';
            } else {
                run.status = 'blocked';
                run.artifacts.finalSummary = e?.message || String(e);
            }
            store.saveRun(run);
            this.emitState(run.artifacts.finalSummary || 'Codex Workflow blocked.');
        } finally {
            this.running = false;
            this.emitState();
        }
    }

    private async executeGitOperation(store: CodexWorkflowStore, run: WorkflowRun): Promise<void> {
        store.upsertStage(run, {
            id: 'git-inspect',
            role: 'git-manager',
            status: 'running',
            startedAt: new Date().toISOString(),
            inputSummary: run.userPrompt.slice(0, 300),
        });
        store.saveRun(run);
        store.appendEvent(run, 'gitOperation.started', { cwd: run.cwd });

        const root = gitSafe(['rev-parse', '--show-toplevel'], run.cwd)?.trim();
        if (!root) {
            run.git.isRepo = false;
            run.status = 'blocked';
            run.artifacts.finalSummary = 'Git operation blocked: cwd is not inside a git repository.';
            store.upsertStage(run, {
                id: 'git-inspect',
                role: 'git-manager',
                status: 'failed',
                error: run.artifacts.finalSummary,
                finishedAt: new Date().toISOString(),
            });
            store.saveRun(run);
            this.emitState(run.artifacts.finalSummary);
            return;
        }

        const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
        if (!branch || branch === 'HEAD') throw new Error('Git operation blocked: detached HEAD is not supported.');
        const changedFiles = gitLines(['status', '--short'], root);
        const conflictFiles = gitConflictFiles(root);
        const remote = gitSafe(['remote', 'get-url', 'origin'], root)?.trim();
        const tracking = gitSafe(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root)?.trim()
            || (gitSafe(['rev-parse', '--verify', `origin/${branch}`], root) ? `origin/${branch}` : '');
        const counts = tracking ? parseAheadBehind(gitSafe(['rev-list', '--left-right', '--count', `HEAD...${tracking}`], root)) : { ahead: 0, behind: 0 };
        const head = git(['rev-parse', '--short', 'HEAD'], root).trim();

        run.git.isRepo = true;
        run.git.originalCwd = root;
        run.git.workCwd = root;
        run.git.originalBranch = branch;
        run.git.branch = branch;
        run.git.dirty = changedFiles.length > 0;
        run.git.changedFiles = changedFiles;
        run.git.conflictFiles = conflictFiles;
        run.git.commitHash = head;
        run.git.pushRemote = remote ? 'origin' : undefined;
        run.git.pushBranch = branch;

        const summary = [
            `Git operation inspected ${root}.`,
            `Branch: ${branch}`,
            `HEAD: ${head}`,
            tracking ? `Tracking: ${tracking} (ahead ${counts.ahead}, behind ${counts.behind})` : 'Tracking: none',
            `Changed files: ${changedFiles.length}`,
            conflictFiles.length > 0 ? `Conflict files: ${conflictFiles.length}` : '',
        ].filter(Boolean).join('\n');
        store.upsertStage(run, {
            id: 'git-inspect',
            role: 'git-manager',
            status: 'completed',
            outputSummary: summary,
            finishedAt: new Date().toISOString(),
        });
        store.appendEvent(run, 'gitOperation.inspected', {
            root,
            branch,
            head,
            tracking,
            ahead: counts.ahead,
            behind: counts.behind,
            changedFiles: changedFiles.length,
            conflictFiles: conflictFiles.length,
        });

        if (conflictFiles.length > 0) {
            run.status = 'blocked';
            run.git.lastError = `Git operation blocked because unresolved conflict files exist:\n${conflictFiles.join('\n')}`;
            run.artifacts.gitPlan = summary;
            run.artifacts.finalSummary = run.git.lastError;
            store.saveRun(run);
            this.emitState(run.git.lastError);
            return;
        }

        if (changedFiles.length > 0) {
            const diffHash = gitDiffHash(root);
            run.git.diffHash = diffHash;
            run.approvals.commitRequired = true;
            upsertApproval(run, {
                id: `${run.id}:commit`,
                runId: run.id,
                type: 'commit',
                status: 'pending',
                summary: `Commit ${changedFiles.length} changed file(s) on ${branch}.`,
                diff: gitOperationDiff(root),
                validationHash: diffHash,
                createdAt: new Date().toISOString(),
            });
            run.status = 'pendingCommitApproval';
            run.artifacts.gitPlan = `${summary}\n\nCommit approval is required before Workflow App can create a commit.`;
            run.artifacts.finalSummary = run.artifacts.gitPlan;
            store.saveRun(run);
            this.emitState('Git operation is waiting for commit approval.');
            return;
        }

        if (remote && counts.ahead > 0) {
            run.approvals.pushRequired = true;
            upsertApproval(run, {
                id: `${run.id}:push`,
                runId: run.id,
                type: 'push',
                status: 'pending',
                summary: `Push ${counts.ahead} commit(s) from ${branch} to origin.`,
                validationHash: head,
                createdAt: new Date().toISOString(),
            });
            run.status = 'pendingPushApproval';
            run.artifacts.gitPlan = `${summary}\n\nPush approval is required before Workflow App can push.`;
            run.artifacts.finalSummary = run.artifacts.gitPlan;
            store.saveRun(run);
            this.emitState('Git operation is waiting for push approval.');
            return;
        }

        run.status = 'completed';
        run.artifacts.finalSummary = `${summary}\n\nNo commit or push is required.`;
        store.saveRun(run);
        this.emitState('Git operation completed with no pending work.');
    }

    private async executeSdkRun(store: CodexWorkflowStore, run: WorkflowRun): Promise<void> {
        const sandbox: SandboxKind = run.runKind === 'readOnly' || shouldSkipImplementation(run.userPrompt) ? 'readOnly' : 'workspaceWrite';
        if (sandbox === 'workspaceWrite') this.prepareGit(store, run);
        const runtime = await this.ensureRuntime(run, run.git.workCwd || run.cwd);
        store.upsertStage(run, { id: 'sdk-run', role: 'sdk', status: 'running', startedAt: new Date().toISOString(), inputSummary: run.userPrompt.slice(0, 300) });
        const prompt = sandbox === 'readOnly'
            ? `Answer this Codex Workflow read-only request directly.\n\nUser request:\n${run.userPrompt}\n\nDo not edit files. Do not run shell commands unless the request cannot be answered without them. If the user asks for an exact phrase, return only that phrase.`
            : `Run this Codex Workflow automation task using the SDK runtime.\n\nUser request:\n${run.userPrompt}\n\nReturn a concise Korean summary of work, checks, and remaining risk.`;
        const result = await runtime.runStandalone!(prompt, {
            cwd: run.git.workCwd || run.cwd,
            approvalPolicy: run.approvalPolicy || 'never',
            sandbox,
        });
        const failed = result.status === 'failed' || !!result.error;
        store.upsertStage(run, {
            id: 'sdk-run',
            role: 'sdk',
            status: failed ? 'failed' : 'completed',
            outputSummary: summarize(result.text || result.error || '', 1200),
            error: result.error,
            finishedAt: new Date().toISOString(),
        });
        run.artifacts.finalSummary = summarize(result.text || result.error || '', 6000);
        if (result.diff) run.artifacts.lastDiff = result.diff;
        if (sandbox === 'workspaceWrite' && run.git.isRepo) {
            const changedFiles = gitLines(['status', '--short'], run.git.workCwd);
            run.git.changedFiles = changedFiles;
            if (!failed && changedFiles.length > 0) {
                const diffHash = gitDiffHash(run.git.workCwd);
                run.git.diffHash = diffHash;
                run.approvals.commitRequired = true;
                upsertApproval(run, {
                    id: `${run.id}:commit`,
                    runId: run.id,
                    type: 'commit',
                    status: 'pending',
                    summary: `Commit ${changedFiles.length} changed file(s) from SDK workflow run.`,
                    diff: gitSafe(['diff', '--stat'], run.git.workCwd) || result.diff,
                    validationHash: diffHash,
                    createdAt: new Date().toISOString(),
                });
                run.status = 'pendingCommitApproval';
                store.saveRun(run);
                this.emitState('SDK workflow completed with file changes. Commit approval is required.');
                return;
            }
        }
        run.status = failed ? 'failed' : 'completed';
        store.saveRun(run);
        this.emitState(failed ? 'SDK workflow failed.' : 'SDK workflow completed.');
    }

    private async ensureRuntime(run: WorkflowRun, cwd: string): Promise<CodexRuntimeAdapter> {
        if (this.runtime) return this.runtime;
        const executable = resolveCodexExecutable(this.options.codexExecutablePath);
        this.executableProbe = probeCodexExecutable(executable);
        if (!this.executableProbe.ok) {
            throw new Error(`Codex executable is not runnable: ${this.executableProbe.message}`);
        }
        const selectedRuntime = run.selectedRuntime || 'app-server';
        const runtime = createRuntimeAdapter(selectedRuntime, {
            executable,
            cwd,
            onEvent: msg => this.onCodexEvent(msg),
            onStderr: chunk => this.emitLog(chunk.trim()),
        });
        await runtime.start();
        try {
            const models = await runtime.modelList();
            const list = Array.isArray(models?.data) ? models.data : [];
            this.codexModel = list.find((m: any) => m.isDefault)?.id || list[0]?.id;
        } catch {
            this.codexModel = undefined;
        }
        run.selectedRuntime = selectedRuntime;
        run.runtimeVersion = runtime.version || this.executableProbe.version || selectedRuntime;
        new CodexWorkflowStore(run.cwd).saveRun(run);
        this.runtime = runtime;
        return runtime;
    }

    private async checkAuth(runtime: CodexRuntimeAdapter, store: CodexWorkflowStore, run: WorkflowRun): Promise<void> {
        const auth = await runtime.accountRead();
        if (auth?.requiresOpenaiAuth && !auth?.account) {
            run.status = 'blocked';
            run.artifacts.finalSummary = 'Codex login is required. Run Codex login in the Codex app/CLI, then resume this workflow.';
            store.saveRun(run);
            throw new Error(run.artifacts.finalSummary);
        }
    }

    private async runStage(store: CodexWorkflowStore, run: WorkflowRun, stageId: string, role: CodexWorkflowRole, sandbox: SandboxKind, prompt: string): Promise<CodexTurnResult> {
        this.assertNotCancelled();
        store.upsertStage(run, { id: stageId, role, status: 'running', startedAt: new Date().toISOString(), inputSummary: prompt.slice(0, 300) });
        store.updateAgent(run, role, { status: 'running', lastError: undefined });
        this.emitState(`${role} running: ${stageId}`);

        try {
            const threadId = await this.prepareThread(run, role, sandbox);
            const runtime = await this.ensureRuntime(run, run.git.workCwd || run.cwd);
            const roleInstructions = this.readRoleInstructions(role);
            const result = await runtime.runTurn({
                threadId,
                input: [{ type: 'text', text: prompt }],
                cwd: run.git.workCwd || run.cwd,
                approvalPolicy: 'never',
                sandboxPolicy: sandboxPolicy(sandbox, run.git.workCwd || run.cwd),
                settings: { developer_instructions: roleInstructions },
                ...(this.codexModel ? { model: this.codexModel } : {}),
            });
            const failed = result.status === 'failed' || !!result.error;
            store.upsertStage(run, {
                id: stageId,
                role,
                status: failed ? 'failed' : 'completed',
                outputSummary: summarize(result.text || result.error || '', 1200),
                error: result.error,
                finishedAt: new Date().toISOString(),
            });
            store.updateAgent(run, role, {
                status: failed ? 'failed' : 'completed',
                lastSummary: summarize(result.text || '', 1200),
                lastError: result.error,
            });
            if (failed) throw new Error(result.error || `${role} failed.`);
            this.emitState(`${role} completed: ${stageId}`);
            return result;
        } catch (e: any) {
            store.upsertStage(run, {
                id: stageId,
                role,
                status: 'failed',
                error: e?.message || String(e),
                finishedAt: new Date().toISOString(),
            });
            store.updateAgent(run, role, { status: 'failed', lastError: e?.message || String(e) });
            this.emitState(`${role} failed: ${e?.message || e}`);
            throw e;
        }
    }

    private async prepareThread(run: WorkflowRun, role: CodexWorkflowRole, sandbox: SandboxKind): Promise<string> {
        const runtime = await this.ensureRuntime(run, run.git.workCwd || run.cwd);
        const agent = run.agents[role] || { role, status: 'idle' as const };
        let threadId = agent.threadId;
        const params = {
            cwd: run.git.workCwd || run.cwd,
            approvalPolicy: 'never',
            sandbox: sandbox === 'readOnly' ? 'read-only' : 'workspace-write',
            serviceName: 'haram_ai_agent_codex_workflow',
            ...(this.codexModel ? { model: this.codexModel } : {}),
        };

        if (run.contextMode === 'resume' && threadId) {
            const res = await runtime.resumeThread(threadId, params);
            threadId = res?.thread?.id || threadId;
        } else if (run.contextMode === 'compact' && threadId) {
            await runtime.resumeThread(threadId, params);
            await runtime.compactThread(threadId);
        } else if (run.contextMode === 'fork' && threadId) {
            const res = await runtime.forkThread(threadId);
            threadId = res?.thread?.id || threadId;
        } else {
            const res = await runtime.startThread(params);
            threadId = res?.thread?.id;
        }
        if (!threadId) throw new Error(`Failed to prepare Codex thread for ${role}.`);
        run.agents[role] = { ...agent, role, threadId, status: 'idle' };
        new CodexWorkflowStore(run.cwd).saveRun(run);
        return threadId;
    }

    private prepareGit(store: CodexWorkflowStore, run: WorkflowRun): void {
        const cwd = run.cwd;
        const isRepo = gitSafe(['rev-parse', '--show-toplevel'], cwd) !== null;
        run.git.isRepo = isRepo;
        run.git.originalCwd = cwd;
        run.git.workCwd = cwd;
        if (!isRepo) {
            store.saveRun(run);
            return;
        }

        const originalBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
        const dirty = gitLines(['status', '--porcelain'], cwd).length > 0;
        const branch = `codex/${slugify(run.userPrompt)}-${timestampForBranch()}`;
        run.git.originalBranch = originalBranch;
        run.git.branch = branch;
        run.git.dirty = dirty;

        if (dirty || this.options.alwaysUseWorktree) {
            const parent = path.dirname(cwd);
            const base = path.basename(cwd);
            const worktreePath = path.join(parent, `${base}-${branch.replace(/[\\/]/g, '-')}`);
            git(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], cwd, 120000);
            run.git.worktreePath = worktreePath;
            run.git.workCwd = worktreePath;
        } else {
            git(['switch', '-c', branch], cwd, 60000);
            run.git.workCwd = cwd;
        }
        store.saveRun(run);
    }

    private async processAgentRequests(
        store: CodexWorkflowStore,
        run: WorkflowRun,
        stageId: string,
        fromRole: CodexWorkflowRole,
        result: CodexTurnResult,
    ): Promise<string> {
        const parsed = parseAgentRequests(result.text || '');
        if (parsed.length === 0) return '';
        const existingCount = (run.agentRequests || []).length;
        if (existingCount >= 5) {
            store.appendEvent(run, 'agentRequest.limitReached', { stageId, fromRole });
            return '';
        }
        const stageExisting = (run.agentRequests || []).filter(r => r.stageId === stageId).length;
        const allowed = Math.max(0, Math.min(5 - existingCount, 3 - stageExisting));
        const answers: string[] = [];
        for (const request of parsed.slice(0, allowed)) {
            if (!CODEX_WORKFLOW_ROLES.includes(request.toRole as CodexWorkflowRole)) continue;
            const id = `${run.id}:${stageId}:agent-request-${(run.agentRequests || []).length + 1}`;
            const agentRequest: AgentRequest = {
                id,
                runId: run.id,
                stageId,
                turnId: result.turnId,
                fromRole,
                toRole: request.toRole,
                question: request.question,
                status: 'pending',
                createdAt: new Date().toISOString(),
            };
            store.upsertAgentRequest(run, agentRequest);
            store.appendEvent(run, 'agentRequest.created', agentRequest);
            try {
                const answer = await this.runStage(
                    store,
                    run,
                    `${stageId}-to-${request.toRole}-${answers.length + 1}`,
                    request.toRole as CodexWorkflowRole,
                    'readOnly',
                    this.agentRequestPrompt(run, fromRole, request.question),
                );
                agentRequest.status = 'answered';
                agentRequest.answer = answer.text;
                agentRequest.answerSummary = summarize(answer.text, 1200);
                agentRequest.resolvedAt = new Date().toISOString();
                store.upsertAgentRequest(run, agentRequest);
                store.appendEvent(run, 'agentRequest.answered', { id, toRole: request.toRole });
                answers.push(`${request.toRole}: ${agentRequest.answerSummary}`);
            } catch (e: any) {
                agentRequest.status = 'failed';
                agentRequest.answerSummary = e?.message || String(e);
                agentRequest.resolvedAt = new Date().toISOString();
                store.upsertAgentRequest(run, agentRequest);
                store.appendEvent(run, 'agentRequest.failed', { id, error: agentRequest.answerSummary });
            }
        }
        return answers.join('\n\n');
    }

    private docsPrompt(run: WorkflowRun): string {
        return this.withRole('docs-agent', `User request:\n${run.userPrompt}\n\nRead the repository rules, README, package metadata, and relevant docs. Do not edit files. Return a concise Korean summary of rules, conventions, risks, and the likely implementation path.`);
    }

    private webResearchPrompt(run: WorkflowRun): string {
        return this.withRole('web-researcher', `User request:\n${run.userPrompt}\n\nDocs summary:\n${run.artifacts.docsSummary || ''}\n\nResearch only the external/current information needed for this task. Use available web/search tools if they are available in this Codex environment. Do not edit files. Return concise Korean findings, source links when available, and any uncertainty or missing access.`);
    }

    private gitPlanPrompt(run: WorkflowRun): string {
        return this.withRole('git-manager', `User request:\n${run.userPrompt}\n\nDocs summary:\n${run.artifacts.docsSummary || ''}\n\nWeb research summary:\n${run.artifacts.webResearchSummary || ''}\n\nGit state:\n${JSON.stringify(run.git, null, 2)}\n\nConfirm the branch/worktree policy and identify commit/push safety gates. Do not run commit or push. Return concise Korean output.`);
    }

    private implementationPrompt(run: WorkflowRun, role: CodexWorkflowRole): string {
        return this.withRole(role, `${implementationMission(role)}\n\nUser request:\n${run.userPrompt}\n\nDocs summary:\n${run.artifacts.docsSummary || ''}\n\nWeb research summary:\n${run.artifacts.webResearchSummary || ''}\n\nGit plan:\n${run.artifacts.gitPlan || ''}\n\nDo not commit or push. Keep edits scoped to your role. If another specialist should answer a question before you continue, include an AGENT_REQUESTS JSON block like [{"toRole":"docs-agent","question":"..."}]. After your work, summarize changed files, behavior changes, and commands run.`);
    }

    private repairPrompt(run: WorkflowRun, role: CodexWorkflowRole, qa: CodexTurnResult): string {
        return this.withRole(role, `Repair the implementation area owned by ${role} based on QA feedback.\n\nUser request:\n${run.userPrompt}\n\nQA feedback:\n${qa.text || qa.error || ''}\n\nCurrent implementation summaries:\n${implementationSummaryBlock(run)}\n\nDo not commit or push. Keep the fix scoped to your role and summarize changed files.`);
    }

    private agentRequestPrompt(run: WorkflowRun, fromRole: CodexWorkflowRole, question: string): string {
        return `Another workflow agent (${fromRole}) requested information for this run.\n\nUser request:\n${run.userPrompt}\n\nQuestion:\n${question}\n\nAnswer concisely in Korean. Do not edit files.`;
    }

    private agentRequestFollowupPrompt(run: WorkflowRun, role: CodexWorkflowRole, answers: string): string {
        return this.withRole(role, `Continue your assigned work using these agent handoff answers.\n\nUser request:\n${run.userPrompt}\n\nAgent answers:\n${answers}\n\nApply any needed scoped changes for ${role}. Do not commit or push. Summarize changed files.`);
    }

    private qaPrompt(run: WorkflowRun): string {
        return this.withRole('qa-agent', `Verify the current implementation for this request:\n${run.userPrompt}\n\nAssigned agents:\n${(run.artifacts.assignedRoles || []).join(', ')}\n\nImplementation summaries:\n${implementationSummaryBlock(run)}\n\nRun the most relevant available checks, starting with npm run compile when present. Do not edit source files. Include command names and exit evidence. End with exactly one line: QA_STATUS: PASS or QA_STATUS: FAIL, followed by concise Korean evidence.`);
    }

    private docPrompt(run: WorkflowRun): string {
        return this.withRole('doc-writer', `Summarize the completed work for handoff.\n\nUser request:\n${run.userPrompt}\n\nAssigned agents:\n${(run.artifacts.assignedRoles || []).join(', ')}\n\nWeb research summary:\n${run.artifacts.webResearchSummary || ''}\n\nImplementation summaries:\n${implementationSummaryBlock(run)}\n\nQA summary:\n${run.artifacts.qaSummary || ''}\n\nReturn Korean release notes with changed behavior, verification, and any remaining risk. Do not edit files.`);
    }

    private withRole(role: CodexWorkflowRole, body: string): string {
        return `[Codex custom agent role: ${role}]\n${this.readRoleInstructions(role)}\n\n${body}`;
    }

    private readRoleInstructions(role: CodexWorkflowRole): string {
        const p = path.join(this.options.extensionPath, '.codex', 'agents', ROLE_FILE[role]);
        try {
            const txt = fs.readFileSync(p, 'utf-8');
            const m = txt.match(/developer_instructions\s*=\s*"""([\s\S]*?)"""/);
            return m ? m[1].trim() : txt.slice(0, 4000);
        } catch {
            return `Act as ${role}. Stay within your assigned role.`;
        }
    }

    private onCodexEvent(msg: any): void {
        const method = msg?.method || '';
        if (!method) return;
        if (this.currentRun) {
            new CodexWorkflowStore(this.currentRun.cwd).appendEvent(this.currentRun, 'codex.event', {
                method,
                runtime: this.currentRun.selectedRuntime,
            });
        }
        if (method === 'turn/plan/updated' || method === 'item/started' || method === 'item/completed' || method === 'turn/completed') {
            this.emitLog(method);
        }
    }

    private getWorkspaceRoot(): string {
        return this.options.workspaceRoot || '';
    }

    private requireWorkspaceRoot(): string {
        const root = this.getWorkspaceRoot();
        if (!root) throw new Error('Open a workspace folder before starting Codex Workflow.');
        return root;
    }

    private assertNotCancelled(): void {
        if (this.cancelled) throw new Error('Codex Workflow cancelled.');
    }

    private emitState(message?: string): void {
        if (this.currentRun && message) {
            new CodexWorkflowStore(this.currentRun.cwd).appendEvent(this.currentRun, 'workflow.state', { message, status: this.currentRun.status });
        }
        this.options.onUpdate?.({ type: 'state', message, run: this.currentRun });
    }

    private emitLog(message: string): void {
        if (!message) return;
        if (this.currentRun) {
            new CodexWorkflowStore(this.currentRun.cwd).appendEvent(this.currentRun, 'workflow.log', { message });
        }
        this.options.onUpdate?.({ type: 'log', message, run: this.currentRun });
    }
}

function sandboxPolicy(kind: SandboxKind, cwd: string): any {
    if (kind === 'readOnly') {
        return { type: 'readOnly', access: { type: 'fullAccess' } };
    }
    return { type: 'workspaceWrite', writableRoots: [cwd], readOnlyAccess: { type: 'fullAccess' }, networkAccess: false };
}

function shouldSkipImplementation(prompt: string): boolean {
    const p = prompt.toLowerCase();
    const asksChange = /(implement|fix|add|change|create|build|write|edit|코드|구현|수정|추가|만들|작성|고쳐|패치)/i.test(p);
    const asksReadOnly = /(analyze|review|explain|summarize|check|확인|분석|검토|설명|요약|가능|조사)/i.test(p);
    return asksReadOnly && !asksChange;
}

function inferRunKind(prompt: string): WorkflowRunKind {
    const asksGitOnly = /(git|commit|push|branch|worktree|origin|깃|커밋|푸시|브랜치|워크트리)/i.test(prompt);
    const asksImplementation = /(implement|fix|add|change|create|build|write|edit|code|구현|수정|추가|작성|코드)/i.test(prompt);
    if (asksGitOnly && !asksImplementation) return 'gitOperation';
    if (shouldSkipImplementation(prompt)) return 'readOnly';
    return 'multiAgent';
}

function shouldRunWebResearch(prompt: string): boolean {
    return /(latest|current|up-to-date|look up|search|browse|official docs|web에서|웹에서|검색|찾아봐|찾아서|조사|최신|공식\s*문서|리서치해|research this)/i.test(prompt);
}

function selectImplementationRoles(run: WorkflowRun): CodexWorkflowRole[] {
    const text = `${run.userPrompt}\n${run.artifacts.docsSummary || ''}\n${run.artifacts.gitPlan || ''}`.toLowerCase();
    const wantsDesigner = /(designer|design|ux|ui|layout|visual|style|css|figma|wireframe|화면|디자인|스타일|레이아웃|프로필|버튼|카드)/i.test(text);
    const wantsFrontend = wantsDesigner || /(frontend|front-end|front end|webview|html|css|client|react|vue|svelte|browser|electron|sidebar|프론트|웹뷰|브라우저|화면)/i.test(text);
    const wantsBackend = /(backend|back-end|server|api|store|engine|workflow|agent|mcp|sdk|git|database|db|auth|queue|approval|runtime|orchestrat|백엔드|서버|에이전트|워크플로|승인|깃|저장|상태)/i.test(text);
    const roles: CodexWorkflowRole[] = [];
    if (wantsDesigner) roles.push('designer');
    if (wantsFrontend) roles.push('frontend-coder');
    if (wantsBackend || roles.length === 0) roles.push('backend-coder');
    return roles;
}

function selectRepairRoles(run: WorkflowRun, qa: CodexTurnResult, fallback: CodexWorkflowRole[]): CodexWorkflowRole[] {
    const text = `${qa.text || ''}\n${qa.error || ''}`.toLowerCase();
    const roles: CodexWorkflowRole[] = [];
    if (/(designer|design|ux|ui|layout|visual|style|css|화면|디자인|스타일|레이아웃)/i.test(text) && fallback.includes('designer')) roles.push('designer');
    if (/(frontend|front-end|html|css|client|react|webview|browser|프론트|웹뷰|브라우저|화면)/i.test(text) && fallback.includes('frontend-coder')) roles.push('frontend-coder');
    if (/(backend|server|api|store|engine|workflow|agent|mcp|sdk|git|database|db|auth|queue|approval|runtime|백엔드|서버|에이전트|워크플로|승인|깃)/i.test(text) && fallback.includes('backend-coder')) roles.push('backend-coder');
    return roles.length ? Array.from(new Set(roles)) : fallback;
}

function assignedRolesForRun(run: WorkflowRun, needsResearch: boolean, implementationRoles: CodexWorkflowRole[]): string[] {
    const roles = ['docs-agent'];
    if (needsResearch) roles.push('web-researcher');
    if (implementationRoles.length > 0) roles.push('git-manager', ...implementationRoles, 'qa-agent', 'doc-writer');
    else if (run.runKind === 'readOnly' && run.selectedRuntime === 'sdk') roles.push('sdk-runtime');
    return Array.from(new Set(roles));
}

function implementationStageId(role: CodexWorkflowRole): string {
    if (role === 'designer') return 'design';
    if (role === 'frontend-coder') return 'frontend-code';
    if (role === 'backend-coder') return 'backend-code';
    return role;
}

function implementationMission(role: CodexWorkflowRole): string {
    if (role === 'designer') {
        return 'You are responsible for product/UI/UX design implementation. Improve layout, hierarchy, interaction states, visual polish, and user-facing copy where the task requires it.';
    }
    if (role === 'frontend-coder') {
        return 'You are responsible for frontend implementation. Work on UI, webview, browser-facing code, client state, styling, accessibility, and visible behavior.';
    }
    if (role === 'backend-coder') {
        return 'You are responsible for backend/core implementation. Work on workflow orchestration, state, API, runtime adapters, git policies, persistence, and non-UI logic.';
    }
    return `You are responsible for the ${role} part of this workflow.`;
}

function setImplementationSummary(run: WorkflowRun, role: CodexWorkflowRole, summary: string): void {
    if (role === 'designer') run.artifacts.designerSummary = summary;
    else if (role === 'frontend-coder') run.artifacts.frontendSummary = summary;
    else if (role === 'backend-coder') run.artifacts.backendSummary = summary;
    else run.artifacts.coderSummary = summary;
}

function implementationSummaryBlock(run: WorkflowRun): string {
    return [
        run.artifacts.designerSummary ? `designer:\n${run.artifacts.designerSummary}` : '',
        run.artifacts.frontendSummary ? `frontend-coder:\n${run.artifacts.frontendSummary}` : '',
        run.artifacts.backendSummary ? `backend-coder:\n${run.artifacts.backendSummary}` : '',
        run.artifacts.coderSummary ? `combined:\n${run.artifacts.coderSummary}` : '',
    ].filter(Boolean).join('\n\n') || '(no implementation summary yet)';
}

function qaPassed(result: CodexTurnResult): boolean {
    const text = `${result.text || ''}\n${result.error || ''}`;
    if (/QA_STATUS:\s*PASS/i.test(text)) return true;
    if (/QA_STATUS:\s*FAIL/i.test(text)) return false;
    if (result.status === 'failed' || result.error) return false;
    return !/(failed|failure|error|exception|실패|오류|에러)/i.test(text);
}

function summarize(text: string, max = 2000): string {
    const clean = (text || '').replace(/\s+\n/g, '\n').trim();
    return clean.length > max ? `${clean.slice(0, max)}\n...[truncated]` : clean;
}

function timestampForBranch(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function git(args: string[], cwd: string, timeout = 30000): string {
    const res = spawnSync('git', args, {
        cwd,
        encoding: 'utf-8',
        timeout,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    if (res.error) throw res.error;
    if (res.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${(res.stderr || res.stdout || '').trim() || `exit ${res.status}`}`);
    }
    return res.stdout || '';
}

function gitAsync(
    args: string[],
    cwd: string,
    timeout = 30000,
    onOutput?: (message: string) => void,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn('git', args, {
            cwd,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill(); } catch { /* ignore */ }
            reject(new Error(`git ${args.join(' ')} timed out after ${Math.round(timeout / 1000)}s.`));
        }, timeout);
        const handleOutput = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
            const text = chunk.toString();
            if (stream === 'stdout') stdout += text;
            else stderr += text;
            for (const line of text.split(/\r?\n/).filter(Boolean)) onOutput?.(line);
        };
        child.stdout.on('data', chunk => handleOutput('stdout', chunk));
        child.stderr.on('data', chunk => handleOutput('stderr', chunk));
        child.once('error', error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        });
        child.once('exit', code => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code === 0) resolve(stdout);
            else reject(new Error(`git ${args.join(' ')} failed: ${(stderr || stdout).trim() || `exit ${code}`}`));
        });
    });
}

function gitSafe(args: string[], cwd: string, timeout = 30000): string | null {
    try { return git(args, cwd, timeout); }
    catch { return null; }
}

function gitLines(args: string[], cwd: string): string[] {
    const out = gitSafe(args, cwd) || '';
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function gitConflictFiles(cwd: string): string[] {
    const statusFiles = gitLines(['status', '--porcelain', '-uall'], cwd)
        .filter(line => {
            const code = line.slice(0, 2);
            return code.includes('U') || code === 'AA' || code === 'DD';
        })
        .map(line => line.slice(3).split(' -> ').pop() || line.slice(3));
    const indexFiles = gitLines(['ls-files', '-u'], cwd)
        .map(line => {
            const tab = line.lastIndexOf('\t');
            return tab >= 0 ? line.slice(tab + 1) : '';
        })
        .filter(Boolean);
    return Array.from(new Set([...statusFiles, ...indexFiles])).sort();
}

function hasRemote(cwd: string): boolean {
    return !!gitSafe(['remote', 'get-url', 'origin'], cwd);
}

function gitDiffHash(cwd: string): string {
    const status = gitSafe(['status', '--porcelain'], cwd) || '';
    const diff = gitSafe(['diff', '--binary'], cwd) || '';
    return crypto.createHash('sha256').update(`${status}\n${diff}`).digest('hex');
}

function gitOperationDiff(cwd: string): string {
    const status = gitSafe(['status', '--short'], cwd) || '';
    const stat = gitSafe(['diff', '--stat'], cwd) || '';
    const stagedStat = gitSafe(['diff', '--cached', '--stat'], cwd) || '';
    const diff = gitSafe(['diff', '--', '.'], cwd) || '';
    const stagedDiff = gitSafe(['diff', '--cached', '--', '.'], cwd) || '';
    return summarize([
        '$ git status --short',
        status.trim() || '(clean)',
        '',
        '$ git diff --stat',
        stat.trim() || '(no unstaged diff stat)',
        '',
        '$ git diff --cached --stat',
        stagedStat.trim() || '(no staged diff stat)',
        '',
        '$ git diff',
        diff.trim(),
        '',
        '$ git diff --cached',
        stagedDiff.trim(),
    ].join('\n'), 20000);
}

function parseAheadBehind(output: string | null): { ahead: number; behind: number } {
    const parts = (output || '').trim().split(/\s+/).map(n => Number(n));
    return {
        ahead: Number.isFinite(parts[0]) ? parts[0] : 0,
        behind: Number.isFinite(parts[1]) ? parts[1] : 0,
    };
}

function upsertApproval(run: WorkflowRun, approval: ApprovalRequest): ApprovalRequest {
    const approvals = run.approvalRequests || (run.approvalRequests = []);
    const existing = approvals.find(a => a.id === approval.id);
    if (existing) {
        Object.assign(existing, approval);
        return existing;
    }
    approvals.push(approval);
    return approval;
}

function pendingApproval(run: WorkflowRun, type: ApprovalRequest['type']): ApprovalRequest | undefined {
    return (run.approvalRequests || []).find(a => a.type === type && a.status === 'pending');
}

function resolveApproval(run: WorkflowRun, type: ApprovalRequest['type'], status: ApprovalRequest['status']): void {
    const approval = (run.approvalRequests || []).find(a => a.type === type && a.status === 'pending');
    if (!approval) return;
    approval.status = status;
    approval.resolvedAt = new Date().toISOString();
}

function parseAgentRequests(text: string): Array<{ toRole: string; question: string }> {
    const blocks: string[] = [];
    const fenced = text.match(/AGENT_REQUESTS\s*:?\s*```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) blocks.push(fenced[1]);
    const inline = text.match(/AGENT_REQUESTS\s*:?\s*(\[[\s\S]*?\])/i);
    if (inline?.[1]) blocks.push(inline[1]);
    for (const block of blocks) {
        try {
            const parsed = JSON.parse(block);
            const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.requests) ? parsed.requests : [];
            return items
                .map((item: any) => ({
                    toRole: String(item.toRole || item.to || '').trim(),
                    question: String(item.question || '').trim(),
                }))
                .filter((item: any) => item.toRole && item.question);
        } catch {
            // Try the next candidate block.
        }
    }
    return [];
}
