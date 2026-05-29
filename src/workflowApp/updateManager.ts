import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { readGitRoutingMutex, readWorkflowWriterLocks } from '../workflowCore/gitRoutingSafety';

export type AutoUpdateMode = 'off' | 'notify' | 'autoWhenIdle';
export type WorkflowUpdateState =
    | 'unknown'
    | 'upToDate'
    | 'available'
    | 'unavailable'
    | 'blocked'
    | 'applying'
    | 'completed'
    | 'failed'
    | 'restartRequired';

export interface WorkflowUpdateConfig {
    autoUpdateMode?: AutoUpdateMode;
    updateIntervalSec?: number;
    updateRemote?: string;
    updateBranch?: string;
}

export interface WorkflowUpdateLock {
    pid: number;
    projectRoot: string;
    createdAt: string;
    updatedAt: string;
    status: 'active' | 'stale' | 'released';
    staleReason?: string;
}

export interface WorkflowUpdateStatus {
    status: WorkflowUpdateState;
    updateAvailable: boolean;
    autoUpdateMode: AutoUpdateMode;
    projectRoot: string;
    currentCommit?: string;
    remoteCommit?: string;
    currentBranch?: string;
    upstreamRef?: string;
    remote?: string;
    branch?: string;
    ahead?: number;
    behind?: number;
    lastCheckedAt?: string;
    lastAppliedAt?: string;
    lastError?: string;
    blockers: string[];
    warnings: string[];
    logs: string[];
    updaterLock?: WorkflowUpdateLock;
    restartRequired?: boolean;
    generatedAt: string;
}

export interface WorkflowUpdateManagerOptions {
    projectRoot: string;
    host: string;
    port: number;
    authToken: string;
    codexExecutablePath?: string;
    getRuntimeBlockers: () => string[];
    emit: (type: string, payload: any) => void;
}

const UPDATE_LOCK_STALE_AFTER_MS = 120_000;
const DEFAULT_INTERVAL_SEC = 300;

export class WorkflowUpdateManager {
    private status: WorkflowUpdateStatus;
    private timer?: NodeJS.Timeout;
    private checking = false;
    private applying = false;

    constructor(private readonly options: WorkflowUpdateManagerOptions) {
        this.status = {
            ...defaultUpdateStatus(options.projectRoot, readWorkflowUpdateConfig().autoUpdateMode),
            ...readUpdateState(options.projectRoot),
            projectRoot: options.projectRoot,
            generatedAt: new Date().toISOString(),
        };
    }

    public start(): void {
        const config = readWorkflowUpdateConfig();
        const intervalSec = Math.max(30, Number(process.env.CODEX_WORKFLOW_UPDATE_INTERVAL_SEC || config.updateIntervalSec || DEFAULT_INTERVAL_SEC));
        this.timer = setInterval(() => void this.checkNow({ allowAutoApply: true }), intervalSec * 1000);
        this.timer.unref?.();
        void this.checkNow({ allowAutoApply: false });
    }

    public stop(): void {
        if (this.timer) clearInterval(this.timer);
    }

    public currentStatus(): WorkflowUpdateStatus {
        const persisted = readUpdateState(this.options.projectRoot);
        const lock = readUpdateLock();
        this.status = normalizeStatus({
            ...this.status,
            ...persisted,
            updaterLock: lock || persisted.updaterLock,
            autoUpdateMode: readWorkflowUpdateConfig().autoUpdateMode || this.status.autoUpdateMode,
            generatedAt: new Date().toISOString(),
        }, this.options.projectRoot);
        return this.status;
    }

    public async checkNow(options: { allowAutoApply?: boolean } = {}): Promise<WorkflowUpdateStatus> {
        if (this.checking) return this.currentStatus();
        this.checking = true;
        try {
            const status = await this.computeStatus();
            this.setStatus(status);
            if (status.updateAvailable) {
                this.options.emit(status.blockers.length ? 'update.blocked' : 'update.detected', status);
            }
            if (options.allowAutoApply && status.updateAvailable && status.autoUpdateMode === 'autoWhenIdle' && status.blockers.length === 0) {
                void this.applyNow(false);
            }
            return status;
        } finally {
            this.checking = false;
        }
    }

