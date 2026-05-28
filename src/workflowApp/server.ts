import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { URL } from 'url';
import {
    CodexWorkflowController,
    CodexWorkflowEvent,
    plannedRolesForRun,
} from '../workflowCore/engine';
import {
    AgentState,
    ApprovalRequest,
    CodexContextMode,
    CodexRuntime,
    CodexWorkflowStore,
    StageState,
    WorkflowGitState,
    WorkflowRun,
    WorkflowRunKind,
} from '../workflowCore/store';
import { isSdkRuntimeAvailable } from '../workflowCore/runtimeAdapter';
import { probeCodexExecutable, resolveCodexExecutable } from '../workflowCore/codexAppServerClient';
import { workflowAppHtml } from './ui';

export interface WorkflowAppServerOptions {
    host?: string;
    port?: number;
    projectRoot: string;
    codexExecutablePath?: string;
    maxActiveRuns?: number;
}

export interface WorkflowAppConfig {
    projectRoot?: string;
    codexExecutablePath?: string;
    port?: number;
}

export interface DiagnosticCheck {
    id: string;
    label: string;
    status: 'ok' | 'warn' | 'fail' | 'unknown';
    detail: string;
    remediation?: string;
}

interface RegistryEntry {
    id: string;
    cwd: string;
    createdAt: string;
    updatedAt: string;
}

interface QueuedRun {
    id: string;
    cwd: string;
    contextMode: CodexContextMode;
    priority: number;
    runKind: WorkflowRunKind;
}

type WsSocket = import('stream').Duplex;

const TERMINAL = new Set(['completed', 'failed', 'blocked', 'cancelled']);
const WAITING_FOR_APPROVAL = new Set(['pendingCommitApproval', 'pendingPushApproval']);
const AUTH_COOKIE_NAME = 'codex_workflow_token';

interface WorkflowRunSummary {
    id: string;
    source?: string;
    cwd: string;
    prompt?: string;
    userPrompt: string;
    status: WorkflowRun['status'];
    priority?: number;
    runtime: CodexRuntime;
    selectedRuntime?: WorkflowRun['selectedRuntime'];
    runKind: WorkflowRunKind;
    approvalPolicy?: string;
    mcpSource?: string;
    createdAt: string;
    updatedAt: string;
    contextMode: CodexContextMode;
    pendingApprovalCount: number;
    assignedRolesPreview: string[];
    stages: Array<Pick<StageState, 'id' | 'role' | 'status' | 'outputSummary' | 'error'>>;
    agents: Record<string, Pick<AgentState, 'role' | 'status' | 'threadId'>>;
    git: Pick<WorkflowGitState, 'isRepo' | 'originalCwd' | 'workCwd' | 'branch' | 'worktreePath' | 'dirty' | 'changedFiles' | 'conflictFiles' | 'commitHash' | 'pushRemote' | 'pushBranch' | 'diffHash' | 'mergeStatus' | 'lastError'>;
    artifacts: Pick<WorkflowRun['artifacts'], 'assignedRoles' | 'finalSummary'>;
}

export class WorkflowAppServer {
    private server: http.Server;
    private sockets = new Set<WsSocket>();
    private controllers = new Map<string, CodexWorkflowController>();
    private active = new Set<string>();
    private waiting = new Set<string>();
    private queue: QueuedRun[] = [];
    private repoWriteLocks = new Map<string, string>();
    private registryPath: string;
    private registry: RegistryEntry[] = [];
    private host: string;
    private port: number;
    private maxActiveRuns: number;
    private authToken: string;
    private defaultRuntime: CodexRuntime;
    private codexExecutablePath?: string;
    private config: WorkflowAppConfig;

    constructor(private readonly options: WorkflowAppServerOptions) {
        this.config = readWorkflowAppConfig();
        this.host = options.host || '127.0.0.1';
        this.port = options.port || Number(process.env.CODEX_WORKFLOW_PORT || this.config.port || 48731);
        this.maxActiveRuns = options.maxActiveRuns || Number(process.env.CODEX_WORKFLOW_MAX_ACTIVE_RUNS || 3);
        this.authToken = process.env.CODEX_WORKFLOW_AUTH_TOKEN || loadOrCreateAuthToken();
        this.defaultRuntime = normalizeRuntime(process.env.CODEX_WORKFLOW_RUNTIME);
        this.codexExecutablePath = options.codexExecutablePath || process.env.CODEX_EXECUTABLE_PATH || this.config.codexExecutablePath;
        this.registryPath = path.join(workflowAppHome(), 'runs.json');
        this.registry = this.loadRegistry();
        this.restoreQueuedRuns();
        this.server = http.createServer((req, res) => void this.handleHttp(req, res));
        this.server.on('upgrade', (req, socket) => this.handleUpgrade(req, socket));
    }

