import * as path from 'path';
import { WorkflowAppServer, openWorkflowApp } from './server';

async function main(): Promise<void> {
    const args = new Set(process.argv.slice(2));
    const projectRoot = path.resolve(__dirname, '..', '..');
    const portArg = process.argv.find(a => a.startsWith('--port='));
    const hostArg = process.argv.find(a => a.startsWith('--host='));
    const codexArg = process.argv.find(a => a.startsWith('--codex='));
    const server = new WorkflowAppServer({
        projectRoot,
        host: hostArg ? hostArg.slice('--host='.length) : '127.0.0.1',
        port: portArg ? Number(portArg.slice('--port='.length)) : 48731,
        codexExecutablePath: codexArg ? codexArg.slice('--codex='.length) : process.env.CODEX_EXECUTABLE_PATH,
    });
    await server.listen();
    const url = server.url();
    console.log(`Codex Workflow App listening on ${url}`);
    if (args.has('--open')) openWorkflowApp(url);
    process.on('SIGINT', () => void server.close().then(() => process.exit(0)));
    process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
}

main().catch(err => {
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
});
