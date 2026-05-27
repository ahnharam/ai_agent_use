import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
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
    'git-manager': 'git-manager.toml',
    coder: 'coder.toml',
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
            if (approval?.validationHash && approval.validationHash !== gitDiffHash(run.git.workCwd)) {
                throw new Error('Git diff changed after commit approval was requested. Refresh the run and review the latest diff.');
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
                throw new Error('Commit hash changed after push approval was requested. Refresh the run and review the latest commit.');
            }
            const branch = run.git.branch || git(['rev-parse', '--abbrev-ref', 'HEAD'], run.git.workCwd).trim();
            git(['push', '-u', 'origin', branch], run.git.workCwd, 120000);
            run.approvals.pushApproved = true;
            resolveApproval(run, 'push', 'approved');
            run.git.pushRemote = 'origin';
            run.git.pushBranch = branch;
            run.status = 'completed';
            store.saveRun(run);
            this.emitState(`Pushed origin/${branch}.`);
        } catch (e: any) {
            run.status = 'failed';
            run.git.lastError = e?.message || String(e);
            store.saveRun(run);
            this.emitState(`Push failed: ${run.git.lastError}`);
            throw e;
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

            if (readOnly) {
                run.artifacts.finalSummary = run.artifacts.docsSummary || docs.text;
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

            const coder = await this.runStage(store, run, 'coder', 'coder', 'workspaceWrite', this.coderPrompt(run));
            run.artifacts.coderSummary = summarize(coder.text);
            if (coder.diff) run.artifacts.lastDiff = coder.diff.slice(0, 20000);
            store.saveRun(run);
            const coderAnswers = await this.processAgentRequests(store, run, 'coder', 'coder', coder);
            if (coderAnswers) {
                const followup = await this.runStage(store, run, 'coder-agent-requests-followup', 'coder', 'workspaceWrite', this.agentRequestFollowupPrompt(run, coderAnswers));
                run.artifacts.coderSummary = summarize(followup.text);
                if (followup.diff) run.artifacts.lastDiff = followup.diff.slice(0, 20000);
                store.saveRun(run);
            }

            let qa = await this.runStage(store, run, 'qa', 'qa-agent', 'workspaceWrite', this.qaPrompt(run));
            run.artifacts.qaSummary = summarize(qa.text);
            run.artifacts.qaEvidence = summarize(`${qa.text || ''}\n${qa.error || ''}`, 4000);
            store.saveRun(run);

            while (!qaPassed(qa) && run.repairAttempts < run.maxRepairLoops) {
                this.assertNotCancelled();
                run.repairAttempts += 1;
                store.saveRun(run);
                const repair = await this.runStage(store, run, `coder-repair-${run.repairAttempts}`, 'coder', 'workspaceWrite', this.repairPrompt(run, qa));
                run.artifacts.coderSummary = summarize(repair.text);
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

    private gitPlanPrompt(run: WorkflowRun): string {
        return this.withRole('git-manager', `User request:\n${run.userPrompt}\n\nDocs summary:\n${run.artifacts.docsSummary || ''}\n\nGit state:\n${JSON.stringify(run.git, null, 2)}\n\nConfirm the branch/worktree policy and identify commit/push safety gates. Do not run commit or push. Return concise Korean output.`);
    }

    private coderPrompt(run: WorkflowRun): string {
        return this.withRole('coder', `Implement the user request in this workspace.\n\nUser request:\n${run.userPrompt}\n\nDocs summary:\n${run.artifacts.docsSummary || ''}\n\nGit plan:\n${run.artifacts.gitPlan || ''}\n\nDo not commit or push. Keep edits scoped. After implementation, summarize changed files and any commands you ran.`);
    }

    private repairPrompt(run: WorkflowRun, qa: CodexTurnResult): string {
        return this.withRole('coder', `Repair the implementation based on QA feedback.\n\nUser request:\n${run.userPrompt}\n\nQA feedback:\n${qa.text || qa.error || ''}\n\nDo not commit or push. Keep the fix scoped and summarize changed files.`);
    }

    private agentRequestPrompt(run: WorkflowRun, fromRole: CodexWorkflowRole, question: string): string {
        return `Another workflow agent (${fromRole}) requested information for this run.\n\nUser request:\n${run.userPrompt}\n\nQuestion:\n${question}\n\nAnswer concisely in Korean. Do not edit files.`;
    }

    private agentRequestFollowupPrompt(run: WorkflowRun, answers: string): string {
        return this.withRole('coder', `Continue the implementation using these agent handoff answers.\n\nUser request:\n${run.userPrompt}\n\nAgent answers:\n${answers}\n\nApply any needed scoped changes. Do not commit or push. Summarize changed files.`);
    }

    private qaPrompt(run: WorkflowRun): string {
        return this.withRole('qa-agent', `Verify the current implementation for this request:\n${run.userPrompt}\n\nRun the most relevant available checks, starting with npm run compile when present. Do not edit source files. Include command names and exit evidence. End with exactly one line: QA_STATUS: PASS or QA_STATUS: FAIL, followed by concise Korean evidence.`);
    }

    private docPrompt(run: WorkflowRun): string {
        return this.withRole('doc-writer', `Summarize the completed work for handoff.\n\nUser request:\n${run.userPrompt}\n\nCoder summary:\n${run.artifacts.coderSummary || ''}\n\nQA summary:\n${run.artifacts.qaSummary || ''}\n\nReturn Korean release notes with changed behavior, verification, and any remaining risk. Do not edit files.`);
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
    if (shouldSkipImplementation(prompt)) return 'readOnly';
    return 'multiAgent';
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

function gitSafe(args: string[], cwd: string, timeout = 30000): string | null {
    try { return git(args, cwd, timeout); }
    catch { return null; }
}

function gitLines(args: string[], cwd: string): string[] {
    const out = gitSafe(args, cwd) || '';
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function hasRemote(cwd: string): boolean {
    return !!gitSafe(['remote', 'get-url', 'origin'], cwd);
}

function gitDiffHash(cwd: string): string {
    const status = gitSafe(['status', '--porcelain'], cwd) || '';
    const diff = gitSafe(['diff', '--binary'], cwd) || '';
    return crypto.createHash('sha256').update(`${status}\n${diff}`).digest('hex');
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