    public async applyNow(restartOnly = false): Promise<WorkflowUpdateStatus> {
        if (this.applying) return this.currentStatus();
        this.applying = true;
        try {
            const status = restartOnly ? this.statusForRestart() : await this.computeStatus();
            if (status.blockers.length > 0) {
                const blocked = { ...status, status: 'blocked' as WorkflowUpdateState, generatedAt: new Date().toISOString() };
                this.setStatus(blocked);
                this.options.emit('update.blocked', blocked);
                return blocked;
            }
            if (!restartOnly && !status.updateAvailable) {
                const upToDate = { ...status, status: 'upToDate' as WorkflowUpdateState, generatedAt: new Date().toISOString() };
                this.setStatus(upToDate);
                return upToDate;
            }
            const updaterPath = path.join(this.options.projectRoot, 'out', 'workflow-app', 'updater.js');
            if (!fs.existsSync(updaterPath)) {
                const failed = {
                    ...status,
                    status: 'failed' as WorkflowUpdateState,
                    lastError: `Updater build is missing: ${updaterPath}`,
                    generatedAt: new Date().toISOString(),
                };
                this.setStatus(failed);
                this.options.emit('update.failed', failed);
                return failed;
            }
            const args = [
                updaterPath,
                `--project-root=${this.options.projectRoot}`,
                `--host=${this.options.host}`,
                `--port=${this.options.port}`,
                `--parent-pid=${process.pid}`,
                ...(this.options.codexExecutablePath ? [`--codex=${this.options.codexExecutablePath}`] : []),
                ...(restartOnly ? ['--restart-only'] : []),
            ];
            const applying = {
                ...status,
                status: 'applying' as WorkflowUpdateState,
                logs: [...(status.logs || []).slice(-20), `${new Date().toISOString()} updater helper spawned`],
                generatedAt: new Date().toISOString(),
            };
            this.setStatus(applying);
            this.options.emit('update.started', applying);
            const child = spawn(process.execPath, args, {
                cwd: this.options.projectRoot,
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
                env: {
                    ...process.env,
                    CODEX_WORKFLOW_AUTH_TOKEN: this.options.authToken,
                    CODEX_WORKFLOW_PROJECT_ROOT: this.options.projectRoot,
                    CODEX_WORKFLOW_PORT: String(this.options.port),
                    ...(this.options.codexExecutablePath ? { CODEX_EXECUTABLE_PATH: this.options.codexExecutablePath } : {}),
                },
            });
            child.unref();
            return applying;
        } finally {
            this.applying = false;
        }
    }

    public async restartNow(): Promise<WorkflowUpdateStatus> {
        return this.applyNow(true);
    }

    public async setAutoUpdateMode(mode: AutoUpdateMode): Promise<WorkflowUpdateStatus> {
        ensureLocalConfigPatch({ autoUpdateMode: normalizeAutoUpdateMode(mode) });
        return this.checkNow({ allowAutoApply: false });
    }

    private async computeStatus(): Promise<WorkflowUpdateStatus> {
        const config = readWorkflowUpdateConfig();
        const mode = config.autoUpdateMode || 'autoWhenIdle';
        const base = defaultUpdateStatus(this.options.projectRoot, mode);
        const updateLock = readUpdateLock();
        const blockers = this.safetyBlockers(updateLock);
        if (mode === 'off') {
            return {
                ...base,
                status: 'unavailable',
                blockers,
                warnings: ['auto update is disabled'],
                updaterLock: updateLock,
                generatedAt: new Date().toISOString(),
            };
        }
        const remote = process.env.CODEX_WORKFLOW_UPDATE_REMOTE || config.updateRemote || 'origin';
        try {
            ensureGitRepo(this.options.projectRoot);
            git(['fetch', '--quiet', '--prune', remote], this.options.projectRoot, 60_000);
            const currentCommit = git(['rev-parse', 'HEAD'], this.options.projectRoot).trim();
            const currentBranch = gitSafe(['branch', '--show-current'], this.options.projectRoot)?.trim() || '';
            const configuredBranch = process.env.CODEX_WORKFLOW_UPDATE_BRANCH || config.updateBranch || '';
            const upstreamRef = resolveUpstreamRef(this.options.projectRoot, remote, configuredBranch, currentBranch);
            const remoteCommit = git(['rev-parse', upstreamRef], this.options.projectRoot).trim();
            const behind = Number(gitSafe(['rev-list', '--count', `HEAD..${upstreamRef}`], this.options.projectRoot)?.trim() || 0);
            const ahead = Number(gitSafe(['rev-list', '--count', `${upstreamRef}..HEAD`], this.options.projectRoot)?.trim() || 0);
            const dirty = dirtySourcePaths(this.options.projectRoot);
            const nextBlockers = [...blockers];
            if (dirty.length > 0) nextBlockers.push(`dirty source files: ${dirty.slice(0, 8).join(', ')}${dirty.length > 8 ? ` (+${dirty.length - 8})` : ''}`);
            if (ahead > 0) nextBlockers.push(`local branch is ahead of ${upstreamRef}; auto update requires a fast-forward only lane`);
            const updateAvailable = behind > 0 && currentCommit !== remoteCommit;
            return {
                ...base,
                status: updateAvailable ? (nextBlockers.length ? 'blocked' : 'available') : 'upToDate',
                updateAvailable,
                autoUpdateMode: mode,
                currentCommit,
                remoteCommit,
                currentBranch,
                upstreamRef,
                remote,
                branch: configuredBranch || currentBranch || 'master',
                ahead,
                behind,
                lastCheckedAt: new Date().toISOString(),
                blockers: nextBlockers,
                warnings: dirty.length > 0 ? ['local dirty source changes are never stashed or reset automatically'] : [],
                updaterLock: updateLock,
                generatedAt: new Date().toISOString(),
            };
        } catch (e: any) {
            return {
                ...base,
                status: 'unavailable',
                autoUpdateMode: mode,
                lastCheckedAt: new Date().toISOString(),
                lastError: e?.message || String(e),
                blockers,
                warnings: ['update check failed'],
                updaterLock: updateLock,
                generatedAt: new Date().toISOString(),
            };
        }
    }

