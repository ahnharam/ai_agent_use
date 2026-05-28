import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { WorkflowWriterLock } from './store';

export type LaneVerdict = 'clean' | 'same-lane' | 'unrelated' | 'unknown';
export type DiffStability = 'stable' | 'changed' | 'unavailable';

export interface GitRoutingPreflightResult {
    statusShortBranch: string[];
    worktreePorcelain: string;
    diffNameStatus: string[];
    cachedDiffNameStatus: string[];
    statusPorcelain: string[];
    dirtyPaths: string[];
    firstDiffHash?: string;
    secondDiffHash?: string;
    diffStability: DiffStability;
    laneVerdict: LaneVerdict;
    activeLocks: WorkflowWriterLock[];
    staleLocks: WorkflowWriterLock[];
    warnings: string[];
    blockedReason?: string;
    summary: string;
}

export interface GitRoutingPreflightOptions {
    branchType: string;
    branchScope: string;
    branch?: string;
    workCwd?: string;
    currentRunId?: string;
}

export interface WorkflowWriterLockHandle {
    lock: WorkflowWriterLock;
    stop(): void;
}

export interface GitRoutingMutexLock {
    runId: string;
    cwd: string;
    pid: number;
    createdAt: string;
    updatedAt: string;
    status: 'active' | 'released' | 'stale';
    staleReason?: string;
}

export interface GitRoutingMutexHandle {
    lock: GitRoutingMutexLock;
    release(): void;
}

const LOCK_STALE_AFTER_MS = 45_000;
const LOCK_HEARTBEAT_MS = 5_000;

export function workflowLocksDir(cwd: string): string {
    return path.join(cwd, '.ai-agent', 'locks');
}

export function workflowWriterLockPath(cwd: string, runId: string): string {
    return path.join(workflowLocksDir(cwd), `workflow-writer-${safeLockId(runId)}.json`);
}

export function gitRoutingLockPath(cwd: string): string {
    return path.join(workflowLocksDir(cwd), 'git-routing.json');
}

export function gitRepositoryLockRoot(cwd: string): string {
    const commonDir = gitSafe(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)?.trim();
    if (commonDir) {
        const normalized = path.resolve(commonDir);
        if (path.basename(normalized).toLowerCase() === '.git') {
            return path.dirname(normalized);
        }
        const parent = path.dirname(normalized);
        if (path.basename(parent).toLowerCase() === '.git') {
            return path.dirname(parent);
        }
    }
    return gitSafe(['rev-parse', '--show-toplevel'], cwd)?.trim() || cwd;
}

export function startWorkflowWriterLock(params: Omit<WorkflowWriterLock, 'createdAt' | 'updatedAt' | 'status'>, rootCwd?: string): WorkflowWriterLockHandle {
    const now = new Date().toISOString();
    const lock: WorkflowWriterLock = {
        ...params,
        cwd: path.resolve(params.cwd),
        workCwd: path.resolve(params.workCwd),
        createdAt: now,
        updatedAt: now,
        status: 'active',
    };
    const lockRoot = rootCwd || params.cwd;
    writeWorkflowLock(lockRoot, lock);
    const timer = setInterval(() => {
        const latest = { ...lock, updatedAt: new Date().toISOString(), status: 'active' as const };
        writeWorkflowLock(lockRoot, latest);
    }, LOCK_HEARTBEAT_MS);
    timer.unref?.();
    return {
        lock,
        stop: () => {
            clearInterval(timer);
            releaseWorkflowWriterLock(lockRoot, lock.runId);
        },
    };
}

export function releaseWorkflowWriterLock(cwd: string, runId: string): void {
    const lockPath = workflowWriterLockPath(cwd, runId);
    try {
        if (!fs.existsSync(lockPath)) return;
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as WorkflowWriterLock;
        lock.status = 'released';
        lock.updatedAt = new Date().toISOString();
        fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
        fs.unlinkSync(lockPath);
    } catch {
        // Lock cleanup is best-effort; stale lock handling covers leftovers.
    }
}

