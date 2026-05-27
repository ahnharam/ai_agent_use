import { spawn, spawnSync, ChildProcessWithoutNullStreams } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

export interface CodexJsonRpcMessage {
    id?: number | string;
    method?: string;
    params?: any;
    result?: any;
    error?: { code?: number; message?: string; data?: any };
}

export interface CodexTurnResult {
    turnId: string;
    status: string;
    text: string;
    diff?: string;
    error?: string;
}

export interface CodexAppServerClientOptions {
    executable: string;
    cwd: string;
    onEvent?: (msg: CodexJsonRpcMessage) => void;
    onStderr?: (chunk: string) => void;
    requestTimeoutMs?: number;
}

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
}

interface PendingTurn {
    threadId: string;
    turnId: string;
    text: string;
    diff?: string;
    error?: string;
    resolve: (value: CodexTurnResult) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
}

export function resolveCodexExecutable(configuredPath?: string): string {
    const trimmed = (configuredPath || '').trim();
    if (trimmed) return trimmed;
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || '';
        if (localAppData) {
            const localCodex = path.join(localAppData, 'OpenAI', 'Codex', 'bin', 'codex.exe');
            if (fs.existsSync(localCodex)) return localCodex;
        }
    }
    return 'codex';
}

export function probeCodexExecutable(executable: string): { ok: boolean; executable: string; message: string; version?: string } {
    if (executable !== 'codex' && !fs.existsSync(executable)) {
        return { ok: false, executable, message: `Configured Codex executable does not exist: ${executable}` };
    }
    try {
        const res = spawnSync(executable, ['--version'], {
            encoding: 'utf-8',
            timeout: 10000,
            windowsHide: true,
            env: process.env,
        });
        if (res.error) {
            return { ok: false, executable, message: res.error.message };
        }
        if (res.status !== 0) {
            const detail = (res.stderr || res.stdout || '').trim() || `exit ${res.status}`;
            return { ok: false, executable, message: detail };
        }
        return { ok: true, executable, message: 'Codex executable is runnable.', version: (res.stdout || res.stderr || '').trim() };
    } catch (e: any) {
        return { ok: false, executable, message: e?.message || String(e) };
    }
}

export class CodexAppServerClient {
    private proc: ChildProcessWithoutNullStreams | null = null;
    private rl: readline.Interface | null = null;
    private nextId = 1;
    private pending = new Map<number | string, PendingRequest>();
    private turns = new Map<string, PendingTurn>();
    private started = false;

    constructor(private readonly options: CodexAppServerClientOptions) {}

