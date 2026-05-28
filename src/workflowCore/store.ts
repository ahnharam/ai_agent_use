import * as fs from 'fs';
import * as path from 'path';

export type CodexContextMode = 'fresh' | 'resume' | 'compact' | 'fork' | 'reset';
export type CodexRuntime = 'auto' | 'app-server' | 'sdk';
export type SelectedCodexRuntime = 'app-server' | 'sdk';
export type WorkflowRunKind = 'automation' | 'readOnly' | 'approvalRequired' | 'multiAgent' | 'contextControl' | 'codeChange' | 'gitOperation';
export type WorkflowStatus = 'idle' | 'queued' | 'running' | 'blocked' | 'pendingCommitApproval' | 'pendingPushApproval' | 'completed' | 'failed' | 'cancelled';
export type StageStatus = 'pending' | 'running' | 'skipped' | 'completed' | 'failed';
export type AgentStatus = 'idle' | 'running' | 'blocked' | 'completed' | 'failed' | 'reset';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'blocked';
export type ApprovalType = 'commit' | 'push' | 'worktree' | 'merge-back' | 'destructive' | 'external';
export type AgentRequestStatus = 'pending' | 'answered' | 'failed';

export interface AgentState {
    role: string;
    threadId?: string;
    status: AgentStatus;
    lastSummary?: string;
    lastError?: string;
}

export interface StageState {
    id: string;
    role: string;
    status: StageStatus;
    skipped?: boolean;
    inputSummary?: string;
    outputSummary?: string;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
}

export interface WorkflowGitState {
    isRepo: boolean;
    originalCwd: string;
    workCwd: string;
    originalBranch?: string;
    branch?: string;
    branchType?: string;
    branchScope?: string;
    routingDecision?: 'none' | 'current-branch' | 'new-worktree' | 'reuse-branch' | 'reuse-worktree' | 'blocked';
    reuseCandidate?: {
        branch?: string;
        worktreePath?: string;
        reason?: string;
        clean?: boolean;
        uniqueCommits?: number;
    };
    routingBlockedReason?: string;
    routingPreference?: 'auto' | 'force-worktree';
    routingLock?: {
        active: boolean;
        stale?: boolean;
        ownerRunId?: string;
        updatedAt?: string;
        reason?: string;
    };
    laneVerdict?: 'clean' | 'same-lane' | 'unrelated' | 'unknown';
    activeLocks?: WorkflowWriterLock[];
    staleLocks?: WorkflowWriterLock[];
    diffStability?: 'stable' | 'changed' | 'unavailable';
    preflightSummary?: string;
    preflightWarnings?: string[];
    worktreePath?: string;
    dirty?: boolean;
    changedFiles?: string[];
    conflictFiles?: string[];
    commitHash?: string;
    pushRemote?: string;
    pushBranch?: string;
    diffHash?: string;
    mergeStatus?: 'idle' | 'pendingApproval' | 'merged' | 'conflict' | 'failed' | 'cleaned';
    lastError?: string;
}

export interface WorkflowWriterLock {
    runId: string;
    cwd: string;
    workCwd: string;
    branch?: string;
    role: string;
    stageId: string;
    pid: number;
    createdAt: string;
    updatedAt: string;
    status: 'active' | 'released' | 'stale';
    staleReason?: string;
}

export interface WorkflowArtifacts {
    docsSummary?: string;
    webResearchSummary?: string;
    gitPlan?: string;
    coderSummary?: string;
    designerSummary?: string;
    frontendSummary?: string;
    backendSummary?: string;
    qaSummary?: string;
    qaEvidence?: string;
    docSummary?: string;
    finalSummary?: string;
    lastDiff?: string;
    assignedRoles?: string[];
}

export interface ApprovalRequest {
    id: string;
    runId: string;
    type: ApprovalType;
    status: ApprovalStatus;
    summary: string;
    diff?: string;
    validationHash?: string;
    resolutionReason?: string;
    createdAt: string;
    resolvedAt?: string;
}

export interface AgentRequest {
    id: string;
    runId: string;
    stageId?: string;
    turnId?: string;
    fromRole: string;
    toRole: string;
    question: string;
    status: AgentRequestStatus;
    answer?: string;
    answerSummary?: string;
    createdAt: string;
    resolvedAt?: string;
}

export interface WorkflowRun {
    id: string;
    source?: string;
    cwd: string;
    prompt?: string;
    userPrompt: string;
    status: WorkflowStatus;
    priority?: number;
    runtime: CodexRuntime;
    selectedRuntime?: SelectedCodexRuntime;
    runtimeVersion?: string;
    runKind: WorkflowRunKind;
    approvalPolicy?: string;
    mcpSource?: string;
    eventLogPath?: string;
    createdAt: string;
    updatedAt: string;
    contextMode: CodexContextMode;
    stages: StageState[];
    agents: Record<string, AgentState>;
    git: WorkflowGitState;
    artifacts: WorkflowArtifacts;
    approvals: {
        commitRequired: boolean;
        pushRequired: boolean;
        commitApproved: boolean;
        pushApproved: boolean;
    };
    approvalRequests?: ApprovalRequest[];
    agentRequests?: AgentRequest[];
    repairAttempts: number;
    maxRepairLoops: number;
}

export const CODEX_WORKFLOW_ROLES = [
    'docs-agent',
    'web-researcher',
    'git-manager',
    'designer',
    'frontend-coder',
    'backend-coder',
    'qa-agent',
    'doc-writer',
] as const;

export type CodexWorkflowRole = typeof CODEX_WORKFLOW_ROLES[number];