export function readWorkflowWriterLocks(cwd: string, currentRunId?: string): { activeLocks: WorkflowWriterLock[]; staleLocks: WorkflowWriterLock[]; allLocks: WorkflowWriterLock[] } {
    const dir = workflowLocksDir(cwd);
    const allLocks: WorkflowWriterLock[] = [];
    const activeLocks: WorkflowWriterLock[] = [];
    const staleLocks: WorkflowWriterLock[] = [];
    try {
        if (!fs.existsSync(dir)) return { activeLocks, staleLocks, allLocks };
        for (const name of fs.readdirSync(dir)) {
            if (!/^workflow-writer-.+\.json$/i.test(name)) continue;
            const filePath = path.join(dir, name);
            try {
                const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as WorkflowWriterLock;
                const assessed = assessLock(raw);
                allLocks.push(assessed);
                if (assessed.runId === currentRunId) continue;
                if (assessed.status === 'stale') staleLocks.push(assessed);
                else if (assessed.status === 'active') activeLocks.push(assessed);
            } catch {
                staleLocks.push({
                    runId: name.replace(/^workflow-writer-/, '').replace(/\.json$/i, ''),
                    cwd,
                    workCwd: cwd,
                    role: 'unknown',
                    stageId: 'unknown',
                    pid: 0,
                    createdAt: '',
                    updatedAt: '',
                    status: 'stale',
                    staleReason: 'unreadable lock file',
                });
            }
        }
    } catch {
        return { activeLocks, staleLocks, allLocks };
    }
    return { activeLocks, staleLocks, allLocks };
}

export function readGitRoutingMutex(cwd: string): GitRoutingMutexLock | null {
    const lockPath = gitRoutingLockPath(cwd);
    try {
        if (!fs.existsSync(lockPath)) return null;
        const raw = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as GitRoutingMutexLock;
        return assessRoutingLock(raw);
    } catch {
        return {
            runId: 'unknown',
            cwd,
            pid: 0,
            createdAt: '',
            updatedAt: '',
            status: 'stale',
            staleReason: 'unreadable routing lock file',
        };
    }
}

export async function acquireGitRoutingMutex(cwd: string, runId: string, waitMs = 5000): Promise<GitRoutingMutexHandle> {
    const root = path.resolve(cwd);
    const dir = workflowLocksDir(root);
    const lockPath = gitRoutingLockPath(root);
    const started = Date.now();
    fs.mkdirSync(dir, { recursive: true });
    while (Date.now() - started <= waitMs) {
        const now = new Date().toISOString();
        const lock: GitRoutingMutexLock = {
            runId,
            cwd: root,
            pid: process.pid,
            createdAt: now,
            updatedAt: now,
            status: 'active',
        };
        try {
            const fd = fs.openSync(lockPath, 'wx');
            try {
                fs.writeFileSync(fd, JSON.stringify(lock, null, 2), 'utf-8');
            } finally {
                fs.closeSync(fd);
            }
            return {
                lock,
                release: () => releaseGitRoutingMutex(root, runId),
            };
        } catch (e: any) {
            if (e?.code !== 'EEXIST') throw e;
            const existing = readGitRoutingMutex(root);
            if (!existing || existing.status === 'stale') {
                try { fs.unlinkSync(lockPath); } catch { /* retry */ }
                continue;
            }
            await delay(250);
        }
    }
    const existing = readGitRoutingMutex(root);
    const owner = existing?.runId || 'unknown';
    throw new Error(`git-routing mutex is busy (owner: ${owner}). User confirmation is required before creating a branch or worktree.`);
}

export function releaseGitRoutingMutex(cwd: string, runId: string): void {
    const lockPath = gitRoutingLockPath(cwd);
    try {
        if (!fs.existsSync(lockPath)) return;
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as GitRoutingMutexLock;
        if (lock.runId && lock.runId !== runId) return;
        lock.status = 'released';
        lock.updatedAt = new Date().toISOString();
        fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
        fs.unlinkSync(lockPath);
    } catch {
        // Routing lock cleanup is best-effort; stale lock handling covers leftovers.
    }
}

