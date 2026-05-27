import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { WorkflowAppServer } from './server';

let server: WorkflowAppServer | null = null;
let win: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
    const projectRoot = path.resolve(__dirname, '..', '..');
    server = new WorkflowAppServer({
        projectRoot,
        host: '127.0.0.1',
        port: Number(process.env.CODEX_WORKFLOW_PORT || 48731),
        codexExecutablePath: process.env.CODEX_EXECUTABLE_PATH,
    });
    await server.listen();
    win = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 980,
        minHeight: 640,
        title: 'Codex Workflow App',
        webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    await win.loadURL(server.url());
}

app.whenReady().then(() => void createWindow());
app.on('window-all-closed', () => {
    void server?.close().finally(() => {
        if (process.platform !== 'darwin') app.quit();
    });
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