    public async start(): Promise<void> {
        if (this.started) return;
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const fail = (err: Error) => {
                if (settled) return;
                settled = true;
                reject(err);
            };
            const ok = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            try {
                this.proc = spawn(this.options.executable, ['app-server'], {
                    cwd: this.options.cwd,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true,
                    env: process.env,
                });
            } catch (e: any) {
                fail(new Error(`Failed to launch codex app-server: ${e?.message || e}`));
                return;
            }

            const proc = this.proc;
            proc.once('error', err => fail(new Error(`Failed to launch codex app-server: ${err.message}`)));
            proc.stderr.on('data', (chunk: Buffer) => this.options.onStderr?.(chunk.toString()));
            proc.once('spawn', () => ok());
        });

        if (!this.proc) throw new Error('codex app-server process did not start.');
        this.rl = readline.createInterface({ input: this.proc.stdout });
        this.rl.on('line', line => this.handleLine(line));
        this.proc.once('exit', (code, signal) => {
            this.started = false;
            const exitReason = signal || (code ?? 'unknown');
            const err = new Error(`codex app-server exited (${exitReason})`);
            for (const p of this.pending.values()) {
                clearTimeout(p.timer);
                p.reject(err);
            }
            this.pending.clear();
            for (const t of this.turns.values()) {
                clearTimeout(t.timer);
                t.reject(err);
            }
            this.turns.clear();
        });

        await this.request('initialize', {
            clientInfo: {
                name: 'haram_ai_agent_codex_workflow',
                title: 'Haram AI Agent Codex Workflow',
                version: '0.1.0',
            },
            capabilities: { experimentalApi: true },
        });
        this.notify('initialized', {});
        this.started = true;
    }

    public async stop(): Promise<void> {
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        if (this.proc) {
            try { this.proc.kill(); } catch { /* ignore */ }
            this.proc = null;
        }
        this.started = false;
    }

    public async accountRead(): Promise<any> {
        return this.request('account/read', { refreshToken: false });
    }

    public async modelList(): Promise<any> {
        return this.request('model/list', { limit: 50, includeHidden: false });
    }

    public async startThread(params: any): Promise<any> {
        return this.request('thread/start', params);
    }

    public async resumeThread(threadId: string, params: any = {}): Promise<any> {
        return this.request('thread/resume', { threadId, ...params });
    }

    public async forkThread(threadId: string): Promise<any> {
        return this.request('thread/fork', { threadId });
    }

    public async compactThread(threadId: string): Promise<void> {
        await this.request('thread/compact/start', { threadId });
    }

    public async interruptTurn(threadId: string, turnId: string): Promise<void> {
        await this.request('turn/interrupt', { threadId, turnId });
    }

    public async runTurn(params: any, timeoutMs = 30 * 60 * 1000): Promise<CodexTurnResult> {
        const started = await this.request('turn/start', params, this.options.requestTimeoutMs || 120000);
        const turnId = started?.turn?.id;
        if (!turnId) throw new Error('turn/start did not return a turn id.');
        const threadId = String(params.threadId || '');
        const key = this.turnKey(threadId, turnId);
        return new Promise<CodexTurnResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.turns.delete(key);
                reject(new Error(`Codex turn timed out after ${Math.round(timeoutMs / 1000)}s.`));
            }, timeoutMs);
            this.turns.set(key, { threadId, turnId, text: '', resolve, reject, timer });
        });
    }

    public request(method: string, params?: any, timeoutMs?: number): Promise<any> {
        if (!this.proc?.stdin.writable) {
            return Promise.reject(new Error('codex app-server is not running.'));
        }
        const id = this.nextId++;
        const timeout = timeoutMs || this.options.requestTimeoutMs || 120000;
        const message: CodexJsonRpcMessage = { method, id };
        if (params !== undefined) message.params = params;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Codex app-server request timed out: ${method}`));
            }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            this.write(message);
        });
    }

    public notify(method: string, params?: any): void {
        const message: CodexJsonRpcMessage = { method };
        if (params !== undefined) message.params = params;
        this.write(message);
    }

    private write(message: CodexJsonRpcMessage): void {
        this.proc?.stdin.write(`${JSON.stringify(message)}\n`);
    }

    private handleLine(line: string): void {
        if (!line.trim()) return;
        let msg: CodexJsonRpcMessage;
        try {
            msg = JSON.parse(line);
        } catch {
            this.options.onStderr?.(`Non-JSON app-server line: ${line}\n`);
            return;
        }

        if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
            const pending = this.pending.get(msg.id);
            if (pending) {
                clearTimeout(pending.timer);
                this.pending.delete(msg.id);
                if (msg.error) pending.reject(new Error(msg.error.message || `Codex request failed: ${msg.error.code}`));
                else pending.resolve(msg.result);
            }
            return;
        }

        if (msg.id !== undefined && msg.method) {
            this.respondToServerRequest(msg);
            return;
        }

        this.collectTurnEvent(msg);
        this.options.onEvent?.(msg);
    }

    private respondToServerRequest(msg: CodexJsonRpcMessage): void {
        const method = msg.method || '';
        let result: any = {};
        if (method.includes('requestApproval')) {
            result = { decision: 'cancel' };
        } else if (method === 'tool/requestUserInput' || method === 'item/tool/requestUserInput') {
            result = { cancelled: true };
        }
        if (msg.id !== undefined) {
            this.write({ id: msg.id, result });
        }
        this.options.onEvent?.(msg);
    }

    private collectTurnEvent(msg: CodexJsonRpcMessage): void {
        const method = msg.method || '';
        const p = msg.params || {};
        if (method === 'item/agentMessage/delta') {
            const threadId = String(p.threadId || '');
            const turnId = String(p.turnId || '');
            const delta = String(p.delta || p.text || p.value || '');
            const turn = this.turns.get(this.turnKey(threadId, turnId));
            if (turn) turn.text += delta;
            return;
        }
        if (method === 'item/completed') {
            const item = p.item || {};
            const threadId = String(p.threadId || item.threadId || '');
            const turnId = String(p.turnId || item.turnId || '');
            const turn = this.turns.get(this.turnKey(threadId, turnId));
            if (!turn) return;
            if (item.type === 'agentMessage' && item.text) {
                turn.text = String(item.text);
            }
            if (item.type === 'commandExecution' && item.aggregatedOutput) {
                turn.text += `\n\n[command]\n${String(item.aggregatedOutput)}`;
            }
            return;
        }
        if (method === 'turn/diff/updated') {
            const turn = this.turns.get(this.turnKey(String(p.threadId || ''), String(p.turnId || '')));
            if (turn) turn.diff = String(p.diff || '');
            return;
        }
        if (method === 'error') {
            const errorText = p?.error?.message || p?.message || 'Codex turn error';
            for (const turn of this.turns.values()) {
                turn.error = errorText;
            }
            return;
        }
        if (method === 'turn/completed') {
            const turnObj = p.turn || {};
            const threadId = String(p.threadId || turnObj.threadId || '');
            const turnId = String(turnObj.id || p.turnId || '');
            const key = this.turnKey(threadId, turnId);
            const turn = this.turns.get(key);
            if (!turn) return;
            clearTimeout(turn.timer);
            this.turns.delete(key);
            const status = String(turnObj.status || 'completed');
            const error = turnObj.error?.message || turn.error;
            turn.resolve({
                turnId,
                status,
                text: turn.text.trim(),
                diff: turn.diff,
                error,
            });
        }
    }

    private turnKey(threadId: string, turnId: string): string {
        return `${threadId}:${turnId}`;
    }
}