export async function runGitRoutingPreflight(cwd: string, options: GitRoutingPreflightOptions): Promise<GitRoutingPreflightResult> {
    const root = gitSafe(['rev-parse', '--show-toplevel'], cwd)?.trim() || cwd;
    const lockRoot = gitRepositoryLockRoot(root);
    const statusShortBranch = gitLines(['status', '--short', '--branch'], root);
    const worktreePorcelain = gitSafe(['worktree', 'list', '--porcelain'], root) || '';
    const diffNameStatus = gitLines(['diff', '--name-status'], root);
    const cachedDiffNameStatus = gitLines(['diff', '--cached', '--name-status'], root);
    const statusPorcelain = gitLines(['status', '--porcelain', '-uall'], root);
    const dirtyPaths = parseDirtyPaths(statusPorcelain, diffNameStatus, cachedDiffNameStatus);
    const firstDiffHash = gitStateHash(root);
    await delay(1000);
    const secondDiffHash = gitStateHash(root);
    const diffStability: DiffStability = firstDiffHash && secondDiffHash
        ? (firstDiffHash === secondDiffHash ? 'stable' : 'changed')
        : 'unavailable';
    const laneVerdict = classifyLane(options.branchType, options.branchScope, dirtyPaths);
    const locks = readWorkflowWriterLocks(lockRoot, options.currentRunId);
    const relevantActiveLocks = locks.activeLocks.filter(lock => lockTargetsRepo(lock, root, options.workCwd || root, lockRoot));
    const warnings = advisoryWriterProcessWarnings(root);
    let blockedReason: string | undefined;
    if (diffStability === 'changed') {
        blockedReason = 'writer-suspected: git diff changed during the routing preflight. User confirmation is required before checkout or worktree creation.';
    }
    const summary = [
        `lane=${laneVerdict}`,
        `diff=${diffStability}`,
        `dirtyFiles=${dirtyPaths.length}`,
        `activeLocks=${relevantActiveLocks.length}`,
        `staleLocks=${locks.staleLocks.length}`,
        warnings.length ? `warnings=${warnings.length}` : '',
    ].filter(Boolean).join(', ');
    return {
        statusShortBranch,
        worktreePorcelain,
        diffNameStatus,
        cachedDiffNameStatus,
        statusPorcelain,
        dirtyPaths,
        firstDiffHash,
        secondDiffHash,
        diffStability,
        laneVerdict,
        activeLocks: relevantActiveLocks,
        staleLocks: locks.staleLocks,
        warnings,
        blockedReason,
        summary,
    };
}

export function classifyLane(branchType: string, branchScope: string, dirtyPaths: string[]): LaneVerdict {
    const paths = Array.from(new Set(dirtyPaths.map(normalizeGitPath).filter(Boolean)));
    if (paths.length === 0) return 'clean';
    const normalizedType = (branchType || '').toLowerCase();
    const normalizedScope = (branchScope || '').toLowerCase();
    const matches = paths.map(filePath => pathMatchesLane(normalizedType, normalizedScope, filePath));
    if (matches.every(value => value === true)) return 'same-lane';
    if (matches.every(value => value === false)) return 'unrelated';
    return 'unknown';
}

function writeWorkflowLock(cwd: string, lock: WorkflowWriterLock): void {
    const dir = workflowLocksDir(cwd);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(workflowWriterLockPath(cwd, lock.runId), JSON.stringify(lock, null, 2), 'utf-8');
}

function assessLock(lock: WorkflowWriterLock): WorkflowWriterLock {
    const updated = Date.parse(lock.updatedAt || '');
    const ageMs = Number.isFinite(updated) ? Date.now() - updated : Number.POSITIVE_INFINITY;
    const pidAlive = lock.pid > 0 && isPidAlive(lock.pid);
    if (lock.status !== 'active') return lock;
    if (ageMs > LOCK_STALE_AFTER_MS) {
        return { ...lock, status: 'stale', staleReason: `heartbeat older than ${Math.round(ageMs / 1000)}s` };
    }
    if (!pidAlive) {
        return { ...lock, status: 'stale', staleReason: `pid ${lock.pid} is not alive` };
    }
    return lock;
}