    private statusForRestart(): WorkflowUpdateStatus {
        const blockers = this.runtimeOnlyBlockers(readUpdateLock());
        return {
            ...this.currentStatus(),
            blockers,
            generatedAt: new Date().toISOString(),
        };
    }

    private safetyBlockers(updateLock: WorkflowUpdateLock | undefined): string[] {
        return [
            ...this.runtimeOnlyBlockers(updateLock),
            ...gitSafetyBlockers(this.options.projectRoot),
        ];
    }

    private runtimeOnlyBlockers(updateLock: WorkflowUpdateLock | undefined): string[] {
        const blockers = [...this.options.getRuntimeBlockers()];
        if (updateLock && updateLock.status === 'active') blockers.push(`updater is already running (pid ${updateLock.pid})`);
        return blockers;
    }

    private setStatus(status: WorkflowUpdateStatus): void {
        this.status = normalizeStatus(status, this.options.projectRoot);
        saveUpdateState(this.status);
    }
}

export function workflowAppHome(): string {
    return path.join(os.homedir(), '.codex-workflow');
}

export function workflowUpdateStatePath(): string {
    return path.join(workflowAppHome(), 'update-state.json');
}

export function workflowUpdateLockPath(): string {
    return path.join(workflowAppHome(), 'update.lock');
}

export function readWorkflowUpdateConfig(): WorkflowUpdateConfig {
    const configPath = path.join(workflowAppHome(), 'config.json');
    try {
        if (!fs.existsSync(configPath)) return envUpdateConfig();
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, ''));
        return {
            ...envUpdateConfig(),
            autoUpdateMode: normalizeAutoUpdateMode(process.env.CODEX_WORKFLOW_AUTO_UPDATE || raw.autoUpdateMode),
            updateIntervalSec: Number.isFinite(Number(process.env.CODEX_WORKFLOW_UPDATE_INTERVAL_SEC || raw.updateIntervalSec))
                ? Number(process.env.CODEX_WORKFLOW_UPDATE_INTERVAL_SEC || raw.updateIntervalSec)
                : undefined,
            updateRemote: typeof (process.env.CODEX_WORKFLOW_UPDATE_REMOTE || raw.updateRemote) === 'string'
                ? String(process.env.CODEX_WORKFLOW_UPDATE_REMOTE || raw.updateRemote)
                : undefined,
            updateBranch: typeof (process.env.CODEX_WORKFLOW_UPDATE_BRANCH || raw.updateBranch) === 'string'
                ? String(process.env.CODEX_WORKFLOW_UPDATE_BRANCH || raw.updateBranch)
                : undefined,
        };
    } catch {
        return envUpdateConfig();
    }
}

export function normalizeAutoUpdateMode(value: any): AutoUpdateMode {
    const mode = String(value || 'autoWhenIdle');
    return mode === 'off' || mode === 'notify' || mode === 'autoWhenIdle' ? mode as AutoUpdateMode : 'autoWhenIdle';
}

export function readUpdateState(projectRoot: string): Partial<WorkflowUpdateStatus> {
    try {
        const p = workflowUpdateStatePath();
        if (!fs.existsSync(p)) return {};
        return normalizeStatus(JSON.parse(fs.readFileSync(p, 'utf-8')), projectRoot);
    } catch {
        return {};
    }
}

