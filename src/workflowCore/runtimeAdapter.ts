import {
    CodexAppServerClient,
    CodexJsonRpcMessage,
    CodexTurnResult,
    probeCodexExecutable,
    resolveCodexExecutable,
} from './codexAppServerClient';
import { spawn } from 'child_process';
import * as readline from 'readline';
import type { ServerNotification, ServerRequest } from '../generated/codex-app-server';
import type { CodexRuntime, SelectedCodexRuntime, WorkflowRunKind } from './store';

export type AppServerProtocolMessage = CodexJsonRpcMessage & Partial<ServerNotification & ServerRequest>;

export interface CodexRuntimeAdapterOptions {
    executable?: string;
    cwd: string;
    onEvent?: (msg: AppServerProtocolMessage | any) => void;
    onStderr?: (chunk: string) => void;
    requestTimeoutMs?: number;
}

export interface RuntimeThreadParams {
    cwd?: string;
    approvalPolicy?: string;
    sandbox?: string;
    sandboxPolicy?: any;
    serviceName?: string;
    model?: string;
    settings?: any;
}

export interface RuntimeTurnParams {
    threadId?: string;
    input: Array<{ type: string; text?: string; path?: string }>;
    cwd?: string;
    approvalPolicy?: string;
    sandboxPolicy?: any;
    settings?: any;
    model?: string;
}

export interface CodexRuntimeAdapter {
    readonly kind: SelectedCodexRuntime;
    readonly version?: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    accountRead(): Promise<any>;
    modelList(): Promise<any>;
    startThread(params: RuntimeThreadParams): Promise<any>;
    resumeThread(threadId: string, params?: RuntimeThreadParams): Promise<any>;
    forkThread(threadId: string): Promise<any>;
    compactThread(threadId: string): Promise<void>;
    runTurn(params: RuntimeTurnParams, timeoutMs?: number): Promise<CodexTurnResult>;
    runStandalone?(prompt: string, params: RuntimeThreadParams, timeoutMs?: number): Promise<CodexTurnResult>;
}

export class AppServerRuntimeAdapter implements CodexRuntimeAdapter {
    public readonly kind = 'app-server' as const;
    public readonly version?: string;
    private client: CodexAppServerClient | null = null;

    constructor(private readonly options: CodexRuntimeAdapterOptions) {
        this.version = probeCodexExecutable(resolveCodexExecutable(options.executable)).version;
    }

    public async start(): Promise<void> {
        if (this.client) return;
        const executable = resolveCodexExecutable(this.options.executable);
        this.client = new CodexAppServerClient({
            executable,
            cwd: this.options.cwd,
            onEvent: msg => this.options.onEvent?.(msg as AppServerProtocolMessage),
            onStderr: this.options.onStderr,
            requestTimeoutMs: this.options.requestTimeoutMs,
        });
        await this.client.start();
    }

    public async stop(): Promise<void> {
        await this.client?.stop();
        this.client = null;
    }

    public accountRead(): Promise<any> {
        return this.requireClient().accountRead();
    }

    public modelList(): Promise<any> {
        return this.requireClient().modelList();
    }

    public startThread(params: RuntimeThreadParams): Promise<any> {
        return this.requireClient().startThread(params);
    }

    public resumeThread(threadId: string, params: RuntimeThreadParams = {}): Promise<any> {
        return this.requireClient().resumeThread(threadId, params);
    }

    public forkThread(threadId: string): Promise<any> {
        return this.requireClient().forkThread(threadId);
    }

    public compactThread(threadId: string): Promise<void> {
        return this.requireClient().compactThread(threadId);
    }

    public runTurn(params: RuntimeTurnParams, timeoutMs?: number): Promise<CodexTurnResult> {
        return this.requireClient().runTurn(params, timeoutMs);
    }

    private requireClient(): CodexAppServerClient {
        if (!this.client) throw new Error('Codex app-server runtime is not started.');
        return this.client;
    }
}

export class SdkRuntimeAdapter implements CodexRuntimeAdapter {
    public readonly kind = 'sdk' as const;
    public readonly version = 'sdk';
    private codex: any;
    private threads = new Map<string, any>();
    private nextThreadId = 1;

    constructor(private readonly options: CodexRuntimeAdapterOptions) {}