function assessRoutingLock(lock: GitRoutingMutexLock): GitRoutingMutexLock {
    const updated = Date.parse(lock.updatedAt || '');
    const ageMs = Number.isFinite(updated) ? Date.now() - updated : Number.POSITIVE_INFINITY;
    const pidAlive = lock.pid > 0 && isPidAlive(lock.pid);
    if (lock.status !== 'active') return lock;
    if (ageMs > LOCK_STALE_AFTER_MS) {
        return { ...lock, status: 'stale', staleReason: `routing lock older than ${Math.round(ageMs / 1000)}s` };
    }
    if (!pidAlive) {
        return { ...lock, status: 'stale', staleReason: `pid ${lock.pid} is not alive` };
    }
    return lock;
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e: any) {
        return e?.code === 'EPERM';
    }
}

function lockTargetsRepo(lock: WorkflowWriterLock, repoRoot: string, workCwd: string, lockRoot: string): boolean {
    const root = path.resolve(repoRoot).toLowerCase();
    const work = path.resolve(workCwd).toLowerCase();
    const common = path.resolve(lockRoot).toLowerCase();
    const lockCwd = path.resolve(lock.cwd || '').toLowerCase();
    const lockWorkCwd = path.resolve(lock.workCwd || lock.cwd || '').toLowerCase();
    return lockCwd === root || lockWorkCwd === root || lockWorkCwd === work || lockCwd === work || lockCwd === common || lockWorkCwd === common;
}

function parseDirtyPaths(statusPorcelain: string[], diffNameStatus: string[], cachedDiffNameStatus: string[]): string[] {
    const paths = new Set<string>();
    for (const line of statusPorcelain) {
        const candidate = line.length > 3 ? line.slice(3).trim() : '';
        addStatusPath(paths, candidate);
    }
    for (const line of [...diffNameStatus, ...cachedDiffNameStatus]) {
        const parts = line.split(/\t+/).map(part => part.trim()).filter(Boolean);
        if (parts.length >= 2) {
            for (const part of parts.slice(1)) addStatusPath(paths, part);
        }
    }
    return Array.from(paths).filter(filePath => !isRoutingIgnoredPath(filePath)).sort();
}

function addStatusPath(paths: Set<string>, candidate: string): void {
    if (!candidate) return;
    const parts = candidate.includes(' -> ') ? candidate.split(' -> ') : [candidate];
    for (const part of parts) {
        const normalized = normalizeGitPath(part.replace(/^"|"$/g, ''));
        if (normalized) paths.add(normalized);
    }
}

function pathMatchesLane(branchType: string, branchScope: string, filePath: string): boolean {
    if (isWorkflowScope(branchScope)) {
        if (startsWithAny(filePath, ['src/workflowApp/', 'src/workflowCore/', '.codex/'])) return true;
        if (filePath === 'package.json' || filePath === 'package-lock.json' || filePath === 'tsconfig.json') return true;
    }
    if (scopeMatchesPath(branchScope, filePath)) return true;
    if (branchType === 'docs') {
        return startsWithAny(filePath, ['docs/', '.codex/'])
            || /^(readme|agents|contributing|changelog|license)(\..*)?$/i.test(path.basename(filePath));
    }
    if (branchType === 'test') {
        return startsWithAny(filePath, ['test/', 'tests/', '__tests__/', 'fixtures/', 'fixture/', 'qa/', 'harness/'])
            || /\.(spec|test)\.[a-z0-9]+$/i.test(filePath)
            || /(^|\/)(fixture|fixtures|harness)(\/|$)/i.test(filePath);
    }
    if (branchType === 'ops') {
        return startsWithAny(filePath, ['scripts/', '.github/', 'deploy/', 'deployment/', 'ops/', 'runtime/'])
            || /(^|\/)(dockerfile|docker-compose|compose|service|systemd|pm2|nginx|deploy|runtime)/i.test(filePath);
    }
    if (branchType === 'chore') {
        return startsWithAny(filePath, ['scripts/', '.github/', '.vscode/', '.agents/', '.codex/'])
            || /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig.*\.json|eslint.*|prettier.*|setup.*|diagnostics?.*)$/i.test(filePath)
            || /(^|\/)(config|configs)(\/|$)/i.test(filePath);
    }
    if (['feat', 'fix', 'refactor'].includes(branchType)) {
        if (isWorkflowScope(branchScope)) return startsWithAny(filePath, ['src/workflowApp/', 'src/workflowCore/', '.codex/']);
        if (branchScope === 'frontend') return startsWithAny(filePath, ['src/workflowApp/', 'src/webview/', 'webview/', 'ui/', 'client/', 'frontend/']);
        if (branchScope === 'backend') return startsWithAny(filePath, ['src/workflowCore/', 'src/workflowApp/server', 'server/', 'backend/', 'api/']);
        if (branchScope === 'repo') return startsWithAny(filePath, ['scripts/', '.github/', '.agents/', '.codex/']) || filePath === 'package.json';
        return false;
    }
    if (branchType === 'research') {
        return startsWithAny(filePath, ['docs/research/', 'research/', 'analysis/', 'notes/']) || scopeMatchesPath(branchScope, filePath);
    }
    if (branchType === 'spike') {
        return startsWithAny(filePath, ['spikes/', 'experiments/', 'prototype/', 'prototypes/', 'docs/plan/']) || scopeMatchesPath(branchScope, filePath);
    }
    return false;
}