export function saveUpdateState(status: WorkflowUpdateStatus): void {
    fs.mkdirSync(workflowAppHome(), { recursive: true });
    fs.writeFileSync(workflowUpdateStatePath(), JSON.stringify(status, null, 2), 'utf-8');
}

export function readUpdateLock(): WorkflowUpdateLock | undefined {
    try {
        const p = workflowUpdateLockPath();
        if (!fs.existsSync(p)) return undefined;
        const lock = JSON.parse(fs.readFileSync(p, 'utf-8')) as WorkflowUpdateLock;
        return assessUpdateLock(lock);
    } catch {
        return {
            pid: 0,
            projectRoot: '',
            createdAt: '',
            updatedAt: '',
            status: 'stale',
            staleReason: 'unreadable update lock',
        };
    }
}

export function writeUpdateLock(lock: WorkflowUpdateLock): void {
    fs.mkdirSync(workflowAppHome(), { recursive: true });
    fs.writeFileSync(workflowUpdateLockPath(), JSON.stringify(lock, null, 2), 'utf-8');
}

export function releaseUpdateLock(): void {
    try {
        const p = workflowUpdateLockPath();
        if (!fs.existsSync(p)) return;
        const lock = JSON.parse(fs.readFileSync(p, 'utf-8')) as WorkflowUpdateLock;
        lock.status = 'released';
        lock.updatedAt = new Date().toISOString();
        fs.writeFileSync(p, JSON.stringify(lock, null, 2), 'utf-8');
        fs.unlinkSync(p);
    } catch {
        // Stale lock detection covers leftovers.
    }
}

export function ensureLocalConfigPatch(patch: Record<string, any>): void {
    const configPath = path.join(workflowAppHome(), 'config.json');
    let current: Record<string, any> = {};
    try {
        if (fs.existsSync(configPath)) current = JSON.parse(fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, ''));
    } catch {
        current = {};
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8');
}

export function copyPluginToCodexCache(projectRoot: string): { copied: boolean; cachePath?: string; warning?: string } {
    try {
        const manifestPath = path.join(projectRoot, 'plugins', 'codex-workflow', '.codex-plugin', 'plugin.json');
        if (!fs.existsSync(manifestPath)) return { copied: false, warning: 'plugin manifest not found' };
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const version = String(manifest.version || '0.1.0');
        const source = path.join(projectRoot, 'plugins', 'codex-workflow');
        const target = path.join(os.homedir(), '.codex', 'plugins', 'cache', 'haram-ai-agent-local', 'codex-workflow', version);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        fs.cpSync(source, target, {
            recursive: true,
            filter: src => !/[\\/]node_modules([\\/]|$)/i.test(src),
        });
        return { copied: true, cachePath: target };
    } catch (e: any) {
        return { copied: false, warning: e?.message || String(e) };
    }
}

export function waitForHealth(host: string, port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return new Promise(resolve => {
        const tick = () => {
            requestJson(host, port, '/api/health', 1000)
                .then(value => resolve(!!value?.ok))
                .catch(() => {
                    if (Date.now() >= deadline) resolve(false);
                    else setTimeout(tick, 400);
                });
        };
        tick();
    });
}

export function waitForPortClosed(host: string, port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return new Promise(resolve => {
        const tick = () => {
            requestJson(host, port, '/api/health', 700)
                .then(() => {
                    if (Date.now() >= deadline) resolve(false);
                    else setTimeout(tick, 250);
                })
                .catch(() => resolve(true));
        };
        tick();
    });
}

export function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): { stdout: string; stderr: string; status: number } {
    const res = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
        timeout: timeoutMs,
        windowsHide: true,
        shell: process.platform === 'win32',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    if (res.error) throw res.error;
    if (typeof res.status === 'number' && res.status !== 0) {
        throw new Error((res.stderr || res.stdout || `${command} ${args.join(' ')} failed with exit ${res.status}`).trim());
    }
    return { stdout: res.stdout || '', stderr: res.stderr || '', status: res.status || 0 };
}

export function fileHash(filePath: string): string {
    try {
        if (!fs.existsSync(filePath)) return '';
        return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    } catch {
        return '';
    }
}

function requestJson(host: string, port: number, route: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
        const req = http.request({ host, port, path: route, method: 'GET', timeout: timeoutMs }, res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf-8');
                if ((res.statusCode || 500) < 200 || (res.statusCode || 500) >= 300) return reject(new Error(text || `HTTP ${res.statusCode}`));
                try { resolve(text ? JSON.parse(text) : null); }
                catch { resolve(text); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('request timeout')));
        req.on('error', reject);
        req.end();
    });
}