export function utcNow(): string {
    return new Date().toISOString();
}

export function slugify(input: string, fallback = 'task'): string {
    const base = input
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return base || fallback;
}

export class CodexWorkflowStore {
    constructor(private readonly cwd: string) {}

    public rootDir(): string {
        return path.join(this.cwd, '.ai-agent');
    }

    public runsDir(): string {
        return path.join(this.rootDir(), 'runs');
    }

    public runPath(runId: string): string {
        return path.join(this.runsDir(), `${runId}.json`);
    }

    public ensure(): void {
        fs.mkdirSync(this.runsDir(), { recursive: true });
    }

    public eventPath(runId: string): string {
        return path.join(this.runsDir(), `${runId}.events.jsonl`);
    }

    public createRun(
        userPrompt: string,
        contextMode: CodexContextMode,
        maxRepairLoops: number,
        options: {
            source?: string;
            priority?: number;
            id?: string;
            runtime?: CodexRuntime;
            selectedRuntime?: SelectedCodexRuntime;
            runKind?: WorkflowRunKind;
            approvalPolicy?: string;
            mcpSource?: string;
            routingPreference?: 'auto' | 'force-worktree';
        } = {},
    ): WorkflowRun {
        this.ensure();
        const now = utcNow();
        const id = options.id || `${now.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}-${slugify(userPrompt)}`;
        const agents: Record<string, AgentState> = {};
        for (const role of CODEX_WORKFLOW_ROLES) {
            agents[role] = { role, status: 'idle' };
        }
        const run: WorkflowRun = {
            id,
            source: options.source || 'local',
            cwd: this.cwd,
            prompt: userPrompt,
            userPrompt,
            status: 'idle',
            priority: options.priority || 0,
            runtime: options.runtime || 'auto',
            selectedRuntime: options.selectedRuntime,
            runKind: options.runKind || 'multiAgent',
            approvalPolicy: options.approvalPolicy,
            mcpSource: options.mcpSource,
            eventLogPath: this.eventPath(id),
            createdAt: now,
            updatedAt: now,
            contextMode,
            stages: [],
            agents,
            git: {
                isRepo: false,
                originalCwd: this.cwd,
                workCwd: this.cwd,
                routingPreference: options.routingPreference || 'auto',
            },
            artifacts: {},
            approvals: {
                commitRequired: false,
                pushRequired: false,
                commitApproved: false,
                pushApproved: false,
            },
            approvalRequests: [],
            agentRequests: [],
            repairAttempts: 0,
            maxRepairLoops,
        };
        this.saveRun(run);
        this.appendEvent(run, 'run.created', { status: run.status, runtime: run.runtime, runKind: run.runKind });
        return run;
    }

    public saveRun(run: WorkflowRun): WorkflowRun {
        this.ensure();
        run.updatedAt = utcNow();
        fs.writeFileSync(this.runPath(run.id), JSON.stringify(run, null, 2), 'utf-8');
        return run;
    }

    public readRun(runId: string): WorkflowRun | null {
        try {
            const p = this.runPath(runId);
            if (!fs.existsSync(p)) return null;
            return JSON.parse(fs.readFileSync(p, 'utf-8')) as WorkflowRun;
        } catch {
            return null;
        }
    }

    public latestRun(): WorkflowRun | null {
        try {
            this.ensure();
            const files = fs.readdirSync(this.runsDir())
                .filter(f => f.endsWith('.json'))
                .map(f => path.join(this.runsDir(), f))
                .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
            if (files.length === 0) return null;
            return JSON.parse(fs.readFileSync(files[0], 'utf-8')) as WorkflowRun;
        } catch {
            return null;
        }
    }

    public upsertStage(run: WorkflowRun, patch: Partial<StageState> & Pick<StageState, 'id' | 'role'>): StageState {
        let stage = run.stages.find(s => s.id === patch.id);
        if (!stage) {
            stage = { id: patch.id, role: patch.role, status: 'pending' };
            run.stages.push(stage);
        }
        Object.assign(stage, patch);
        this.saveRun(run);
        return stage;
    }

    public updateAgent(run: WorkflowRun, role: string, patch: Partial<AgentState>): AgentState {
        const current = run.agents[role] || { role, status: 'idle' as AgentStatus };
        run.agents[role] = { ...current, ...patch, role };
        this.saveRun(run);
        return run.agents[role];
    }

    public upsertAgentRequest(run: WorkflowRun, request: AgentRequest): AgentRequest {
        const requests = run.agentRequests || (run.agentRequests = []);
        const existing = requests.find(r => r.id === request.id);
        if (existing) {
            Object.assign(existing, request);
            this.saveRun(run);
            return existing;
        }
        requests.push(request);
        this.saveRun(run);
        return request;
    }

    public appendEvent(run: WorkflowRun, type: string, payload: any = {}): void {
        this.ensure();
        const entry = {
            at: utcNow(),
            runId: run.id,
            type,
            payload,
        };
        fs.appendFileSync(run.eventLogPath || this.eventPath(run.id), `${JSON.stringify(entry)}\n`, 'utf-8');
    }

    public readEvents(runId: string, limit = 500): any[] {
        const p = this.eventPath(runId);
        if (!fs.existsSync(p)) return [];
        const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter(Boolean);
        return lines.slice(Math.max(0, lines.length - limit)).map(line => {
            try { return JSON.parse(line); }
            catch { return { at: utcNow(), runId, type: 'event.parseFailed', payload: { line } }; }
        });
    }
}