    public async start(): Promise<void> {
        if (this.codex) return;
        const mod = await import('@openai/codex-sdk');
        this.codex = new mod.Codex({
            codexPathOverride: this.options.executable ? resolveCodexExecutable(this.options.executable) : undefined,
            env: process.env as Record<string, string>,
        });
    }

    public async stop(): Promise<void> {
        this.threads.clear();
        this.codex = null;
    }

    public async accountRead(): Promise<any> {
        return { requiresOpenaiAuth: false, account: { source: 'codex-sdk' } };
    }

    public async modelList(): Promise<any> {
        return { data: [] };
    }

    public async startThread(params: RuntimeThreadParams = {}): Promise<any> {
        await this.start();
        const thread = this.codex.startThread(this.toThreadOptions(params));
        const id = `sdk-thread-${this.nextThreadId++}`;
        this.threads.set(id, thread);
        return { thread: { id } };
    }

    public async resumeThread(threadId: string, params: RuntimeThreadParams = {}): Promise<any> {
        await this.start();
        const thread = this.codex.resumeThread(threadId, this.toThreadOptions(params));
        this.threads.set(threadId, thread);
        return { thread: { id: threadId } };
    }

    public async forkThread(threadId: string): Promise<any> {
        throw new Error(`Codex SDK runtime does not support thread fork for ${threadId}. Use app-server runtime.`);
    }

    public async compactThread(threadId: string): Promise<void> {
        throw new Error(`Codex SDK runtime does not support compaction for ${threadId}. Use app-server runtime.`);
    }

    public async runTurn(params: RuntimeTurnParams, timeoutMs = 30 * 60 * 1000): Promise<CodexTurnResult> {
        await this.start();
        const threadId = params.threadId || (await this.startThread(params)).thread.id;
        const input = params.input.map(i => i.text || i.path || '').filter(Boolean).join('\n\n');
        return this.runCodexExecFallback(threadId, input, params, timeoutMs);
    }

    public async runStandalone(prompt: string, params: RuntimeThreadParams = {}, timeoutMs = 30 * 60 * 1000): Promise<CodexTurnResult> {
        const res = await this.startThread(params);
        return this.runTurn({
            threadId: res.thread.id,
            input: [{ type: 'text', text: prompt }],
            cwd: params.cwd,
            approvalPolicy: params.approvalPolicy,
            sandboxPolicy: params.sandbox === 'readOnly' ? { type: 'readOnly' } : { type: 'workspaceWrite' },
            model: params.model,
        }, timeoutMs);
    }

