import * as fs from 'fs';
import * as path from 'path';
import {
    KnowledgeChunk,
    KnowledgeIndex,
    WorkflowKnowledgeConfig,
} from './types';
import { scanKnowledgeDocuments } from './sourceRegistry';
import { syncQdrantKnowledgeIndex } from './qdrantAdapter';
import { compiledCapabilityChunks } from './absorb';
import {
    ensureDir,
    localIndexPath,
    readJsonFile,
    readKnowledgeConfig,
    readTextFile,
    sha256,
    snippet,
    tokenize,
    writeJsonFile,
} from './utils';

const CHUNK_CHARS = 2600;
const CHUNK_OVERLAP = 250;

export function rebuildLocalKnowledgeIndex(cwd: string, config = readKnowledgeConfig(cwd)): KnowledgeIndex {
    const index = createLocalKnowledgeIndex(cwd, config);
    writeJsonFile(localIndexPath(cwd, config), index);
    return index;
}

export async function rebuildKnowledgeIndex(cwd: string, config = readKnowledgeConfig(cwd)): Promise<KnowledgeIndex> {
    const index = rebuildLocalKnowledgeIndex(cwd, config);
    if (config.vectorDb.provider === 'qdrant') {
        try {
            index.vectorDb = await syncQdrantKnowledgeIndex(cwd, index, config);
        } catch (e: any) {
            index.vectorDb = {
                provider: 'qdrant',
                ok: false,
                url: config.vectorDb.url,
                message: `Qdrant indexing failed: ${e?.message || e}`,
            };
        }
    }
    return index;
}

export function readLocalKnowledgeIndex(cwd: string, config = readKnowledgeConfig(cwd)): KnowledgeIndex | null {
    return readJsonFile<KnowledgeIndex>(localIndexPath(cwd, config));
}

export function createLocalKnowledgeIndex(cwd: string, config: WorkflowKnowledgeConfig): KnowledgeIndex {
    const docs = scanKnowledgeDocuments(cwd, config);
    const chunks: KnowledgeChunk[] = [];
    for (const doc of docs) {
        let text = '';
        try {
            text = normalizeDocumentText(doc.absolutePath, readTextFile(doc.absolutePath));
        } catch {
            continue;
        }
        const parts = chunkText(text, CHUNK_CHARS, CHUNK_OVERLAP);
        parts.forEach((part, index) => {
            const chunkId = `${doc.hash.slice(0, 12)}-${index + 1}`;
            const contextualText = [
                `Source: ${doc.path}`,
                `Title: ${doc.title}`,
                `Modified: ${doc.modifiedAt}`,
                '',
                part,
            ].join('\n');
            chunks.push({
                sourceId: doc.sourceId,
                sourcePath: doc.path,
                sourceHash: doc.hash,
                chunkId,
                title: doc.title,
                text: part,
                contextualText,
                modifiedAt: doc.modifiedAt,
                trustLevel: doc.trustLevel,
                tokens: tokenize(`${doc.path} ${doc.title} ${part}`),
            });
        });
    }
    const capabilityChunks = compiledCapabilityChunks(cwd, config);
    chunks.push(...capabilityChunks);
    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        configHash: sha256(JSON.stringify({
            include: config.include,
            exclude: config.exclude,
            mode: config.mode,
            preferred: config.preferred,
            fallback: config.fallback,
            integration: config.integration,
        })).slice(0, 20),
        sourceCount: docs.length,
        chunkCount: chunks.length,
        chunks,
    };
}

export function ensureLocalKnowledgeIndex(cwd: string, config = readKnowledgeConfig(cwd)): KnowledgeIndex {
    const existing = readLocalKnowledgeIndex(cwd, config);
    if (existing?.chunks?.length) return existing;
    ensureDir(path.dirname(localIndexPath(cwd, config)));
    return rebuildLocalKnowledgeIndex(cwd, config);
}

function chunkText(text: string, size: number, overlap: number): string[] {
    const clean = text.replace(/\r\n/g, '\n').trim();
    if (!clean) return [];
    const chunks: string[] = [];
    for (let start = 0; start < clean.length; start += Math.max(1, size - overlap)) {
        chunks.push(clean.slice(start, start + size));
        if (start + size >= clean.length) break;
    }
    return chunks;
}

function normalizeDocumentText(file: string, text: string): string {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html' || ext === '.htm') {
        return text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();
    }
    if (ext === '.json') {
        try {
            return JSON.stringify(JSON.parse(text), null, 2);
        } catch {
            return text;
        }
    }
    return text;
}
