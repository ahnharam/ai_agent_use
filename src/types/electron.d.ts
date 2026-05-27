declare module 'electron' {
    export const app: {
        whenReady(): Promise<void>;
        on(event: string, listener: (...args: any[]) => void): void;
        quit(): void;
    };
    export class BrowserWindow {
        constructor(options?: any);
        loadURL(url: string): Promise<void>;
        static getAllWindows(): BrowserWindow[];
    }
}
