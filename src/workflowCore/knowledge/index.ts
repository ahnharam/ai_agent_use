export * from './types';
export * from './utils';
export * from './sourceRegistry';
export * from './indexer';
export * from './retriever';
export * from './qdrantAdapter';
export * from './vaultExport';
export * from './verifier';
export * from './ragAdapters';
export * from './recommendation';
export * from './absorb';

import * as fs from 'fs';
import * as path from 'path';
import {
    KnowledgeStatus,
} from './types';
import { detectKnowledgeSources } from './sourceRegistry';
import { readKnowledgeRagStatus } from './retriever';
import { readKnowledgeIntegrationStatus } from './absorb';
import { knowledgeVaultDir, readKnowledgeConfig } from './utils';

export function readKnowledgeStatus(cwd: string): KnowledgeStatus {
    const config = readKnowledgeConfig(cwd);
    const detection = detectKnowledgeSources(cwd, config);
    const vaultDir = knowledgeVaultDir(cwd, config);
    return {
        config,
        detection,
        index: readKnowledgeRagStatus(cwd, config),
        vault: {
            path: vaultDir,
            manifestExists: fs.existsSync(path.join(vaultDir, 'manifest.json')),
            llmsExists: fs.existsSync(path.join(vaultDir, 'llms.txt')),
            obsidianExists: fs.existsSync(path.join(vaultDir, 'obsidian')),
        },
        integration: readKnowledgeIntegrationStatus(cwd, config),
    };
}