function isWorkflowScope(scope: string): boolean {
    return /workflow|codex|agent|orchestrator/.test(scope);
}

function scopeMatchesPath(scope: string, filePath: string): boolean {
    if (!scope || scope.length < 3) return false;
    const pathTokens = tokenizePath(filePath);
    const scopeTokens = scope.split('-').filter(token => token.length >= 3);
    if (scopeTokens.length === 0) return false;
    return scopeTokens.every(token => pathTokens.some(pathToken => pathToken.includes(token) || token.includes(pathToken)));
}

function tokenizePath(filePath: string): string[] {
    return filePath
        .toLowerCase()
        .replace(/[^a-z0-9/._-]+/g, '-')
        .split(/[\/._-]+/)
        .map(token => token.trim())
        .filter(token => token.length >= 3);
}

function startsWithAny(filePath: string, prefixes: string[]): boolean {
    return prefixes.some(prefix => filePath.startsWith(prefix));
}

function normalizeGitPath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

function isRoutingIgnoredPath(filePath: string): boolean {
    return startsWithAny(filePath, [
        '.ai-agent/runs/',
        '.ai-agent/locks/',
        '.ai-agent/doc-cache/',
    ]);
}

function gitStateHash(cwd: string): string | undefined {
    try {
        const status = gitSafe(['status', '--porcelain', '-uall'], cwd) || '';
        const diff = gitSafe(['diff', '--binary'], cwd) || '';
        const staged = gitSafe(['diff', '--cached', '--binary'], cwd) || '';
        return crypto.createHash('sha256').update(`${status}\n${diff}\n${staged}`).digest('hex');
    } catch {
        return undefined;
    }
}

function advisoryWriterProcessWarnings(cwd: string): string[] {
    if (process.platform !== 'win32') return [];
    const escaped = path.resolve(cwd).replace(/'/g, "''");
    const script = [
        '$needle = \'' + escaped + '\'',
        '$self = ' + process.pid,
        'Get-CimInstance Win32_Process | Where-Object {',
        '  $_.CommandLine -and $_.ProcessId -ne $self -and $_.CommandLine.Contains($needle) -and $_.Name -match \'node|python|npm|pnpm|yarn|git|tsc|esbuild\'',
        '} | Select-Object -First 5 -Property ProcessId,Name | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }',
    ].join('; ');
    const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        encoding: 'utf-8',
        timeout: 2500,
        windowsHide: true,
    });
    if (result.status !== 0 || result.error) return [];
    return (result.stdout || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => `advisory-writer-process: ${line}`);
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
    if (res.status !== 0) throw new Error((res.stderr || res.stdout || `git ${args.join(' ')} failed`).trim());
    return res.stdout || '';
}

function gitSafe(args: string[], cwd: string, timeout = 30000): string | null {
    try {
        return git(args, cwd, timeout);
    } catch {
        return null;
    }
}

function gitLines(args: string[], cwd: string): string[] {
    return (gitSafe(args, cwd) || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function safeLockId(runId: string): string {
    return runId.replace(/[^a-zA-Z0-9_.-]/g, '-');
}