    public listen(): Promise<void> {
        return new Promise(resolve => {
            this.server.listen(this.port, this.host, () => resolve());
        });
    }

    public close(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        return new Promise(resolve => this.server.close(() => resolve()));
    }

    public url(runId?: string): string {
        return `http://${this.host}:${this.port}/${runId ? `#${encodeURIComponent(runId)}` : ''}`;
    }

    private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const url = new URL(req.url || '/', `http://${req.headers.host || `${this.host}:${this.port}`}`);
            const method = req.method || 'GET';
            if (method === 'OPTIONS') return this.empty(res);
            if (this.requiresAuth(method, url.pathname) && !this.isAuthorized(req, url)) {
                return this.json(res, { error: 'unauthorized' }, 401);
            }
            if (method === 'GET' && url.pathname === '/') return this.html(res, workflowAppHtml());
            if (method === 'GET' && url.pathname === '/api/health') {
                const executable = resolveCodexExecutable(this.codexExecutablePath);
                const probe = probeCodexExecutable(executable);
                return this.json(res, {
                    ok: true,
                    port: this.port,
                    activeRuns: this.active.size,
                    waitingRuns: this.waiting.size,
                    queuedRuns: this.queue.length,
                    registryEntries: this.registry.length,
                    runtimeSupport: {
                        defaultRuntime: this.defaultRuntime,
                        appServerAvailable: probe.ok,
                        sdkAvailable: isSdkRuntimeAvailable(),
                    },
                    sdkAvailable: isSdkRuntimeAvailable(),
                    appServerAvailable: probe.ok,
                    authenticated: this.isAuthorized(req, url),
                    codexExecutable: executable,
                });
            }
            if (method === 'GET' && url.pathname === '/api/diagnostics') {
                return this.json(res, this.buildDiagnostics(req, url));
            }
            if (method === 'GET' && url.pathname === '/api/runs') {
                const status = url.searchParams.get('status') || '';
                const runs = this.listRuns().filter(r => !status || r.status === status);
                return this.json(res, runs.map(run => this.toRunSummary(run)));
            }
            if (method === 'POST' && url.pathname === '/api/runs') {
                const body = await readJson(req);
                const run = this.createRun(body);
                return this.json(res, { runId: run.id, url: this.url(run.id), run }, 201);
            }
            const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
            if (method === 'GET' && runMatch) {
                const run = this.readRun(decodeURIComponent(runMatch[1]));
                if (!run) return this.json(res, { error: 'run not found' }, 404);
                return this.json(res, run);
            }
            const eventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
            if (method === 'GET' && eventsMatch) {
                const run = this.requireRun(decodeURIComponent(eventsMatch[1]));
                const limit = Number(url.searchParams.get('limit') || 500);
                return this.json(res, new CodexWorkflowStore(run.cwd).readEvents(run.id, limit));
            }
            const resumeMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/resume$/);
            if (method === 'POST' && resumeMatch) {
                const run = this.requireRun(decodeURIComponent(resumeMatch[1]));
                this.startExistingRun(run, run.contextMode || 'resume');
                return this.json(res, { ok: true, runId: run.id });
            }
            const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
            if (method === 'POST' && cancelMatch) {
                const run = this.requireRun(decodeURIComponent(cancelMatch[1]));
                await this.cancelRun(run);
                return this.json(res, { ok: true, runId: run.id });
            }
            const compactMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/agents\/([^/]+)\/compact$/);
            if (method === 'POST' && compactMatch) {
                const run = this.requireRun(decodeURIComponent(compactMatch[1]));
                const controller = this.controllerFor(run.cwd, run.id);
                controller.attachRun(run);
                await controller.compactAgent(decodeURIComponent(compactMatch[2]));
                return this.json(res, { ok: true });
            }
            const resetMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/agents\/([^/]+)\/reset$/);
            if (method === 'POST' && resetMatch) {
                const run = this.requireRun(decodeURIComponent(resetMatch[1]));
                const controller = this.controllerFor(run.cwd, run.id);
                controller.attachRun(run);
                controller.resetAgent(decodeURIComponent(resetMatch[2]));
                return this.json(res, { ok: true });
            }
            const cleanupMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/worktree\/cleanup$/);
            if (method === 'POST' && cleanupMatch) {
                const run = this.requireRun(decodeURIComponent(cleanupMatch[1]));
                const controller = this.controllerFor(run.cwd, run.id);
                controller.attachRun(run);
                controller.cleanupWorktree();
                return this.json(res, { ok: true, runId: run.id });
            }
            const mergeBackMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/worktree\/merge-back$/);
            if (method === 'POST' && mergeBackMatch) {
                const run = this.requireRun(decodeURIComponent(mergeBackMatch[1]));
                const controller = this.controllerFor(run.cwd, run.id);
                controller.attachRun(run);
                await controller.requestMergeBackApproval();
                const updated = this.requireRun(run.id);
                this.broadcast('run.updated', updated);
                return this.json(res, { ok: true, runId: run.id });
            }
            const approveMatch = url.pathname.match(/^\/api\/approvals\/(.+)\/approve$/);
            if (method === 'POST' && approveMatch) {
                const found = this.findApproval(decodeURIComponent(approveMatch[1]));
                if (!found) return this.json(res, { error: 'approval not found' }, 404);
                await this.approve(found.run, found.approval);
                return this.json(res, { ok: true, runId: found.run.id });
            }
            const rejectMatch = url.pathname.match(/^\/api\/approvals\/(.+)\/reject$/);
            if (method === 'POST' && rejectMatch) {
                const found = this.findApproval(decodeURIComponent(rejectMatch[1]));
                if (!found) return this.json(res, { error: 'approval not found' }, 404);
                this.reject(found.run, found.approval);
                return this.json(res, { ok: true, runId: found.run.id });
            }
            this.json(res, { error: 'not found' }, 404);
        } catch (e: any) {
            this.json(res, { error: e?.message || String(e) }, 500);
        }
    }

    private createRun(body: any): WorkflowRun {
        const cwd = path.resolve(String(body?.cwd || process.cwd()));
        const prompt = String(body?.prompt || body?.userPrompt || '').trim();
        if (!prompt) throw new Error('prompt is required');
        const contextMode = normalizeContextMode(body?.contextMode);
        const priority = Number(body?.priority || 0);
        const runtime = normalizeRuntime(body?.runtime || this.defaultRuntime);
        const runKind = normalizeRunKind(body?.runKind);
        const approvalPolicy = typeof body?.approvalPolicy === 'string' ? body.approvalPolicy : undefined;
        const source = body?.source || 'codex-desktop';
        const mcpSource = body?.mcpSource || (source === 'codex-desktop' ? 'codex-workflow-mcp' : undefined);
        if (!this.canStartRun(cwd, runKind)) {
            const store = new CodexWorkflowStore(cwd);
            const run = store.createRun(prompt, contextMode, 2, { source, priority, runtime, runKind, approvalPolicy, mcpSource });
            run.status = 'queued';
            store.saveRun(run);
            this.enqueue({ id: run.id, cwd, contextMode, priority, runKind });
            this.registerRun(run);
            this.broadcast('run.created', run);
            return run;
        }
        const controller = this.controllerFor(cwd);
        const run = controller.startDetached(prompt, contextMode, { source, priority, runtime, runKind, approvalPolicy, mcpSource });
        this.controllers.set(run.id, controller);
        this.markActive(run);
        this.registerRun(run);
        this.broadcast('run.created', run);
        return run;
    }

    private startExistingRun(run: WorkflowRun, mode: CodexContextMode): void {
        if (this.active.has(run.id)) return;
        if (!this.canStartRun(run.cwd, run.runKind, run.id)) {
            run.status = 'queued';
            new CodexWorkflowStore(run.cwd).saveRun(run);
            if (!this.queue.some(q => q.id === run.id)) this.enqueue({ id: run.id, cwd: run.cwd, contextMode: mode, priority: run.priority || 0, runKind: run.runKind });
            this.broadcast('run.updated', run);
            return;
        }
        const controller = this.controllerFor(run.cwd, run.id);
        this.waiting.delete(run.id);
        this.markActive(run);
        void controller.resumeRun(run.id, mode);
        this.broadcast('run.updated', run);
    }

    private async cancelRun(run: WorkflowRun): Promise<void> {
        this.queue = this.queue.filter(q => q.id !== run.id);
        if (TERMINAL.has(run.status)) return;
        const controller = this.controllers.get(run.id);
        if (controller) await controller.cancel();
        run.status = 'cancelled';
        run.artifacts.finalSummary = 'Workflow cancelled by user.';
        new CodexWorkflowStore(run.cwd).saveRun(run);
        this.releaseRun(run.id);
        this.broadcast('run.updated', run);
        this.drainQueue();
    }

    private async approve(run: WorkflowRun, approval: ApprovalRequest): Promise<void> {
        const controller = this.controllerFor(run.cwd, run.id);
        controller.attachRun(run);
        this.waiting.delete(run.id);
        if (!this.active.has(run.id)) this.markActive(run);
        if (approval.type === 'commit') await controller.approveCommit();
        else if (approval.type === 'push') await controller.approvePush();
        else if (approval.type === 'merge-back') await controller.mergeBack();
        else throw new Error(`Unsupported approval type: ${approval.type}`);
        const updated = this.requireRun(run.id);
        this.broadcast('approval.resolved', approval);
        this.broadcast('run.updated', updated);
        this.drainQueue();
    }

    private reject(run: WorkflowRun, approval: ApprovalRequest): void {
        approval.status = 'rejected';
        approval.resolvedAt = new Date().toISOString();
        if (approval.type === 'push') {
            run.status = 'completed';
            run.artifacts.finalSummary = `${run.artifacts.finalSummary || ''}\nPush rejected by user. Commit was not pushed.`.trim();
        } else {
            run.status = 'cancelled';
            run.artifacts.finalSummary = `${approval.type} approval rejected by user.`;
        }
        new CodexWorkflowStore(run.cwd).saveRun(run);
        this.broadcast('approval.resolved', approval);
        this.broadcast('run.updated', run);
        this.releaseRun(run.id);
        this.drainQueue();
    }

    private controllerFor(cwd: string, runId?: string): CodexWorkflowController {
        if (runId && this.controllers.has(runId)) return this.controllers.get(runId)!;
        const controller = new CodexWorkflowController({
            extensionPath: this.options.projectRoot,
            workspaceRoot: cwd,
            codexExecutablePath: this.codexExecutablePath,
            defaultContextMode: 'fresh',
            maxRepairLoops: 2,
            alwaysUseWorktree: true,
            onUpdate: event => this.onControllerEvent(runId, event),
        });
        if (runId) this.controllers.set(runId, controller);
        return controller;
    }

    private onControllerEvent(runIdHint: string | undefined, event: CodexWorkflowEvent): void {
        const run = event.run || (runIdHint ? this.readRun(runIdHint) : null);
        if (event.message) this.broadcast('log.appended', { runId: run?.id || runIdHint, message: event.message });
        if (!run) return;
        this.registerRun(run);
        this.broadcast('run.updated', run);
        for (const stage of run.stages || []) this.broadcast('stage.updated', { runId: run.id, stage });
        for (const agent of Object.values(run.agents || {})) this.broadcast('agent.updated', { runId: run.id, agent });
        for (const approval of run.approvalRequests || []) {
            if (approval.status === 'pending') this.broadcast('approval.created', approval);
        }
        if (WAITING_FOR_APPROVAL.has(run.status)) {
            this.markWaiting(run);
            this.drainQueue();
            return;
        }
        if (TERMINAL.has(run.status)) {
            this.releaseRun(run.id);
            this.drainQueue();
        }
    }

    private drainQueue(): void {
        while (this.active.size < this.maxActiveRuns && this.queue.length > 0) {
            const index = this.queue.findIndex(q => this.canStartRun(q.cwd, q.runKind, q.id));
            if (index < 0) return;
            const next = this.queue.splice(index, 1)[0];
            const run = this.readRun(next.id);
            if (!run || run.status === 'cancelled') continue;
            this.startExistingRun(run, next.contextMode);
        }
    }

    private listRuns(): WorkflowRun[] {
        const runs = this.registry
            .map(entry => this.readRun(entry.id))
            .filter((run): run is WorkflowRun => !!run)
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        return runs;
    }

    private readRun(runId: string): WorkflowRun | null {
        const entry = this.registry.find(r => r.id === runId);
        if (!entry) return null;
        return new CodexWorkflowStore(entry.cwd).readRun(runId);
    }

    private requireRun(runId: string): WorkflowRun {
        const run = this.readRun(runId);
        if (!run) throw new Error(`run not found: ${runId}`);
        return run;
    }

    private findApproval(approvalId: string): { run: WorkflowRun; approval: ApprovalRequest } | null {
        for (const run of this.listRuns()) {
            const approval = (run.approvalRequests || []).find(a => a.id === approvalId);
            if (approval) return { run, approval };
        }
        return null;
    }

    private toRunSummary(run: WorkflowRun): WorkflowRunSummary {
        const agents = Object.fromEntries(Object.entries(run.agents || {}).map(([role, agent]) => [role, {
            role: agent.role,
            status: agent.status,
            threadId: agent.threadId,
        }])) as WorkflowRunSummary['agents'];
        return {
            id: run.id,
            source: run.source,
            cwd: run.cwd,
            prompt: run.prompt,
            userPrompt: run.userPrompt,
            status: run.status,
            priority: run.priority,
            runtime: run.runtime,
            selectedRuntime: run.selectedRuntime,
            runKind: run.runKind,
            approvalPolicy: run.approvalPolicy,
            mcpSource: run.mcpSource,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            contextMode: run.contextMode,
            pendingApprovalCount: (run.approvalRequests || []).filter(a => a.status === 'pending').length,
            assignedRolesPreview: plannedRolesForRun(run),
            stages: (run.stages || []).map(stage => ({
                id: stage.id,
                role: stage.role,
                status: stage.status,
                outputSummary: stage.outputSummary,
                error: stage.error,
            })),
            agents,
            git: {
                isRepo: run.git.isRepo,
                originalCwd: run.git.originalCwd,
                workCwd: run.git.workCwd,
                branch: run.git.branch,
                worktreePath: run.git.worktreePath,
                dirty: run.git.dirty,
                changedFiles: run.git.changedFiles?.slice(0, 100),
                conflictFiles: run.git.conflictFiles,
                commitHash: run.git.commitHash,
                pushRemote: run.git.pushRemote,
                pushBranch: run.git.pushBranch,
                diffHash: run.git.diffHash,
                mergeStatus: run.git.mergeStatus,
                lastError: run.git.lastError,
            },
            artifacts: {
                assignedRoles: run.artifacts.assignedRoles,
                finalSummary: run.artifacts.finalSummary,
            },
        };
    }

    private canStartRun(cwd: string, runKind: WorkflowRunKind, runId?: string): boolean {
        if (this.active.size >= this.maxActiveRuns) return false;
        const key = writeLockKey(cwd, runKind);
        if (!key) return true;
        const owner = this.repoWriteLocks.get(key);
        return !owner || owner === runId;
    }

    private markActive(run: WorkflowRun): void {
        this.active.add(run.id);
        const key = writeLockKey(run.cwd, run.runKind);
        if (key) this.repoWriteLocks.set(key, run.id);
    }

    private markWaiting(run: WorkflowRun): void {
        this.active.delete(run.id);
        this.releaseRepoLock(run.id);
        this.waiting.add(run.id);
    }

    private releaseRun(runId: string): void {
        this.active.delete(runId);
        this.waiting.delete(runId);
        this.releaseRepoLock(runId);
    }

    private releaseRepoLock(runId: string): void {
        for (const [key, owner] of Array.from(this.repoWriteLocks.entries())) {
            if (owner === runId) this.repoWriteLocks.delete(key);
        }
    }

    private registerRun(run: WorkflowRun): void {
        const now = new Date().toISOString();
        const existing = this.registry.find(r => r.id === run.id);
        if (existing) {
            existing.cwd = run.cwd;
            existing.updatedAt = run.updatedAt || now;
        } else {
            this.registry.push({ id: run.id, cwd: run.cwd, createdAt: run.createdAt || now, updatedAt: run.updatedAt || now });
        }
        this.saveRegistry();
    }

    private loadRegistry(): RegistryEntry[] {
        try {
            if (!fs.existsSync(this.registryPath)) return [];
            return JSON.parse(fs.readFileSync(this.registryPath, 'utf-8')) as RegistryEntry[];
        } catch {
            return [];
        }
    }

    private restoreQueuedRuns(): void {
        for (const entry of this.registry) {
            const run = new CodexWorkflowStore(entry.cwd).readRun(entry.id);
            if (run?.status === 'queued') {
                this.enqueue({ id: run.id, cwd: run.cwd, contextMode: run.contextMode || 'fresh', priority: run.priority || 0, runKind: run.runKind });
            } else if (run && WAITING_FOR_APPROVAL.has(run.status)) {
                this.waiting.add(run.id);
            }
        }
    }

    private enqueue(run: QueuedRun): void {
        this.queue.push(run);
        this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }

    private saveRegistry(): void {
        fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
        fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf-8');
    }

    private buildDiagnostics(req: http.IncomingMessage, url: URL): { checks: DiagnosticCheck[]; generatedAt: string } {
        const projectRoot = path.resolve(this.options.projectRoot);
        const configPath = workflowAppConfigPath();
        const tokenPath = workflowAppTokenPath();
        const codexExecutable = resolveCodexExecutable(this.codexExecutablePath);
        const codexProbe = probeCodexExecutable(codexExecutable);
        const checks: DiagnosticCheck[] = [];

        checks.push(check(
            'project-root',
            'Project root',
            fs.existsSync(path.join(projectRoot, 'package.json')) ? 'ok' : 'fail',
            projectRoot,
            'Set CODEX_WORKFLOW_PROJECT_ROOT or run scripts/setup-codex-workflow.ps1 from the cloned repo.'
        ));
        checks.push(check(
            'workflow-build',
            'Workflow app build',
            fs.existsSync(path.join(projectRoot, 'out', 'workflow-app', 'cli.js')) ? 'ok' : 'fail',
            path.join(projectRoot, 'out', 'workflow-app', 'cli.js'),
            'Run npm run compile.'
        ));
        const agentDir = path.join(projectRoot, '.codex', 'agents');
        const agentCount = fs.existsSync(agentDir) ? fs.readdirSync(agentDir).filter(name => name.endsWith('.toml')).length : 0;
        checks.push(check(
            'agent-definitions',
            'Codex agent definitions',
            agentCount > 0 ? 'ok' : 'fail',
            `${agentCount} agent definition file(s) found`,
            'Restore .codex/agents/*.toml from the repo.'
        ));
        checks.push(check(
            'node',
            'Node.js',
            'ok',
            process.version
        ));
        checks.push(commandCheck('npm', 'npm', ['--version']));
        checks.push(commandCheck('git', 'Git', ['--version']));
        checks.push(check(
            'codex-executable',
            'Codex executable',
            codexProbe.ok ? 'ok' : 'fail',
            `${codexProbe.executable}${codexProbe.version ? ` (${codexProbe.version})` : ''}${codexProbe.ok ? '' : ` - ${codexProbe.message}`}`,
            'Install Codex Desktop/CLI, or pass -CodexExecutablePath to scripts/setup-codex-workflow.ps1.'
        ));
        checks.push(appServerCheck(codexExecutable, codexProbe.ok));
        checks.push(check(
            'sdk-dependency',
            'Codex SDK dependency',
            isSdkRuntimeAvailable() ? 'ok' : 'warn',
            isSdkRuntimeAvailable() ? '@openai/codex-sdk can be loaded.' : '@openai/codex-sdk is not loadable in this build.',
            'Run npm ci and npm run compile.'
        ));
        checks.push(check(
            'marketplace',
            'Repo marketplace file',
            fs.existsSync(path.join(projectRoot, '.agents', 'plugins', 'marketplace.json')) ? 'ok' : 'warn',
            path.join(projectRoot, '.agents', 'plugins', 'marketplace.json'),
            'Restore .agents/plugins/marketplace.json or run setup without -SkipMarketplace.'
        ));
        checks.push(check(
            'local-config',
            'Local config file',
            fs.existsSync(configPath) ? 'ok' : 'warn',
            configPath,
            'Run scripts/setup-codex-workflow.ps1 to create the config.'
        ));
        checks.push(check(
            'local-token',
            'Local capability token',
            fs.existsSync(tokenPath) ? 'ok' : 'warn',
            fs.existsSync(tokenPath) ? 'Token file exists. Value is hidden.' : 'Token file is missing.',
            'Start the Workflow App or run setup to create a local token.'
        ));
        checks.push(check(
            'api-auth',
            'API browser auth',
            this.isAuthorized(req, url) ? 'ok' : 'warn',
            this.isAuthorized(req, url) ? 'Current request is authenticated.' : 'Current request is not authenticated; read-only diagnostics are public.',
            'Open the Workflow App UI once so the local auth cookie is set.'
        ));
        checks.push(gitCredentialCheck(projectRoot));

        return { checks, generatedAt: new Date().toISOString() };
    }

    private handleUpgrade(req: http.IncomingMessage, socket: WsSocket): void {
        const url = new URL(req.url || '/', `http://${req.headers.host || `${this.host}:${this.port}`}`);
        if (url.pathname !== '/ws' || !this.isAuthorized(req, url)) {
            socket.destroy();
            return;
        }
        const key = req.headers['sec-websocket-key'];
        if (!key || Array.isArray(key)) {
            socket.destroy();
            return;
        }
        const accept = crypto.createHash('sha1')
            .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
            .digest('base64');
        socket.write([
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${accept}`,
            '',
            '',
        ].join('\r\n'));
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        socket.on('error', () => this.sockets.delete(socket));
        this.sendWs(socket, { type: 'connected', at: new Date().toISOString() });
    }

    private broadcast(type: string, payload: any): void {
        const message = { type, payload, at: new Date().toISOString() };
        for (const socket of this.sockets) this.sendWs(socket, message);
    }

    private sendWs(socket: WsSocket, value: any): void {
        const data = Buffer.from(JSON.stringify(value), 'utf-8');
        const header = data.length < 126
            ? Buffer.from([0x81, data.length])
            : data.length < 65536
                ? Buffer.from([0x81, 126, data.length >> 8, data.length & 0xff])
                : Buffer.concat([Buffer.from([0x81, 127]), Buffer.alloc(8)]);
        if (data.length >= 65536) header.writeBigUInt64BE(BigInt(data.length), 2);
        socket.write(Buffer.concat([header, data]));
    }

    private json(res: http.ServerResponse, value: any, status = 200): void {
        const body = JSON.stringify(value);
        res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'access-control-allow-origin': 'http://127.0.0.1',
            'access-control-allow-credentials': 'true',
            'access-control-allow-headers': 'content-type,x-codex-workflow-token,authorization',
            'access-control-allow-methods': 'GET,POST,OPTIONS',
        });
        res.end(body);
    }

    private html(res: http.ServerResponse, value: string): void {
        res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'set-cookie': `${AUTH_COOKIE_NAME}=${encodeURIComponent(this.authToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
        });
        res.end(value);
    }

    private empty(res: http.ServerResponse, status = 204): void {
        res.writeHead(status, {
            'access-control-allow-origin': 'http://127.0.0.1',
            'access-control-allow-credentials': 'true',
            'access-control-allow-headers': 'content-type,x-codex-workflow-token,authorization',
            'access-control-allow-methods': 'GET,POST,OPTIONS',
        });
        res.end();
    }

    private requiresAuth(method: string, pathname: string): boolean {
        if (method === 'GET' && (pathname === '/' || pathname === '/api/health' || pathname === '/api/diagnostics')) return false;
        return pathname.startsWith('/api/') || method !== 'GET';
    }

    private isAuthorized(req: http.IncomingMessage, url: URL): boolean {
        const header = String(req.headers['x-codex-workflow-token'] || '');
        const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const query = url.searchParams.get('token') || '';
        const cookie = cookieValue(req, AUTH_COOKIE_NAME);
        return [header, auth, query, cookie].some(value => value && timingSafeEqual(value, this.authToken));
    }
}

export function openWorkflowApp(url: string): void {
    if (process.platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
        spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
        spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
}

export function workflowAppHome(): string {
    return path.join(os.homedir(), '.codex-workflow');
}

export function workflowAppConfigPath(): string {
    return path.join(workflowAppHome(), 'config.json');
}

export function workflowAppTokenPath(): string {
    return path.join(workflowAppHome(), 'token');
}

export function readWorkflowAppConfig(): WorkflowAppConfig {
    const p = workflowAppConfigPath();
    try {
        if (!fs.existsSync(p)) return {};
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8').replace(/^\uFEFF/, '')) as WorkflowAppConfig;
        return {
            projectRoot: typeof raw.projectRoot === 'string' ? raw.projectRoot : undefined,
            codexExecutablePath: typeof raw.codexExecutablePath === 'string' ? raw.codexExecutablePath : undefined,
            port: Number.isFinite(Number(raw.port)) ? Number(raw.port) : undefined,
        };
    } catch {
        return {};
    }
}

function loadOrCreateAuthToken(): string {
    const p = workflowAppTokenPath();
    try {
        if (fs.existsSync(p)) {
            const existing = fs.readFileSync(p, 'utf-8').trim();
            if (existing) return existing;
        }
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const token = crypto.randomBytes(24).toString('hex');
        fs.writeFileSync(p, token, 'utf-8');
        return token;
    } catch {
        return crypto.randomBytes(24).toString('hex');
    }
}

function check(id: string, label: string, status: DiagnosticCheck['status'], detail: string, remediation?: string): DiagnosticCheck {
    const value: DiagnosticCheck = { id, label, status, detail };
    if (status !== 'ok' && remediation) value.remediation = remediation;
    return value;
}

function commandCheck(command: string, label: string, args: string[]): DiagnosticCheck {
    const candidates = process.platform === 'win32' && !/\.(cmd|exe|bat)$/i.test(command)
        ? [command, `${command}.cmd`, `${command}.exe`, path.join(path.dirname(process.execPath), `${command}.cmd`), path.join(path.dirname(process.execPath), `${command}.exe`)]
        : [command];
    let lastError = '';
    for (const candidate of candidates) {
        try {
            const commandForShell = process.platform === 'win32' && candidate.includes(path.sep) ? `"${candidate}"` : candidate;
            const res = spawnSync(commandForShell, args, { encoding: 'utf-8', timeout: 10000, windowsHide: true, shell: process.platform === 'win32' });
            if (res.error) {
                lastError = res.error.message;
                continue;
            }
            const text = String(res.stdout || res.stderr || '').trim();
            return res.status === 0
                ? check(command, label, 'ok', text || `${candidate} is available.`)
                : check(command, label, 'fail', text || `exit ${res.status}`, `Install ${label} and make sure it is on PATH.`);
        } catch (e: any) {
            lastError = e?.message || String(e);
        }
    }
    return check(command, label, 'fail', lastError || `${command} was not found`, `Install ${label} and make sure it is on PATH.`);
}

function appServerCheck(executable: string, codexExecutableOk: boolean): DiagnosticCheck {
    if (!codexExecutableOk) {
        return check('app-server-probe', 'Codex app-server probe', 'unknown', 'Skipped because Codex executable is not runnable.', 'Fix the Codex executable path first.');
    }
    try {
        const res = spawnSync(executable, ['app-server', '--help'], {
            encoding: 'utf-8',
            timeout: 10000,
            windowsHide: true,
            env: process.env,
        });
        if (res.error) {
            return check('app-server-probe', 'Codex app-server probe', 'fail', res.error.message, 'Update Codex Desktop/CLI or set a working Codex executable path.');
        }
        const text = String(res.stdout || res.stderr || '').trim();
        if (res.status === 0 || /app-server|json-rpc|usage/i.test(text)) {
            return check('app-server-probe', 'Codex app-server probe', 'ok', text.split(/\r?\n/).slice(0, 2).join(' ') || 'app-server command is available.');
        }
        return check('app-server-probe', 'Codex app-server probe', 'warn', text || `exit ${res.status}`, 'Update Codex Desktop/CLI if multi-agent runtime fails.');
    } catch (e: any) {
        return check('app-server-probe', 'Codex app-server probe', 'fail', e?.message || String(e), 'Update Codex Desktop/CLI or set a working Codex executable path.');
    }
}

function gitCredentialCheck(cwd: string): DiagnosticCheck {
    try {
        const helper = spawnSync('git', ['config', '--get', 'credential.helper'], {
            cwd,
            encoding: 'utf-8',
            timeout: 10000,
            windowsHide: true,
        });
        const text = String(helper.stdout || '').trim();
        if (helper.status === 0 && text) {
            return check('git-credential', 'Git credential hint', 'ok', `credential.helper=${text}`);
        }
        return check('git-credential', 'Git credential hint', 'warn', 'No git credential.helper is configured for this repo.', 'Run git credential setup or GitHub CLI login before approving push operations.');
    } catch (e: any) {
        return check('git-credential', 'Git credential hint', 'unknown', e?.message || String(e), 'Install Git and configure credentials before approving push operations.');
    }
}

function normalizeContextMode(value: any): CodexContextMode {
    const mode = String(value || 'fresh');
    return ['fresh', 'resume', 'compact', 'fork', 'reset'].includes(mode) ? mode as CodexContextMode : 'fresh';
}

function normalizeRuntime(value: any): CodexRuntime {
    const runtime = String(value || 'auto');
    return runtime === 'sdk' || runtime === 'app-server' || runtime === 'auto' ? runtime as CodexRuntime : 'auto';
}

function normalizeRunKind(value: any): WorkflowRunKind {
    const runKind = String(value || 'multiAgent');
    const allowed = ['automation', 'readOnly', 'approvalRequired', 'multiAgent', 'contextControl', 'codeChange', 'gitOperation'];
    return allowed.includes(runKind) ? runKind as WorkflowRunKind : 'multiAgent';
}

function writeLockKey(cwd: string, runKind: WorkflowRunKind): string | null {
    if (runKind === 'readOnly' || runKind === 'automation') return null;
    const root = gitRoot(cwd);
    return path.resolve(root || cwd).toLowerCase();
}

function gitRoot(cwd: string): string | null {
    try {
        const res = spawnSync('git', ['rev-parse', '--show-toplevel'], {
            cwd,
            encoding: 'utf-8',
            windowsHide: true,
        });
        if (res.status === 0) {
            const root = String(res.stdout || '').trim();
            if (root) return root;
        }
    } catch {
        // Non-git folders fall back to cwd for write-locking.
    }
    return null;
}

function cookieValue(req: http.IncomingMessage, name: string): string {
    const raw = String(req.headers.cookie || '');
    for (const part of raw.split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) return decodeURIComponent(rest.join('='));
    }
    return '';
}

function timingSafeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function readJson(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 5 * 1024 * 1024) {
                reject(new Error('request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8').trim();
            if (!raw) resolve({});
            else {
                try { resolve(JSON.parse(raw)); }
                catch (e) { reject(e); }
            }
        });
        req.on('error', reject);
    });
}
