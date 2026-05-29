import * as http from 'http';
import * as https from 'https';
import {
    KnowledgeChunk,
    KnowledgeIndex,
    KnowledgeVectorIndexStatus,
    RagFilters,
    RagHit,
    WorkflowKnowledgeConfig,
} from './types';
import { readKnowledgeConfig, sha256, snippet } from './utils';

const QDRANT_DEFAULT_URL = 'http://127.0.0.1:6333';
const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';
const UPSERT_BATCH_SIZE = 16;

interface JsonResponse {
    statusCode: number;
    body: any;
    text: string;
}

export function qdrantCollectionName(cwd: string, config: WorkflowKnowledgeConfig = readKnowledgeConfig(cwd)): string {
    const prefix = (config.vectorDb.collectionPrefix || 'codex_workflow')
        .replace(/[^a-z0-9_-]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'codex_workflow';
    return `${prefix}_${sha256(cwd.toLowerCase()).slice(0, 12)}`;
}

export async function syncQdrantKnowledgeIndex(cwd: string, index: KnowledgeIndex, config: WorkflowKnowledgeConfig = readKnowledgeConfig(cwd)): Promise<KnowledgeVectorIndexStatus> {
    if (!shouldUseQdrant(config)) return {
        provider: config.vectorDb.provider,
        ok: false,
        message: 'Qdrant vector indexing is not configured.',
    };
    if (config.embedding.provider !== 'ollama') return {
        provider: 'qdrant',
        ok: false,
        url: qdrantUrl(config),
        collection: qdrantCollectionName(cwd, config),
        message: `Qdrant indexing currently supports Ollama embeddings; configured provider is ${config.embedding.provider}.`,
    };
    if (!index.chunks.length) return {
        provider: 'qdrant',
        ok: false,
        url: qdrantUrl(config),
        collection: qdrantCollectionName(cwd, config),
        pointCount: 0,
        message: 'No knowledge chunks were available to index.',
    };

    const vectorBatches = await embedTexts(config, index.chunks.map(chunk => chunk.contextualText));
    const vectorSize = vectorBatches[0]?.length || 0;
    if (!vectorSize) throw new Error('Ollama embedding response did not include vectors.');

    const baseUrl = qdrantUrl(config);
    const collection = qdrantCollectionName(cwd, config);
    await recreateCollection(baseUrl, collection, vectorSize);

    for (let offset = 0; offset < index.chunks.length; offset += UPSERT_BATCH_SIZE) {
        const chunks = index.chunks.slice(offset, offset + UPSERT_BATCH_SIZE);
        const vectors = vectorBatches.slice(offset, offset + UPSERT_BATCH_SIZE);
        await upsertPoints(baseUrl, collection, chunks, vectors);
    }

    const count = await countPoints(baseUrl, collection);
    return {
        provider: 'qdrant',
        ok: count >= index.chunks.length,
        url: baseUrl,
        collection,
        pointCount: count,
        message: `Qdrant collection ${collection} indexed ${count}/${index.chunks.length} knowledge chunks.`,
    };
}

export async function searchQdrantKnowledge(cwd: string, query: string, filters: RagFilters = {}, config: WorkflowKnowledgeConfig = readKnowledgeConfig(cwd)): Promise<{ hits: RagHit[]; warning?: string }> {
    if (!shouldUseQdrant(config)) return { hits: [], warning: 'Qdrant search is not configured.' };
    if (config.embedding.provider !== 'ollama') return { hits: [], warning: `Qdrant search currently supports Ollama embeddings; configured provider is ${config.embedding.provider}.` };

    const baseUrl = qdrantUrl(config);
    const collection = qdrantCollectionName(cwd, config);
    const exists = await collectionExists(baseUrl, collection);
    if (!exists) return { hits: [], warning: `Qdrant collection ${collection} is missing. Rebuild the RAG index first.` };

    const vector = (await embedTexts(config, [query]))[0];
    const limit = filters.limit || 8;
    const points = await searchPoints(baseUrl, collection, vector, Math.max(limit * 3, limit));
    const sourceTypes = new Set(filters.sourceTypes || []);
    const hits = points
        .map(pointToHit)
        .filter((hit: RagHit & { sourceType?: string }) => sourceTypes.size === 0 || sourceTypes.has(hit.sourceType as any))
        .slice(0, limit)
        .map(({ sourceType, ...hit }: RagHit & { sourceType?: string }) => hit);
    return { hits };
}

function shouldUseQdrant(config: WorkflowKnowledgeConfig): boolean {
    return config.mode !== 'off' && config.vectorDb.provider === 'qdrant';
}

function qdrantUrl(config: WorkflowKnowledgeConfig): string {
    return normalizeBaseUrl(config.vectorDb.url || process.env.QDRANT_URL || QDRANT_DEFAULT_URL);
}

function ollamaUrl(config: WorkflowKnowledgeConfig): string {
    return normalizeBaseUrl(config.embedding.baseUrl || process.env.OLLAMA_HOST || OLLAMA_DEFAULT_URL);
}

function normalizeBaseUrl(value: string): string {
    return String(value || '').trim().replace(/\/+$/, '');
}

async function recreateCollection(baseUrl: string, collection: string, vectorSize: number): Promise<void> {
    if (await collectionExists(baseUrl, collection)) {
        await requestJson('DELETE', `${baseUrl}/collections/${encodeURIComponent(collection)}`);
    }
    const response = await requestJson('PUT', `${baseUrl}/collections/${encodeURIComponent(collection)}`, {
        vectors: { size: vectorSize, distance: 'Cosine' },
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Qdrant collection create failed with HTTP ${response.statusCode}: ${response.text}`);
    }
}

async function collectionExists(baseUrl: string, collection: string): Promise<boolean> {
    const response = await requestJson('GET', `${baseUrl}/collections/${encodeURIComponent(collection)}`);
    return response.statusCode >= 200 && response.statusCode < 300;
}

async function countPoints(baseUrl: string, collection: string): Promise<number> {
    const response = await requestJson('POST', `${baseUrl}/collections/${encodeURIComponent(collection)}/points/count`, {
        exact: true,
    });
    return Number(response.body?.result?.count || 0);
}

async function upsertPoints(baseUrl: string, collection: string, chunks: KnowledgeChunk[], vectors: number[][]): Promise<void> {
    const points = chunks.map((chunk, index) => ({
        id: chunkPointId(chunk),
        vector: vectors[index],
        payload: {
            sourceId: chunk.sourceId,
            sourceType: qdrantSourceTypeForChunk(chunk),
            sourcePath: chunk.sourcePath,
            sourceHash: chunk.sourceHash,
            chunkId: chunk.chunkId,
            title: chunk.title,
            text: chunk.text,
            contextualText: chunk.contextualText,
            modifiedAt: chunk.modifiedAt,
            trustLevel: chunk.trustLevel,
            snippet: snippet(chunk.contextualText),
        },
    }));
    const response = await requestJson('PUT', `${baseUrl}/collections/${encodeURIComponent(collection)}/points?wait=true`, { points });
    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Qdrant upsert failed with HTTP ${response.statusCode}: ${response.text}`);
    }
}

function qdrantSourceTypeForChunk(chunk: KnowledgeChunk): string {
    if (chunk.sourceId.startsWith('capability:') || /(^|\/)(skills|\.codex\/agents)\//i.test(chunk.sourcePath)) return 'project-capability';
    if (chunk.sourceId === 'root-llms-txt' || chunk.sourcePath === 'llms.txt' || chunk.sourcePath === 'llms-full.txt') return 'llms-txt';
    return 'repo-docs';
}

async function searchPoints(baseUrl: string, collection: string, vector: number[], limit: number): Promise<any[]> {
    const searchBody = { vector, limit, with_payload: true };
    const search = await requestJson('POST', `${baseUrl}/collections/${encodeURIComponent(collection)}/points/search`, searchBody);
    if (search.statusCode >= 200 && search.statusCode < 300) {
        return Array.isArray(search.body?.result) ? search.body.result : [];
    }
    const query = await requestJson('POST', `${baseUrl}/collections/${encodeURIComponent(collection)}/points/query`, {
        query: vector,
        limit,
        with_payload: true,
    });
    if (query.statusCode >= 200 && query.statusCode < 300) {
        if (Array.isArray(query.body?.result?.points)) return query.body.result.points;
        if (Array.isArray(query.body?.result)) return query.body.result;
    }
    throw new Error(`Qdrant search failed with HTTP ${search.statusCode}/${query.statusCode}: ${search.text || query.text}`);
}

function pointToHit(point: any): RagHit & { sourceType?: string } {
    const payload = point?.payload || {};
    return {
        sourceId: String(payload.sourceId || 'qdrant'),
        sourceType: String(payload.sourceType || ''),
        sourcePath: String(payload.sourcePath || ''),
        chunkId: String(payload.chunkId || point?.id || ''),
        score: Number(Number(point?.score || 0).toFixed(4)),
        retrievedBy: 'qdrant',
        sourceHash: String(payload.sourceHash || ''),
        modifiedAt: String(payload.modifiedAt || ''),
        trustLevel: payload.trustLevel || 'unknown',
        snippet: String(payload.snippet || snippet(payload.contextualText || payload.text || '')),
    };
}

function chunkPointId(chunk: KnowledgeChunk): string {
    const hash = sha256(`${chunk.sourceHash}:${chunk.chunkId}`);
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function embedTexts(config: WorkflowKnowledgeConfig, texts: string[]): Promise<number[][]> {
    const baseUrl = ollamaUrl(config);
    const response = await requestJson('POST', `${baseUrl}/api/embed`, {
        model: config.embedding.model,
        input: texts,
    }, 120000);
    if (response.statusCode >= 200 && response.statusCode < 300 && Array.isArray(response.body?.embeddings)) {
        return response.body.embeddings;
    }
    if (response.statusCode !== 404) {
        throw new Error(`Ollama embed failed with HTTP ${response.statusCode}: ${response.text}`);
    }
    const vectors: number[][] = [];
    for (const text of texts) {
        const legacy = await requestJson('POST', `${baseUrl}/api/embeddings`, {
            model: config.embedding.model,
            prompt: text,
        }, 120000);
        if (legacy.statusCode < 200 || legacy.statusCode >= 300 || !Array.isArray(legacy.body?.embedding)) {
            throw new Error(`Ollama legacy embedding failed with HTTP ${legacy.statusCode}: ${legacy.text}`);
        }
        vectors.push(legacy.body.embedding);
    }
    return vectors;
}

function requestJson(method: string, urlString: string, body?: unknown, timeoutMs = 30000): Promise<JsonResponse> {
    return new Promise(resolve => {
        const url = new URL(urlString);
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request({
            method,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            timeout: timeoutMs,
            headers: payload ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
            } : undefined,
        }, res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf-8');
                let parsed: any = null;
                try {
                    parsed = text ? JSON.parse(text) : null;
                } catch {
                    parsed = null;
                }
                resolve({ statusCode: res.statusCode || 0, body: parsed, text });
            });
        });
        req.on('timeout', () => {
            req.destroy(new Error(`request timed out after ${timeoutMs}ms`));
        });
        req.on('error', error => {
            resolve({ statusCode: 0, body: null, text: error.message });
        });
        if (payload) req.write(payload);
        req.end();
    });
}
