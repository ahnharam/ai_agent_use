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
import {
    agentDocumentContext,
    rebuildDocumentCache,
} from './documentContext';
import {
    runGitRoutingPreflight,
    startWorkflowWriterLock,
    releaseWorkflowWriterLock,
    WorkflowWriterLockHandle,
    acquireGitRoutingMutex,
    GitRoutingMutexHandle,
    gitRepositoryLockRoot,
} from './gitRoutingSafety';

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
    routingPreference?: 'auto' | 'force-worktree';
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
            releaseWorkflowWriterLock(workflowLockRoot(this.currentRun), this.currentRun.id);
        }
        await this.runtime?.stop();
        this.runtime = null;
        this.running = false;
        this.emitState('Codex 워크플로우가 취소되었습니다.');
    }

    public async compactAgent(role: string): Promise<void> {
        const run = this.currentRun;
        if (!run) throw new Error('No active Codex Workflow run.');
        const agent = run.agents[role];
        if (!agent?.threadId) throw new Error(`No thread id for ${role}.`);
        const runtime = await this.ensureRuntime(run, run.cwd);
        await runtime.compactThread(agent.threadId);
        agent.lastSummary = `${role} 컨텍스트 압축 요청: ${new Date().toISOString()}`;
        new CodexWorkflowStore(run.cwd).saveRun(run);
        this.emitState(`${role} 컨텍스트 압축을 요청했습니다.`);
    }

    public resetAgent(role: string): void {
        const run = this.currentRun;
        if (!run) throw new Error('No active Codex Workflow run.');
        if (!run.agents[role]) throw new Error(`Unknown agent: ${role}`);
        run.agents[role] = { role, status: 'reset', lastSummary: 'thread id를 지웠습니다. 다음 turn은 새 컨텍스트로 시작합니다.' };
        new CodexWorkflowStore(run.cwd).saveRun(run);
        this.emitState(`${role} 초기화 완료.`);
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
                this.blockApproval(store, run, 'commit', `커밋 차단: 해결되지 않은 충돌 파일이 있습니다.\n${conflicts.join('\n')}`);
                return;
            }
            if (approval?.validationHash && approval.validationHash !== gitDiffHash(run.git.workCwd)) {
                this.blockApproval(store, run, 'commit', '커밋 승인 요청 이후 Git diff가 변경되었습니다. gitOperation 작업을 새로 시작하거나 새로고침한 뒤 최신 diff를 다시 검토하세요.');
                return;
            }
            const files = gitLines(['status', '--short'], run.git.workCwd);
            if (files.length === 0) {
                run.approvals.commitRequired = false;
                run.status = 'completed';
                run.artifacts.finalSummary = '커밋할 파일 변경이 없습니다.';
                store.saveRun(run);
                this.emitState('커밋할 변경 사항이 없습니다.');
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
                    summary: `${run.git.branch || 'current'} 브랜치를 origin에 푸시합니다.`,
                    validationHash: run.git.commitHash,
                    createdAt: new Date().toISOString(),
                });
            }
            run.status = run.approvals.pushRequired ? 'pendingPushApproval' : 'completed';
            store.saveRun(run);
            this.emitState(run.approvals.pushRequired ? '커밋이 생성되었습니다. 푸시 승인이 필요합니다.' : '커밋이 생성되었습니다.');
        } catch (e: any) {
            run.status = 'failed';
            run.git.lastError = e?.message || String(e);
            store.saveRun(run);
            this.emitState(`커밋 실패: ${run.git.lastError}`);
            throw e;
        }
    }

    public async approvePush(): Promise<void> {
        const run = this.currentRun;
        if (!run) throw new Error('No active Codex Workflow run.');
        if (run.status !== 'pendingPushApproval') throw new Error('승인 대기 중인 푸시가 없습니다.');
        const store = new CodexWorkflowStore(run.cwd);
        try {
            const approval = pendingApproval(run, 'push');
            if (approval?.validationHash && approval.validationHash !== run.git.commitHash) {
                this.blockApproval(store, run, 'push', '푸시 승인 요청 이후 커밋 해시가 변경되었습니다. gitOperation 작업을 새로 시작하거나 새로고침한 뒤 최신 커밋을 다시 검토하세요.');
                return;
            }
            const branch = run.git.branch || git(['rev-parse', '--abbrev-ref', 'HEAD'], run.git.workCwd).trim();
            resolveApproval(run, 'push', 'approved');
            run.git.pushRemote = 'origin';
            run.git.pushBranch = branch;
            run.status = 'running';
            store.saveRun(run);
            this.emitState(`origin/${branch} 푸시를 시작했습니다.`);
            void this.executeApprovedPush(store, run, branch);
        } catch (e: any) {
            run.status = 'failed';
            run.git.lastError = e?.message || String(e);
            store.saveRun(run);
            this.emitState(`푸시 실패: ${run.git.lastError}`);
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
            run.artifacts.finalSummary = `origin/${branch}에 ${run.git.commitHash} 커밋까지 푸시 완료.`;
            store.appendEvent(run, 'git.push.completed', { branch, commitHash: run.git.commitHash });
            store.saveRun(run);
            this.emitState(`origin/${branch} 푸시 완료.`);
        } catch (e: any) {
            const message = e?.message || String(e);
            run.status = 'failed';
            run.git.lastError = /non-fast-forward|fetch first|rejected/i.test(message)
                ? `원격 브랜치가 변경되었거나 앞서 있어서 푸시가 거절되었습니다. fetch/rebase 또는 merge 후 새 gitOperation 작업을 시작하세요.\n${message}`
                : message;
            run.artifacts.finalSummary = run.git.lastError;
            store.appendEvent(run, 'git.push.failed', { branch, error: run.git.lastError });
            store.saveRun(run);
            this.emitState(`푸시 실패: ${run.git.lastError}`);
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
            summary: `${run.git.branch} 브랜치를 ${run.git.originalBranch || '원본 브랜치'}에 병합합니다.`,
            validationHash: run.git.commitHash || gitSafe(['rev-parse', '--short', run.git.branch], run.git.workCwd)?.trim(),
            createdAt: new Date().toISOString(),
        });
        store.saveRun(run);
        this.emitState('원본 브랜치 병합 승인이 필요합니다.');
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
                throw new Error('원본 병합 승인 요청 이후 브랜치 해시가 변경되었습니다.');
            }
            const originalStatus = gitLines(['status', '--porcelain'], run.git.originalCwd || run.cwd);
            if (originalStatus.length > 0) throw new Error('원본 작업트리가 dirty 상태입니다. 원본 병합을 차단했습니다.');
            git(['switch', run.git.originalBranch], run.git.originalCwd || run.cwd, 60000);
            git(['merge', '--no-ff', run.git.branch, '-m', `merge codex workflow: ${slugify(run.userPrompt)}`], run.git.originalCwd || run.cwd, 120000);
            run.git.mergeStatus = 'merged';
            resolveApproval(run, 'merge-back', 'approved');
            store.saveRun(run);
            this.emitState(`${run.git.branch} 브랜치를 ${run.git.originalBranch}에 병합했습니다.`);
        } catch (e: any) {
            run.git.mergeStatus = /conflict/i.test(e?.message || '') ? 'conflict' : 'failed';
            run.git.lastError = e?.message || String(e);
            store.saveRun(run);
            this.emitState(`원본 병합 실패: ${run.git.lastError}`);
            throw e;
        }
    }

    public cleanupWorktree(): void {
        const run = this.currentRun;
        if (!run) throw new Error('No active Codex Workflow run.');
        if (!run.git.worktreePath) throw new Error('No workflow worktree exists for this run.');
        if (['running', 'queued', 'pendingCommitApproval', 'pendingPushApproval'].includes(run.status)) {
            throw new Error('Workflow worktree cleanup is blocked while the run still has active or pending work.');
        }
        if (!run.git.branch?.startsWith('codex/')) {
            throw new Error(`Workflow worktree cleanup is blocked for non-Codex branch: ${run.git.branch || '(unknown)'}`);
        }
        const registered = parseWorktrees(gitSafe(['worktree', 'list', '--porcelain'], run.git.originalCwd || run.cwd) || '')
            .some(worktree => path.resolve(worktree.path).toLowerCase() === path.resolve(run.git.worktreePath!).toLowerCase());
        if (!registered) {
            throw new Error(`Workflow worktree cleanup is blocked because the path is not a registered git worktree: ${run.git.worktreePath}`);
        }
        const worktreeStatus = gitLines(['status', '--porcelain'], run.git.worktreePath);
        if (worktreeStatus.length > 0) {
            throw new Error(`Workflow worktree cleanup is blocked because the worktree is not clean:\n${worktreeStatus.join('\n')}`);
        }
        git(['worktree', 'remove', run.git.worktreePath], run.git.originalCwd || run.cwd, 120000);
        run.git.mergeStatus = 'cleaned';
        new CodexWorkflowStore(run.cwd).saveRun(run);
        this.emitState('워크플로우 워크트리를 제거했습니다.');
    }

    private async executeRun(store: CodexWorkflowStore, run: WorkflowRun): Promise<void> {
        if (this.running) throw new Error('A Codex Workflow run is already in progress.');
        this.running = true;
        this.cancelled = false;
        this.currentRun = run;
        run.status = 'running';
        store.saveRun(run);
        store.appendEvent(run, 'run.started', { runtime: run.selectedRuntime, runKind: run.runKind });
        this.emitState('Codex 워크플로우가 시작되었습니다.');

        try {
            if (run.runKind === 'gitOperation') {
                await this.executeGitOperation(store, run);
                return;
            }
            const runtime = await this.ensureRuntime(run, run.cwd);
            await this.checkAuth(runtime, store, run);
            await this.ensureProjectDocumentCache(store, run, runtime);
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
                this.emitState('읽기 전용 요청이 완료되어 코딩/Git 단계는 생략되었습니다.');
                return;
            }

            await this.prepareGit(store, run);
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
                run.artifacts.finalSummary = `수정 시도 ${run.repairAttempts}회 후에도 QA가 실패했습니다.`;
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
                    summary: `이 워크플로우 작업의 변경 파일 ${changedFiles.length}개를 커밋합니다.`,
                    diff: run.artifacts.lastDiff,
                    validationHash: diffHash,
                    createdAt: new Date().toISOString(),
                });
                run.status = 'pendingCommitApproval';
                store.saveRun(run);
                this.emitState('QA를 통과했습니다. 커밋 승인이 필요합니다.');
            } else {
                run.status = 'completed';
                store.saveRun(run);
                this.emitState('Git 커밋 없이 워크플로우가 완료되었습니다.');
            }
        } catch (e: any) {
            if (this.cancelled) {
                run.status = 'cancelled';
            } else {
                run.status = 'blocked';
                run.artifacts.finalSummary = e?.message || String(e);
            }
            store.saveRun(run);
            this.emitState(run.artifacts.finalSummary || 'Codex 워크플로우가 차단되었습니다.');
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
            run.artifacts.finalSummary = 'Git 작업 차단: cwd가 Git 저장소 안에 있지 않습니다.';
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
        if (!branch || branch === 'HEAD') throw new Error('Git 작업 차단: detached HEAD는 지원하지 않습니다.');
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
            `Git 작업 점검 완료: ${root}`,
            `브랜치: ${branch}`,
            `HEAD: ${head}`,
            tracking ? `추적 브랜치: ${tracking} (로컬 ${counts.ahead}개 앞섬, 원격 ${counts.behind}개 앞섬)` : '추적 브랜치: 없음',
            `변경 파일: ${changedFiles.length}개`,
            conflictFiles.length > 0 ? `충돌 파일: ${conflictFiles.length}개` : '',
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
            run.git.lastError = `Git 작업 차단: 해결되지 않은 충돌 파일이 있습니다.\n${conflictFiles.join('\n')}`;
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
                summary: `${branch} 브랜치의 변경 파일 ${changedFiles.length}개를 커밋합니다.`,
                diff: gitOperationDiff(root),
                validationHash: diffHash,
                createdAt: new Date().toISOString(),
            });
            run.status = 'pendingCommitApproval';
            run.artifacts.gitPlan = `${summary}\n\n커밋 생성을 위해 Workflow App 승인이 필요합니다.`;
            run.artifacts.finalSummary = run.artifacts.gitPlan;
            store.saveRun(run);
            this.emitState('Git 작업이 커밋 승인을 기다리고 있습니다.');
            return;
        }

        if (remote && counts.ahead > 0) {
            run.approvals.pushRequired = true;
            upsertApproval(run, {
                id: `${run.id}:push`,
                runId: run.id,
                type: 'push',
                status: 'pending',
                summary: `${branch} 브랜치의 커밋 ${counts.ahead}개를 origin에 푸시합니다.`,
                validationHash: head,
                createdAt: new Date().toISOString(),
            });
            run.status = 'pendingPushApproval';
            run.artifacts.gitPlan = `${summary}\n\n푸시를 위해 Workflow App 승인이 필요합니다.`;
            run.artifacts.finalSummary = run.artifacts.gitPlan;
            store.saveRun(run);
            this.emitState('Git 작업이 푸시 승인을 기다리고 있습니다.');
            return;
        }

        run.status = 'completed';
        run.artifacts.finalSummary = `${summary}\n\n커밋이나 푸시가 필요하지 않습니다.`;
        store.saveRun(run);
        this.emitState('대기 중인 작업 없이 Git 작업이 완료되었습니다.');
    }

    private async executeSdkRun(store: CodexWorkflowStore, run: WorkflowRun): Promise<void> {
        const sandbox: SandboxKind = run.runKind === 'readOnly' || shouldSkipImplementation(run.userPrompt) ? 'readOnly' : 'workspaceWrite';
        if (sandbox === 'workspaceWrite') await this.prepareGit(store, run);
        const runtime = await this.ensureRuntime(run, run.git.workCwd || run.cwd);
        store.upsertStage(run, { id: 'sdk-run', role: 'sdk', status: 'running', startedAt: new Date().toISOString(), inputSummary: run.userPrompt.slice(0, 300) });
        const prompt = sandbox === 'readOnly'
            ? `이 Codex Workflow 읽기 전용 요청에 직접 답하세요.\n\n사용자 요청:\n${run.userPrompt}\n\n파일을 수정하지 마세요. 반드시 필요한 경우가 아니면 shell command를 실행하지 마세요. 사용자가 정확한 문구만 요구했다면 그 문구만 반환하세요. 답변과 요약은 한국어로 작성하세요.`
            : `Run this Codex Workflow automation task using the SDK runtime.\n\nUser request:\n${run.userPrompt}\n\nReturn a concise Korean summary of work, checks, and remaining risk.`;
        let lockHandle: WorkflowWriterLockHandle | undefined;
        let result: CodexTurnResult;
        try {
            if (sandbox === 'workspaceWrite') {
                lockHandle = startWorkflowWriterLock({
                    runId: run.id,
                    cwd: workflowLockRoot(run),
                    workCwd: run.git.workCwd || run.cwd,
                    branch: run.git.branch,
                    role: 'sdk',
                    stageId: 'sdk-run',
                    pid: process.pid,
                }, workflowLockRoot(run));
                store.appendEvent(run, 'git.writerLock.created', { role: 'sdk', stageId: 'sdk-run', workCwd: run.git.workCwd || run.cwd, branch: run.git.branch });
            }
            result = await runtime.runStandalone!(prompt, {
                cwd: run.git.workCwd || run.cwd,
                approvalPolicy: run.approvalPolicy || 'never',
                sandbox,
            });
        } finally {
            if (lockHandle) {
                lockHandle.stop();
                store.appendEvent(run, 'git.writerLock.released', { role: 'sdk', stageId: 'sdk-run' });
            }
        }
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
                    summary: `SDK 워크플로우 작업의 변경 파일 ${changedFiles.length}개를 커밋합니다.`,
                    diff: gitSafe(['diff', '--stat'], run.git.workCwd) || result.diff,
                    validationHash: diffHash,
                    createdAt: new Date().toISOString(),
                });
                run.status = 'pendingCommitApproval';
                store.saveRun(run);
                this.emitState('SDK 워크플로우가 파일 변경과 함께 완료되었습니다. 커밋 승인이 필요합니다.');
                return;
            }
        }
        run.status = failed ? 'failed' : 'completed';
        store.saveRun(run);
        this.emitState(failed ? 'SDK 워크플로우 실패.' : 'SDK 워크플로우 완료.');
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
            run.artifacts.finalSummary = 'Codex 로그인이 필요합니다. Codex 앱/CLI에서 로그인한 뒤 이 워크플로우를 재개하세요.';
            store.saveRun(run);
            throw new Error(run.artifacts.finalSummary);
        }
    }

    private async ensureProjectDocumentCache(store: CodexWorkflowStore, run: WorkflowRun, runtime: CodexRuntimeAdapter): Promise<void> {
        const roles = plannedRolesForRun(run).filter(role => CODEX_WORKFLOW_ROLES.includes(role as CodexWorkflowRole));
        if (roles.length === 0) return;
        try {
            store.appendEvent(run, 'documents.cache.started', { roles });
            await rebuildDocumentCache(run.cwd, (prompt, purpose) => this.runDocsAgentText(runtime, run, prompt, purpose), roles);
            store.appendEvent(run, 'documents.cache.completed', { roles });
        } catch (e: any) {
            const message = e?.message || String(e);
            store.appendEvent(run, 'documents.cache.failed', { error: message });
            this.emitLog(`document cache skipped: ${message}`);
            if (blocksOnDocumentCache(run)) {
                run.status = 'blocked';
                run.artifacts.finalSummary = `프로젝트 문서 요약 캐시 생성 실패로 code-changing run을 차단했습니다.\n${message}`;
                store.saveRun(run);
                throw new Error(run.artifacts.finalSummary);
            }
        }
    }

    private async runDocsAgentText(runtime: CodexRuntimeAdapter, run: WorkflowRun, prompt: string, purpose: string): Promise<string> {
        const rolePrompt = this.withRole('docs-agent', `${prompt}\n\nPurpose: ${purpose}`);
        const cwd = run.git.workCwd || run.cwd;
        const timeoutMs = 20 * 60 * 1000;
        if (runtime.runStandalone) {
            const result = await runtime.runStandalone(rolePrompt, {
                cwd,
                approvalPolicy: 'never',
                sandbox: 'readOnly',
                ...(this.codexModel ? { model: this.codexModel } : {}),
            }, timeoutMs);
            if (result.status === 'failed' || result.error) throw new Error(result.error || 'docs-agent cache summary failed.');
            return result.text || '';
        }
        const thread = await runtime.startThread({
            cwd,
            approvalPolicy: 'never',
            sandbox: 'read-only',
            serviceName: 'haram_ai_agent_doc_cache',
            ...(this.codexModel ? { model: this.codexModel } : {}),
        });
        const threadId = thread?.thread?.id;
        if (!threadId) throw new Error('Failed to start docs-agent cache thread.');
        const result = await runtime.runTurn({
            threadId,
            cwd,
            approvalPolicy: 'never',
            sandboxPolicy: sandboxPolicy('readOnly', cwd),
            settings: { developer_instructions: this.readRoleInstructions('docs-agent') },
            ...(this.codexModel ? { model: this.codexModel } : {}),
            input: [{ type: 'text', text: rolePrompt }],
        }, timeoutMs);
        if (result.status === 'failed' || result.error) throw new Error(result.error || 'docs-agent cache summary failed.');
        return result.text || '';
    }

    private async runStage(store: CodexWorkflowStore, run: WorkflowRun, stageId: string, role: CodexWorkflowRole, sandbox: SandboxKind, prompt: string): Promise<CodexTurnResult> {
        this.assertNotCancelled();
        store.upsertStage(run, { id: stageId, role, status: 'running', startedAt: new Date().toISOString(), inputSummary: prompt.slice(0, 300) });
        store.updateAgent(run, role, { status: 'running', lastError: undefined });
        this.emitState(`${role} running: ${stageId}`);

        let lockHandle: WorkflowWriterLockHandle | undefined;
        try {
            const threadId = await this.prepareThread(run, role, sandbox);
            const runtime = await this.ensureRuntime(run, run.git.workCwd || run.cwd);
            const roleInstructions = this.readRoleInstructions(role);
            if (sandbox === 'workspaceWrite') {
                lockHandle = startWorkflowWriterLock({
                    runId: run.id,
                    cwd: workflowLockRoot(run),
                    workCwd: run.git.workCwd || run.cwd,
                    branch: run.git.branch,
                    role,
                    stageId,
                    pid: process.pid,
                }, workflowLockRoot(run));
                store.appendEvent(run, 'git.writerLock.created', {
                    role,
                    stageId,
                    workCwd: run.git.workCwd || run.cwd,
                    branch: run.git.branch,
                });
            }
            const result = await runtime.runTurn({
                threadId,
                input: [{ type: 'text', text: prompt }],
                cwd: run.git.workCwd || run.cwd,
                approvalPolicy: 'never',
                sandboxPolicy: sandboxPolicy(sandbox, run.git.workCwd || run.cwd, role === 'web-researcher'),
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
        } finally {
            if (lockHandle) {
                lockHandle.stop();
                store.appendEvent(run, 'git.writerLock.released', { role, stageId });
            }
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
            ...(role === 'web-researcher' ? { config: webResearchConfig() } : {}),
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

    private async prepareGit(store: CodexWorkflowStore, run: WorkflowRun): Promise<void> {
        const cwd = run.cwd;
        const isRepo = gitSafe(['rev-parse', '--show-toplevel'], cwd) !== null;
        run.git.isRepo = isRepo;
        run.git.originalCwd = cwd;
        run.git.workCwd = cwd;
        run.git.routingDecision = 'none';
        if (!isRepo) {
            store.saveRun(run);
            return;
        }

        const originalBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
        const branchType = workflowBranchType(run);
        const branchScope = workflowBranchScope(run);
        const branch = workflowBranchName(run);
        run.git.originalBranch = originalBranch;
        run.git.branch = branch;
        run.git.branchType = branchType;
        run.git.branchScope = branchScope;
        run.git.routingPreference = run.git.routingPreference || 'auto';

        if (scopeNeedsConfirmation(branchScope)) {
            this.blockGitRouting(store, run, `브랜치 scope가 너무 일반적입니다: ${branchScope}. 기능/도메인/소유 경계를 드러내는 짧은 kebab-case scope로 사용자 확인이 필요합니다.`);
            throw new Error(run.git.routingBlockedReason);
        }

        const preflight = await runGitRoutingPreflight(cwd, {
            branch,
            branchType,
            branchScope,
            workCwd: run.git.workCwd || cwd,
            currentRunId: run.id,
        });
        const statusLines = preflight.statusPorcelain;
        const dirty = preflight.dirtyPaths.length > 0;
        run.git.dirty = dirty;
        run.git.changedFiles = preflight.dirtyPaths;
        run.git.laneVerdict = preflight.laneVerdict;
        run.git.activeLocks = preflight.activeLocks;
        run.git.staleLocks = preflight.staleLocks;
        run.git.diffStability = preflight.diffStability;
        run.git.preflightSummary = preflight.summary;
        run.git.preflightWarnings = preflight.warnings;
        if (preflight.blockedReason) {
            this.blockGitRouting(store, run, preflight.blockedReason);
            throw new Error(run.git.routingBlockedReason);
        }

        const worktrees = parseWorktrees(preflight.worktreePorcelain);
        store.appendEvent(run, 'git.routing.inspected', {
            branch,
            branchType,
            branchScope,
            status: statusLines,
            diffNameStatus: preflight.diffNameStatus,
            cachedDiffNameStatus: preflight.cachedDiffNameStatus,
            laneVerdict: preflight.laneVerdict,
            diffStability: preflight.diffStability,
            activeLocks: preflight.activeLocks.length,
            staleLocks: preflight.staleLocks.length,
            warnings: preflight.warnings,
            worktrees: worktrees.map(w => ({ path: w.path, branch: w.branch })),
        });

        const existingBranch = branchExists(cwd, branch);
        const existingWorktree = worktrees.find(w => w.branch === branch);
        const baseRef = routingBaseRef(cwd, originalBranch);
        const uniqueCommits = existingBranch ? uniqueCommitCount(cwd, baseRef, branch) : 0;
        const worktreePath = codexWorktreePath(cwd, branchType, branchScope);
        const forceWorktree = run.git.routingPreference === 'force-worktree' || this.options.alwaysUseWorktree;
        const hasActiveWriterLock = preflight.activeLocks.length > 0;

        if (existingWorktree) {
            const activeLockOnWorktree = preflight.activeLocks.some(lock => path.resolve(lock.workCwd || '').toLowerCase() === path.resolve(existingWorktree.path).toLowerCase());
            if (activeLockOnWorktree) {
                this.blockGitRouting(store, run, `${branch} worktree 재사용 차단: 해당 worktree에 active writer lock이 있습니다. 사용자 확인이 필요합니다.`);
                throw new Error(run.git.routingBlockedReason);
            }
            const clean = gitLines(['status', '--porcelain'], existingWorktree.path).length === 0;
            run.git.reuseCandidate = { branch, worktreePath: existingWorktree.path, clean, uniqueCommits };
            if (!clean || uniqueCommits > 0) {
                const reason = `${branch} worktree 재사용 차단: ${!clean ? 'worktree가 dirty 상태입니다' : `base branch에 없는 unique commit ${uniqueCommits}개가 있습니다`}. 자동 suffix는 만들지 않으며 사용자 확인이 필요합니다.`;
                this.blockGitRouting(store, run, reason);
                throw new Error(run.git.routingBlockedReason);
            }
            run.git.routingDecision = 'reuse-worktree';
            run.git.worktreePath = existingWorktree.path;
            run.git.workCwd = existingWorktree.path;
            store.saveRun(run);
            return;
        }

        if (existingBranch) {
            run.git.reuseCandidate = { branch, clean: true, uniqueCommits };
            if (uniqueCommits > 0) {
                this.blockGitRouting(store, run, `${branch} branch 재사용 차단: base branch에 없는 unique commit ${uniqueCommits}개가 있습니다. 자동 suffix는 만들지 않으며 사용자 확인이 필요합니다.`);
                throw new Error(run.git.routingBlockedReason);
            }
            const targetIsCurrentBranch = originalBranch === branch;
            const canReuseCurrentBranch = targetIsCurrentBranch && !forceWorktree && !hasActiveWriterLock && (!dirty || preflight.laneVerdict === 'same-lane');
            if (canReuseCurrentBranch) {
                run.git.routingDecision = 'reuse-branch';
                run.git.workCwd = cwd;
                store.saveRun(run);
                return;
            }
            if (targetIsCurrentBranch) {
                const reason = `${branch} branch는 현재 작업트리에 checkout되어 있지만 현재 트리 사용이 안전하다고 증명되지 않았습니다. 자동 suffix 없이 사용자 확인이 필요합니다.`;
                this.blockGitRouting(store, run, reason);
                throw new Error(run.git.routingBlockedReason);
            }
            await this.addExistingBranchWorktree(store, run, branch, worktreePath);
            return;
        }

        const canUseCurrentTree = !forceWorktree && !hasActiveWriterLock && (!dirty || preflight.laneVerdict === 'same-lane');
        if (!canUseCurrentTree) {
            if (fs.existsSync(worktreePath)) {
                this.blockGitRouting(store, run, `worktree 경로가 이미 존재합니다: ${worktreePath}. 자동 suffix는 만들지 않으며 사용자 확인이 필요합니다.`);
                throw new Error(run.git.routingBlockedReason);
            }
            await this.withGitRoutingMutex(store, run, () => {
                fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
                git(['worktree', 'add', '-b', branch, worktreePath, baseRef], cwd, 120000);
            });
            run.git.routingDecision = 'new-worktree';
            run.git.worktreePath = worktreePath;
            run.git.workCwd = worktreePath;
        } else {
            await this.withGitRoutingMutex(store, run, () => {
                git(['switch', '-c', branch], cwd, 60000);
            });
            run.git.routingDecision = 'current-branch';
            run.git.workCwd = cwd;
        }
        store.saveRun(run);
    }

    private async addExistingBranchWorktree(store: CodexWorkflowStore, run: WorkflowRun, branch: string, worktreePath: string): Promise<void> {
        if (fs.existsSync(worktreePath)) {
            this.blockGitRouting(store, run, `worktree 경로가 이미 존재합니다: ${worktreePath}. 자동 suffix는 만들지 않으며 사용자 확인이 필요합니다.`);
            throw new Error(run.git.routingBlockedReason);
        }
        await this.withGitRoutingMutex(store, run, () => {
            fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
            git(['worktree', 'add', worktreePath, branch], run.cwd, 120000);
        });
        run.git.routingDecision = 'reuse-branch';
        run.git.worktreePath = worktreePath;
        run.git.workCwd = worktreePath;
        store.saveRun(run);
    }

    private async withGitRoutingMutex(store: CodexWorkflowStore, run: WorkflowRun, action: () => void): Promise<void> {
        const lockRoot = workflowLockRoot(run);
        let handle: GitRoutingMutexHandle | undefined;
        try {
            handle = await acquireGitRoutingMutex(lockRoot, run.id, 5000);
        } catch (e: any) {
            const reason = e?.message || String(e);
            run.git.routingLock = { active: true, ownerRunId: run.id, reason };
            this.blockGitRouting(store, run, reason);
            throw new Error(run.git.routingBlockedReason);
        }
        run.git.routingLock = { active: true, ownerRunId: handle.lock.runId, updatedAt: handle.lock.updatedAt };
        store.saveRun(run);
        store.appendEvent(run, 'git.routing.lock.acquired', { runId: run.id, cwd: lockRoot });
        try {
            action();
        } finally {
            handle.release();
            run.git.routingLock = { active: false, ownerRunId: run.id, updatedAt: new Date().toISOString() };
            store.saveRun(run);
            store.appendEvent(run, 'git.routing.lock.released', { runId: run.id, cwd: lockRoot });
        }
    }

    private blockGitRouting(store: CodexWorkflowStore, run: WorkflowRun, reason: string): void {
        run.git.routingDecision = 'blocked';
        run.git.routingBlockedReason = reason;
        run.git.lastError = reason;
        run.status = 'blocked';
        run.artifacts.finalSummary = reason;
        store.saveRun(run);
        store.appendEvent(run, 'git.routing.blocked', { reason, branch: run.git.branch });
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
        return this.withRole(role, `${implementationMission(role)}\n\nUser request:\n${run.userPrompt}\n\nDocs summary:\n${run.artifacts.docsSummary || ''}\n\nWeb research summary:\n${run.artifacts.webResearchSummary || ''}\n\nGit plan:\n${run.artifacts.gitPlan || ''}\n\nDo not commit or push. Keep edits scoped to your role. If another specialist should answer a question before you continue, include an AGENT_REQUESTS JSON block like [{"toRole":"docs-agent","question":"..."}]. After your work, summarize changed files, behavior changes, and commands run in Korean.`);
    }

    private repairPrompt(run: WorkflowRun, role: CodexWorkflowRole, qa: CodexTurnResult): string {
        return this.withRole(role, `Repair the implementation area owned by ${role} based on QA feedback.\n\nUser request:\n${run.userPrompt}\n\nQA feedback:\n${qa.text || qa.error || ''}\n\nCurrent implementation summaries:\n${implementationSummaryBlock(run)}\n\nDo not commit or push. Keep the fix scoped to your role and summarize changed files in Korean.`);
    }

    private agentRequestPrompt(run: WorkflowRun, fromRole: CodexWorkflowRole, question: string): string {
        return `Another workflow agent (${fromRole}) requested information for this run.\n\nUser request:\n${run.userPrompt}\n\nQuestion:\n${question}\n\nAnswer concisely in Korean. Do not edit files.`;
    }

    private agentRequestFollowupPrompt(run: WorkflowRun, role: CodexWorkflowRole, answers: string): string {
        return this.withRole(role, `Continue your assigned work using these agent handoff answers.\n\nUser request:\n${run.userPrompt}\n\nAgent answers:\n${answers}\n\nApply any needed scoped changes for ${role}. Do not commit or push. Summarize changed files in Korean.`);
    }

    private qaPrompt(run: WorkflowRun): string {
        return this.withRole('qa-agent', `Verify the current implementation for this request:\n${run.userPrompt}\n\nAssigned agents:\n${(run.artifacts.assignedRoles || []).join(', ')}\n\nImplementation summaries:\n${implementationSummaryBlock(run)}\n\nRun the most relevant available checks, starting with npm run compile when present. Do not edit source files. Include command names and exit evidence. End with exactly one line: QA_STATUS: PASS or QA_STATUS: FAIL, followed by concise Korean evidence.`);
    }

    private docPrompt(run: WorkflowRun): string {
        return this.withRole('doc-writer', `Summarize the completed work for handoff.\n\nUser request:\n${run.userPrompt}\n\nAssigned agents:\n${(run.artifacts.assignedRoles || []).join(', ')}\n\nWeb research summary:\n${run.artifacts.webResearchSummary || ''}\n\nImplementation summaries:\n${implementationSummaryBlock(run)}\n\nQA summary:\n${run.artifacts.qaSummary || ''}\n\nReturn Korean release notes with changed behavior, verification, and any remaining risk. Do not edit files.`);
    }

    private withRole(role: CodexWorkflowRole, body: string): string {
        const documentContext = this.currentRun ? this.projectDocumentContext(this.currentRun, role) : '';
        return `[Codex custom agent role: ${role}]\n${this.readRoleInstructions(role)}\n\n${body}${documentContext ? `\n\n${documentContext}` : ''}`;
    }

    private projectDocumentContext(run: WorkflowRun, role: CodexWorkflowRole): string {
        try {
            return agentDocumentContext(run.cwd, role);
        } catch (e: any) {
            this.emitLog(`document context unavailable for ${role}: ${e?.message || e}`);
            return '';
        }
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

function sandboxPolicy(kind: SandboxKind, cwd: string, networkAccess = false): any {
    if (kind === 'readOnly') {
        return { type: 'readOnly', networkAccess };
    }
    return { type: 'workspaceWrite', writableRoots: [cwd], networkAccess, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
}

function workflowLockRoot(run: WorkflowRun): string {
    return gitRepositoryLockRoot(run.git.originalCwd || run.cwd);
}

function webResearchConfig(): any {
    return {
        web_search: 'live',
        tools: {
            web_search: {
                context_size: 'medium',
                allowed_domains: null,
                location: null,
            },
            view_image: null,
        },
    };
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

export function plannedRolesForRun(run: WorkflowRun): string[] {
    if (Array.isArray(run.artifacts.assignedRoles) && run.artifacts.assignedRoles.length > 0) {
        return run.artifacts.assignedRoles;
    }
    if (run.runKind === 'gitOperation') return ['git-manager'];
    if (run.runKind === 'automation') return ['sdk-runtime'];
    const needsResearch = shouldRunWebResearch(run.userPrompt || run.prompt || '');
    if (run.runKind === 'readOnly') {
        return assignedRolesForRun(run, needsResearch, []);
    }
    return assignedRolesForRun(run, needsResearch, selectImplementationRoles(run));
}

function blocksOnDocumentCache(run: WorkflowRun): boolean {
    return run.runKind !== 'readOnly' && run.runKind !== 'automation';
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

function workflowBranchName(run: WorkflowRun): string {
    return `codex/${workflowBranchType(run)}/${workflowBranchScope(run)}`;
}

function workflowBranchScope(run: WorkflowRun): string {
    return inferBranchScope(run.userPrompt || run.prompt || '');
}

function workflowBranchType(run: WorkflowRun): string {
    if (run.runKind === 'gitOperation') return 'chore';
    const text = `${run.runKind || ''}\n${run.userPrompt || run.prompt || ''}`.toLowerCase();
    if (/(docs?|document|readme|guide|changelog|process|rule|rules|문서|가이드|규칙|프로세스)/i.test(text) && !/(code|implement|기능|구현)/i.test(text)) return 'docs';
    if (/(test|fixture|qa\s*harness|harness|spec|테스트|fixture)/i.test(text)) return 'test';
    if (/(research|analy[sz]e|investigate|official|external|data collection|조사|분석|연구|공식|외부|수집)/i.test(text)) return 'research';
    if (/(spike|experiment|prototype|proof|검증\s*실험|방향\s*검증|임시\s*실험|실험)/i.test(text)) return 'spike';
    if (/(deploy|runtime|operation|ops|backfill|collector|script|배포|런타임|운영|수집|백필|스크립트)/i.test(text)) return 'ops';
    if (/(setup|install|diagnostic|cleanup|metadata|chore|설치|진단|정리|메타)/i.test(text) || (/(config|설정)/i.test(text) && !/(feature|기능|추가|검색|search)/i.test(text))) return 'chore';
    if (/(refactor|restructure|structure|cleanup code|동작\s*유지|구조\s*개선|리팩터|리팩토)/i.test(text)) return 'refactor';
    if (/(fix|bug|regression|error|crash|fail|repair|hotfix|버그|회귀|오류|에러|실패|고장|해결)/i.test(text)) return 'fix';
    return 'feat';
}

function inferBranchScope(prompt: string): string {
    const text = prompt.toLowerCase();
    const patterns: Array<[RegExp, string]> = [
        [/bge[-_\s]?m3/i, 'bge-m3'],
        [/(setting|settings|설정).*(search|검색)|(search|검색).*(setting|settings|설정)/i, 'setting-search'],
        [/(homework|숙제)/i, 'homework'],
        [/(orchestrator|orchestration|오케스트레이터)/i, 'orchestrator'],
        [/(combat|전투).*(power|력)|(power|력).*(combat|전투)/i, 'combat-power'],
        [/(frontend|front-end|front\s*end|프론트)/i, 'frontend'],
        [/(backend|back-end|back\s*end|백엔드)/i, 'backend'],
        [/(deploy|deployment|배포)/i, 'deploy'],
        [/(workflow|워크플로우)/i, 'workflow'],
        [/(document|docs|문서)/i, 'docs'],
        [/(git|깃|커밋|푸시|브랜치|워크트리)/i, 'repo'],
        [/(setup|install|config|설치|설정|정리)/i, 'repo'],
    ];
    for (const [pattern, scope] of patterns) {
        if (pattern.test(text)) return scope;
    }
    const ascii = text
        .replace(/[^a-z0-9\s_-]+/g, ' ')
        .split(/[\s_-]+/)
        .map(token => token.trim())
        .filter(Boolean)
        .filter(token => !BRANCH_SCOPE_STOPWORDS.has(token))
        .slice(0, 3)
        .join('-');
    return safeBranchScope(ascii || 'task');
}

function safeBranchScope(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'task';
}

function scopeNeedsConfirmation(scope: string): boolean {
    return !scope || ['task', 'temp', 'wip', 'misc', 'update', 'fixes', 'work', 'test2'].includes(scope) || /^\d+$/.test(scope) || /\d{8}/.test(scope);
}

const BRANCH_SCOPE_STOPWORDS = new Set([
    'add', 'change', 'update', 'fix', 'repair', 'implement', 'create', 'build', 'make', 'work',
    'task', 'temp', 'wip', 'misc', 'test', 'tests', 'feature', 'bug', 'issue', 'code', 'run',
    'codex', 'workflow', 'app', 'please', 'the', 'and', 'for', 'with', 'to', 'of',
]);

interface GitWorktreeInfo {
    path: string;
    branch?: string;
}

function parseWorktrees(output: string): GitWorktreeInfo[] {
    const worktrees: GitWorktreeInfo[] = [];
    let current: GitWorktreeInfo | null = null;
    for (const line of output.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
            if (current) worktrees.push(current);
            current = { path: line.slice('worktree '.length).trim() };
        } else if (current && line.startsWith('branch ')) {
            current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '').trim();
        }
    }
    if (current) worktrees.push(current);
    return worktrees;
}

function branchExists(cwd: string, branch: string): boolean {
    return gitSafe(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], cwd) !== null;
}

function routingBaseRef(cwd: string, originalBranch: string): string {
    if (gitSafe(['rev-parse', '--verify', 'master'], cwd)) return 'master';
    if (gitSafe(['rev-parse', '--verify', 'main'], cwd)) return 'main';
    return originalBranch || 'HEAD';
}

function uniqueCommitCount(cwd: string, baseRef: string, branch: string): number {
    const raw = gitSafe(['rev-list', '--count', `${baseRef}..${branch}`], cwd);
    const count = Number((raw || '').trim());
    return Number.isFinite(count) ? count : 0;
}

function codexWorktreePath(cwd: string, branchType: string, branchScope: string): string {
    const parent = path.dirname(cwd);
    const base = path.basename(cwd);
    return path.join(parent, `${base}-worktrees`, `${branchType}-${branchScope}`);
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
    const staged = gitSafe(['diff', '--cached', '--binary'], cwd) || '';
    return crypto.createHash('sha256').update(`${status}\n${diff}\n${staged}`).digest('hex');
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