function defaultUpdateStatus(projectRoot: string, mode: AutoUpdateMode = 'autoWhenIdle'): WorkflowUpdateStatus {
    return {
        status: 'unknown',
        updateAvailable: false,
        autoUpdateMode: mode,
        projectRoot,
        blockers: [],
        warnings: [],
        logs: [],
        generatedAt: new Date().toISOString(),
    };
}

function normalizeStatus(value: Partial<WorkflowUpdateStatus>, projectRoot: string): WorkflowUpdateStatus {
    return {
        ...defaultUpdateStatus(projectRoot),
        ...value,
        autoUpdateMode: normalizeAutoUpdateMode(value.autoUpdateMode),
        blockers: Array.isArray(value.blockers) ? value.blockers.map(String) : [],
        warnings: Array.isArray(value.warnings) ? value.warnings.map(String) : [],
        logs: Array.isArray(value.logs) ? value.logs.map(String).slice(-80) : [],
        projectRoot,
        generatedAt: new Date().toISOString(),
    };
}

function envUpdateConfig(): WorkflowUpdateConfig {
    return {
        autoUpdateMode: normalizeAutoUpdateMode(process.env.CODEX_WORKFLOW_AUTO_UPDATE),
        updateIntervalSec: Number.isFinite(Number(process.env.CODEX_WORKFLOW_UPDATE_INTERVAL_SEC)) ? Number(process.env.CODEX_WORKFLOW_UPDATE_INTERVAL_SEC) : undefined,
        updateRemote: process.env.CODEX_WORKFLOW_UPDATE_REMOTE,
        updateBranch: process.env.CODEX_WORKFLOW_UPDATE_BRANCH,
    };
}

function ensureGitRepo(cwd: string): void {
    git(['rev-parse', '--is-inside-work-tree'], cwd);
}

function resolveUpstreamRef(cwd: string, remote: string, configuredBranch: string, currentBranch: string): string {
    if (configuredBranch) return configuredBranch.includes('/') ? configuredBranch : `${remote}/${configuredBranch}`;
    const upstream = gitSafe(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd)?.trim();
    if (upstream) return upstream;
    return `${remote}/${currentBranch || 'master'}`;
}

function dirtySourcePaths(cwd: string): string[] {
    const lines = (gitSafe(['status', '--porcelain', '-uall'], cwd) || '').split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean);
    return lines
        .map(parseStatusPath)
        .filter(Boolean)
        .filter(filePath => !isUpdateIgnoredPath(filePath))
        .sort();
}

function parseStatusPath(line: string): string {
    const raw = line.length > 3 ? line.slice(3).trim() : line.trim();
    const pathPart = raw.includes(' -> ') ? raw.split(' -> ').pop() || raw : raw;
    return pathPart.replace(/^"|"$/g, '').replace(/\\/g, '/');
}

function isUpdateIgnoredPath(filePath: string): boolean {
    return filePath.startsWith('.ai-agent/')
        || filePath.startsWith('out/')
        || filePath === ''
        || /\.log$/i.test(filePath);
}

function gitSafetyBlockers(projectRoot: string): string[] {
    const blockers: string[] = [];
    try {
        const locks = readWorkflowWriterLocks(projectRoot);
        if (locks.activeLocks.length > 0) blockers.push(`workflow writer lock active: ${locks.activeLocks.map(lock => lock.runId).join(', ')}`);
        const routing = readGitRoutingMutex(projectRoot);
        if (routing?.status === 'active') blockers.push(`git routing mutex active: ${routing.runId || 'unknown'}`);
    } catch (e: any) {
        blockers.push(`git safety lock check failed: ${e?.message || String(e)}`);
    }
    return blockers;
}

function assessUpdateLock(lock: WorkflowUpdateLock): WorkflowUpdateLock {
    if (lock.status !== 'active') return lock;
    const updated = Date.parse(lock.updatedAt || '');
    const ageMs = Number.isFinite(updated) ? Date.now() - updated : Number.POSITIVE_INFINITY;
    if (ageMs > UPDATE_LOCK_STALE_AFTER_MS) {
        return { ...lock, status: 'stale', staleReason: `heartbeat older than ${Math.round(ageMs / 1000)}s` };
    }
    if (lock.pid > 0 && !isPidAlive(lock.pid)) {
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

function git(args: string[], cwd: string, timeout = 30_000): string {
    return runCommand('git', args, cwd, timeout).stdout || '';
}

function gitSafe(args: string[], cwd: string, timeout = 30_000): string | null {
    try {
        return git(args, cwd, timeout);
    } catch {
        return null;
    }
}