    private async runThread(thread: any, threadId: string, input: string, params: RuntimeTurnParams, timeoutMs: number): Promise<CodexTurnResult> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let turnId = '';
        let diff = '';
        try {
            const streamed = await thread.runStreamed(input, { signal: controller.signal });
            let text = '';
            for await (const event of streamed.events) {
                this.options.onEvent?.(event);
                if (event.type === 'thread.started') {
                    turnId = event.thread_id || turnId;
                } else if (event.type === 'item.completed') {
                    const item = event.item || {};
                    if (item.type === 'agent_message') text = item.text || text;
                    if (item.type === 'command_execution' && item.aggregated_output) text += `\n\n[command]\n${item.aggregated_output}`;
                    if (item.type === 'file_change' && Array.isArray(item.changes)) {
                        diff += item.changes.map((c: any) => `${c.kind}: ${c.path}`).join('\n');
                    }
                } else if (event.type === 'turn.failed') {
                    throw new Error(event.error?.message || 'Codex SDK turn failed.');
                } else if (event.type === 'error') {
                    throw new Error(event.message || 'Codex SDK error.');
                }
            }
            return { turnId: turnId || threadId, status: 'completed', text: text.trim(), diff };
        } catch (e: any) {
            if (/Failed to parse item/i.test(e?.message || '')) {
                return this.runCodexExecFallback(threadId, input, params, timeoutMs);
            }
            return { turnId: turnId || threadId, status: 'failed', text: '', diff, error: e?.message || String(e) };
        } finally {
            clearTimeout(timer);
        }
    }

    private runCodexExecFallback(threadId: string, input: string, params: RuntimeTurnParams, timeoutMs: number): Promise<CodexTurnResult> {
        return new Promise(resolve => {
            const executable = resolveCodexExecutable(this.options.executable);
            const cwd = params.cwd || this.options.cwd;
            const sandbox = params.sandboxPolicy?.type === 'readOnly' ? 'read-only' : 'workspace-write';
            const args = [
                'exec',
                '--experimental-json',
                '--sandbox', sandbox,
                '--skip-git-repo-check',
                '-C', cwd,
                '--config', `approval_policy="${normalizeApprovalPolicy(params.approvalPolicy)}"`,
            ];
            if (params.model) args.push('--model', params.model);
            const usePromptArg = input.length < 6000;
            if (usePromptArg) args.push(input);
            const child = spawn(executable, args, {
                cwd,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: process.env,
            });
            let text = '';
            let diff = '';
            let error = '';
            let turnId = threadId;
            let settled = false;
            const finish = (code?: number | null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                rl.close();
                if (code !== undefined && code !== null && code !== 0 && !error) error = `Codex SDK fallback exited with code ${code}.`;
                try { if (!child.killed) child.kill(); } catch { /* ignore */ }
                resolve({
                    turnId,
                    status: error ? 'failed' : 'completed',
                    text: text.trim(),
                    diff,
                    error: error || undefined,
                });
            };
            const timer = setTimeout(() => {
                error = `Codex SDK fallback timed out after ${Math.round(timeoutMs / 1000)}s.`;
                finish(null);
            }, timeoutMs);
            if (!usePromptArg) child.stdin.write(input);
            child.stdin.end();
            child.stderr.on('data', chunk => this.options.onStderr?.(chunk.toString()));
            const rl = readline.createInterface({ input: child.stdout });
            rl.on('line', line => {
                let event: any;
                try { event = JSON.parse(line); }
                catch {
                    this.options.onEvent?.({ type: 'sdk.nonJsonLine', line });
                    return;
                }
                this.options.onEvent?.(event);
                if (event.type === 'thread.started') turnId = event.thread_id || turnId;
                if (event.type === 'item.completed') {
                    const item = event.item || {};
                    if (item.type === 'agent_message') text = item.text || text;
                    if (item.type === 'command_execution' && item.aggregated_output) text += `\n\n[command]\n${item.aggregated_output}`;
                    if (item.type === 'file_change' && Array.isArray(item.changes)) diff += item.changes.map((c: any) => `${c.kind}: ${c.path}`).join('\n');
                }
                if (event.type === 'turn.failed') error = event.error?.message || 'Codex fallback turn failed.';
                if (event.type === 'error') error = event.message || 'Codex fallback error.';
                if (event.type === 'turn.completed') finish(0);
            });
            child.once('exit', code => {
                finish(code);
            });
            child.once('error', err => {
                error = err.message;
                finish(null);
            });
        });
    }

    private toThreadOptions(params: RuntimeThreadParams): any {
        const sandboxMode = params.sandbox === 'readOnly' || params.sandboxPolicy?.type === 'readOnly'
            ? 'read-only'
            : 'workspace-write';
        return {
            workingDirectory: params.cwd || this.options.cwd,
            approvalPolicy: normalizeApprovalPolicy(params.approvalPolicy),
            sandboxMode,
            skipGitRepoCheck: true,
            networkAccessEnabled: false,
            model: params.model,
        };
    }
}

export function resolveSelectedRuntime(preferred: CodexRuntime | undefined, runKind: WorkflowRunKind | undefined): SelectedCodexRuntime {
    if (preferred === 'sdk') return 'sdk';
    if (preferred === 'app-server') return 'app-server';
    if (runKind === 'automation' || runKind === 'readOnly') return 'sdk';
    return 'app-server';
}

export function canRunWithSdk(runKind: WorkflowRunKind | undefined): boolean {
    return runKind === 'automation' || runKind === 'readOnly';
}

export function createRuntimeAdapter(kind: SelectedCodexRuntime, options: CodexRuntimeAdapterOptions): CodexRuntimeAdapter {
    return kind === 'sdk' ? new SdkRuntimeAdapter(options) : new AppServerRuntimeAdapter(options);
}

export function isSdkRuntimeAvailable(): boolean {
    try {
        require.resolve('@openai/codex-sdk');
        return true;
    } catch {
        // The workflow app bundle may inline the SDK, which makes require.resolve
        // unreliable from the generated out/ file even though dynamic import works.
        return true;
    }
}

function normalizeApprovalPolicy(value: string | undefined): 'never' | 'on-request' | 'on-failure' | 'untrusted' {
    if (value === 'on-request' || value === 'on-failure' || value === 'untrusted') return value;
    return 'never';
}
