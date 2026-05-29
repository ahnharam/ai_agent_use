import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import {
    copyPluginToCodexCache,
    ensureLocalConfigPatch,
    fileHash,
    releaseUpdateLock,
    runCommand,
    saveUpdateState,
    waitForHealth,
    waitForPortClosed,
    workflowUpdateLockPath,
    writeUpdateLock,
    WorkflowUpdateStatus,
} from './updateManager';

interface UpdaterArgs {
    projectRoot: string;
    host: string;
    port: number;
    parentPid: number;
    codexExecutablePath?: string;
    restartOnly: boolean;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const logs: string[] = [];
    const lock = {
        pid: process.pid,
        projectRoot: args.projectRoot,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active' as const,
    };
    writeUpdateLock(lock);
    const heartbeat = setInterval(() => {
        writeUpdateLock({ ...lock, updatedAt: new Date().toISOString(), status: 'active' });
    }, 5000);
    heartbeat.unref?.();
    const log = (message: string) => {
        const line = `${new Date().toISOString()} ${message}`;
        logs.push(line);
        saveStatus(args, 'applying', logs);
    };
    try {
        ensureLocalConfigPatch({
            projectRoot: args.projectRoot,
            port: args.port,
            ...(args.codexExecutablePath ? { codexExecutablePath: args.codexExecutablePath } : {}),
        });
        if (!args.restartOnly) {
            log('checking local source cleanliness');
            const dirty = dirtySourcePaths(args.projectRoot);
            if (dirty.length > 0) throw new Error(`dirty source files block update: ${dirty.join(', ')}`);

            const beforeDeps = dependencyHash(args.projectRoot);
            log('git pull --ff-only');
            runCommand('git', ['pull', '--ff-only'], args.projectRoot, 120_000);
            const afterDeps = dependencyHash(args.projectRoot);
            if (beforeDeps !== afterDeps) {
                log('package files changed; running npm ci');
                runCommand('npm', ['ci'], args.projectRoot, 10 * 60_000);
            } else {
                log('package files unchanged; skipping npm ci');
            }
            log('running npm run compile');
            runCommand('npm', ['run', 'compile'], args.projectRoot, 10 * 60_000);
            const cache = copyPluginToCodexCache(args.projectRoot);
            log(cache.copied ? `plugin cache refreshed: ${cache.cachePath}` : `plugin cache not refreshed: ${cache.warning || 'not needed'}`);
        } else {
            log('restart-only update helper started');
        }

        const cliPath = path.join(args.projectRoot, 'out', 'workflow-app', 'cli.js');
        if (!fs.existsSync(cliPath)) throw new Error(`Workflow App CLI build is missing: ${cliPath}`);

        log(`stopping parent server pid ${args.parentPid}`);
        await stopParent(args.parentPid, args.host, args.port);

        log('starting replacement server');
        const child = spawn(process.execPath, [
            cliPath,
            `--host=${args.host}`,
            `--port=${args.port}`,
            ...(args.codexExecutablePath ? [`--codex=${args.codexExecutablePath}`] : []),
        ], {
            cwd: args.projectRoot,
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: {
                ...process.env,
                CODEX_WORKFLOW_PROJECT_ROOT: args.projectRoot,
                CODEX_WORKFLOW_PORT: String(args.port),
                ...(args.codexExecutablePath ? { CODEX_EXECUTABLE_PATH: args.codexExecutablePath } : {}),
            },
        });
        child.unref();
        const healthy = await waitForHealth(args.host, args.port, 20_000);
        if (!healthy) throw new Error('replacement server did not pass /api/health');
        log('replacement server is healthy');
        saveStatus(args, args.restartOnly ? 'completed' : 'restartRequired', logs, undefined, true);
    } catch (e: any) {
        const message = e?.message || String(e);
        logs.push(`${new Date().toISOString()} failed: ${message}`);
        saveStatus(args, 'failed', logs, message);
        process.exitCode = 1;
    } finally {
        clearInterval(heartbeat);
        releaseUpdateLock();
    }
}

function parseArgs(argv: string[]): UpdaterArgs {
    const get = (name: string) => {
        const prefix = `--${name}=`;
        return argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
    };
    const projectRoot = path.resolve(get('project-root') || process.env.CODEX_WORKFLOW_PROJECT_ROOT || path.resolve(__dirname, '..', '..'));
    return {
        projectRoot,
        host: get('host') || '127.0.0.1',
        port: Number(get('port') || process.env.CODEX_WORKFLOW_PORT || 48731),
        parentPid: Number(get('parent-pid') || 0),
        codexExecutablePath: get('codex') || process.env.CODEX_EXECUTABLE_PATH,
        restartOnly: argv.includes('--restart-only'),
    };
}

function saveStatus(args: UpdaterArgs, status: WorkflowUpdateStatus['status'], logs: string[], lastError?: string, restartRequired = false): void {
    const currentCommit = gitSafe(['rev-parse', 'HEAD'], args.projectRoot)?.trim();
    const currentBranch = gitSafe(['branch', '--show-current'], args.projectRoot)?.trim();
    saveUpdateState({
        status,
        updateAvailable: false,
        autoUpdateMode: 'autoWhenIdle',
        projectRoot: args.projectRoot,
        currentCommit,
        currentBranch,
        lastAppliedAt: status === 'completed' || status === 'restartRequired' ? new Date().toISOString() : undefined,
        lastError,
        blockers: [],
        warnings: restartRequired ? ['Codex Desktop restart may be required if the plugin manifest changed.'] : [],
        logs: logs.slice(-80),
        restartRequired,
        generatedAt: new Date().toISOString(),
    });
}

async function stopParent(parentPid: number, host: string, port: number): Promise<void> {
    if (parentPid > 0) {
        try { process.kill(parentPid, 'SIGTERM'); } catch { /* continue */ }
    }
    const closed = await waitForPortClosed(host, port, 10_000);
    if (closed) return;
    if (process.platform === 'win32' && parentPid > 0) {
        try { runCommand('taskkill', ['/PID', String(parentPid), '/T', '/F'], process.cwd(), 10_000); } catch { /* continue */ }
        await waitForPortClosed(host, port, 5000);
    }
}

function dependencyHash(projectRoot: string): string {
    return [
        fileHash(path.join(projectRoot, 'package.json')),
        fileHash(path.join(projectRoot, 'package-lock.json')),
    ].join(':');
}

function dirtySourcePaths(cwd: string): string[] {
    const raw = gitSafe(['status', '--porcelain', '-uall'], cwd) || '';
    return raw.split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(Boolean)
        .map(line => {
            const pathPart = line.length > 3 ? line.slice(3).trim() : line.trim();
            return (pathPart.includes(' -> ') ? pathPart.split(' -> ').pop() || pathPart : pathPart).replace(/^"|"$/g, '').replace(/\\/g, '/');
        })
        .filter(filePath => filePath && !filePath.startsWith('.ai-agent/') && !filePath.startsWith('out/') && !/\.log$/i.test(filePath))
        .sort();
}

function gitSafe(args: string[], cwd: string): string | null {
    try {
        return runCommand('git', args, cwd, 30_000).stdout || '';
    } catch {
        return null;
    }
}

void main();
