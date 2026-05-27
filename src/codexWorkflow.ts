import * as vscode from 'vscode';
import {
    CodexWorkflowController as CoreCodexWorkflowController,
    CodexWorkflowControllerOptions as CoreCodexWorkflowControllerOptions,
    CodexWorkflowEvent,
    CodexWorkflowSnapshot,
} from './workflowCore/engine';
import type { CodexContextMode, CodexRuntime } from './workflowCore/store';

export interface CodexWorkflowControllerOptions {
    extensionPath: string;
    onUpdate?: (event: CodexWorkflowEvent) => void;
}

export type { CodexWorkflowEvent, CodexWorkflowSnapshot };

export class CodexWorkflowController {
    private readonly core: CoreCodexWorkflowController;

    constructor(options: CodexWorkflowControllerOptions) {
        const cfg = vscode.workspace.getConfiguration('haramAi');
        const coreOptions: CoreCodexWorkflowControllerOptions = {
            extensionPath: options.extensionPath,
            workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
            codexExecutablePath: cfg.get<string>('codexExecutablePath', ''),
            defaultContextMode: cfg.get<CodexContextMode>('codexDefaultContextMode', 'fresh') || 'fresh',
            runtime: cfg.get<CodexRuntime>('codexRuntime', 'auto') || 'auto',
            maxRepairLoops: cfg.get<number>('codexMaxRepairLoops', 2) || 2,
            onUpdate: options.onUpdate,
        };
        this.core = new CoreCodexWorkflowController(coreOptions);
    }

    public getState(): CodexWorkflowSnapshot {
        return this.core.getState();
    }

    public start(userPrompt: string, mode?: CodexContextMode): Promise<void> {
        return this.core.start(userPrompt, mode).then(() => undefined);
    }

    public resumeLatest(mode: CodexContextMode = 'resume'): Promise<void> {
        return this.core.resumeLatest(mode);
    }

    public cancel(): Promise<void> {
        return this.core.cancel();
    }

    public compactAgent(role: string): Promise<void> {
        return this.core.compactAgent(role);
    }

    public resetAgent(role: string): void {
        this.core.resetAgent(role);
    }

    public approveCommit(): Promise<void> {
        return this.core.approveCommit();
    }

    public approvePush(): Promise<void> {
        return this.core.approvePush();
    }
}
