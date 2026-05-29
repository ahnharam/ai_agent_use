import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    KnowledgeDetectionResult,
    KnowledgeDocument,
    KnowledgeSource,
    WorkflowKnowledgeConfig,
} from './types';
import {
    expandTilde,
    hashFile,
    knowledgeConfigPath,
    knowledgeVaultDir,
    matchesAny,
    normalizeRel,
    readKnowledgeConfig,
    readJsonFile,
    readTextFile,
    relativePath,
    SUPPORTED_KNOWLEDGE_EXTENSIONS,
    titleFromPath,
    walkFiles,
} from './utils';

const RAG_DEPENDENCIES = [
    'langchain',
    '@langchain/core',
    'llamaindex',
    'haystack',
    'semantic-kernel',
    'chromadb',
    'qdrant-client',
    '@qdrant/js-client-rest',
    'faiss-node',
    'weaviate-client',
    '@pinecone-database/pinecone',
    'milvus-sdk-node',
];

const RAG_DIRS = ['rag', 'retrieval', 'retriever', 'embeddings', 'vectorstore', 'vectorstores', 'knowledge'];
const RAG_ENV_KEYS = ['QDRANT_URL', 'CHROMA_PATH', 'PINECONE_API_KEY', 'WEAVIATE_URL', 'MILVUS_ADDRESS', 'VECTOR_DB'];
const RAG_MARKER_FILES = [
    'scripts/docs_orchestrator_cli.py',
    'scripts/docs_orchestrator/cli.py',
    'scripts/docs_orchestrator/retrieval.py',
    'scripts/docs_orchestrator/qdrant_index.py',
    'scripts/docs_orchestrator/vector_profiles.py',
    'scripts/docs_orchestrator/embeddings.py',
];

export function detectKnowledgeSources(cwd: string, config = readKnowledgeConfig(cwd)): KnowledgeDetectionResult {
    const sources = new Map<string, KnowledgeSource>();
    const warnings: string[] = [];

    addSource(sources, {
        id: 'repo-docs',
        type: 'repo-docs',
        enabled: true,
        trustLevel: 'high',
        owner: 'repository',
        path: cwd,
        include: config.include,
        exclude: config.exclude,
        status: 'available',
        detectedBy: 'default',
    });

    const rootLlms = path.join(cwd, 'llms.txt');
    if (fs.existsSync(rootLlms)) {
        addSource(sources, {
            id: 'root-llms-txt',
            type: 'llms-txt',
            enabled: true,
            trustLevel: 'high',
            owner: 'repository',
            path: rootLlms,
            status: 'available',
            detectedBy: 'file',
        });
    }

    const generatedVault = knowledgeVaultDir(cwd, config);
    if (fs.existsSync(path.join(generatedVault, 'manifest.json')) || fs.existsSync(path.join(generatedVault, 'llms.txt'))) {
        addSource(sources, {
            id: 'generated-knowledge-vault',
            type: 'generated-vault',
            enabled: true,
            trustLevel: 'medium',
            owner: 'workflow',
            path: generatedVault,
            status: 'available',
            detectedBy: 'generated-vault',
        });
    }
    const importedRoot = path.join(generatedVault, 'imported');
    if (fs.existsSync(importedRoot)) {
        addSource(sources, {
            id: 'workflow-imported-project-capabilities',
            type: 'project-capability',
            enabled: true,
            trustLevel: 'high',
            owner: 'workflow',
            path: importedRoot,
            status: 'available',
            detectedBy: 'absorb-copy-own-index',
        });
    }

    for (const obsidianPath of detectObsidianVaults(cwd, generatedVault)) {
        addSource(sources, {
            id: `obsidian-${hashId(obsidianPath)}`,
            type: 'obsidian-vault',
            enabled: true,
            trustLevel: obsidianPath.startsWith(generatedVault) ? 'medium' : 'high',
            owner: 'obsidian',
            path: obsidianPath,
            status: 'available',
            detectedBy: '.obsidian',
        });
    }

    const brainPath = process.env.HARAM_AI_BRAIN_PATH || path.join(os.homedir(), '.haram-ai-brain');
    if (fs.existsSync(expandTilde(brainPath))) {
        addSource(sources, {
            id: 'second-brain',
            type: 'second-brain',
            enabled: true,
            trustLevel: 'medium',
            owner: 'user',
            path: expandTilde(brainPath),
            status: 'available',
            detectedBy: 'default-brain-path',
            metadata: { indexedByDefault: false },
        });
    }

    for (const source of config.sources || []) {
        addSource(sources, { ...source, detectedBy: source.detectedBy || 'configured' });
    }

    for (const source of detectExistingRag(cwd)) {
        addSource(sources, source);
    }

    const ordered = Array.from(sources.values());
    const existingRag = ordered.filter(source => source.type === 'existing-rag');
    if (existingRag.length === 0 && config.preferred === 'existing-first') {
        warnings.push('No existing RAG system was detected; local-hybrid fallback will be used.');
    }

    return {
        configPath: knowledgeConfigPath(cwd),
        vaultDir: generatedVault,
        sources: ordered,
        existingRag,
        warnings,
    };
}

export function scanKnowledgeDocuments(cwd: string, config = readKnowledgeConfig(cwd)): KnowledgeDocument[] {
    const detection = detectKnowledgeSources(cwd, config);
    const repoSource = detection.sources.find(source => source.id === 'repo-docs');
    const include = repoSource?.include?.length ? repoSource.include : config.include;
    const exclude = Array.from(new Set([...(repoSource?.exclude || []), ...config.exclude]));
    const docs: KnowledgeDocument[] = [];

    walkFiles(cwd, exclude, (rel, abs) => {
        const normalized = normalizeRel(rel);
        const ext = path.extname(normalized).toLowerCase();
        if (!SUPPORTED_KNOWLEDGE_EXTENSIONS.has(ext)) return;
        if (!matchesAny(normalized, include)) return;
        if (matchesAny(normalized, exclude)) return;
        let stat: fs.Stats;
        try {
            stat = fs.statSync(abs);
        } catch {
            return;
        }
        docs.push({
            sourceId: sourceIdForPath(normalized),
            sourceType: normalized === 'llms.txt' || normalized === 'llms-full.txt' ? 'llms-txt' : 'repo-docs',
            path: normalized,
            absolutePath: abs,
            title: titleFromPath(normalized),
            extension: ext,
            size: stat.size,
            hash: hashFile(abs),
            modifiedAt: stat.mtime.toISOString(),
            trustLevel: normalized.startsWith('docs/') || normalized === 'README.md' ? 'high' : 'medium',
        });
    });

    return docs.sort((a, b) => a.path.localeCompare(b.path));
}

function detectExistingRag(cwd: string): KnowledgeSource[] {
    const sources: KnowledgeSource[] = [];
    const pkg = readJsonFile<any>(path.join(cwd, 'package.json'));
    const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
    const matchedDeps = Object.keys(deps).filter(dep => RAG_DEPENDENCIES.includes(dep));
    if (matchedDeps.length > 0) {
        sources.push({
            id: 'existing-rag-package-deps',
            type: 'existing-rag',
            enabled: true,
            trustLevel: 'medium',
            owner: 'repository',
            path: path.join(cwd, 'package.json'),
            status: 'available',
            detectedBy: 'package.json',
            metadata: { dependencies: matchedDeps },
        });
    }

    for (const dir of RAG_DIRS) {
        const abs = path.join(cwd, dir);
        if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
            sources.push({
                id: `existing-rag-dir-${dir}`,
                type: 'existing-rag',
                enabled: true,
                trustLevel: 'medium',
                owner: 'repository',
                path: abs,
                status: 'available',
                detectedBy: 'directory',
                metadata: { directory: dir },
            });
        }
    }

    const markerFiles = RAG_MARKER_FILES.filter(rel => fs.existsSync(path.join(cwd, rel)));
    if (markerFiles.length > 0) {
        sources.push({
            id: 'existing-rag-docs-orchestrator',
            type: 'existing-rag',
            enabled: true,
            trustLevel: 'high',
            owner: 'repository',
            path: path.join(cwd, markerFiles[0]),
            status: 'available',
            detectedBy: 'docs-orchestrator',
            metadata: { files: markerFiles },
        });
    }

    const dockerCompose = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
        .map(file => path.join(cwd, file))
        .find(file => fs.existsSync(file));
    if (dockerCompose) {
        const text = safeRead(dockerCompose);
        const services = ['qdrant', 'chroma', 'weaviate', 'milvus'].filter(name => new RegExp(`\\b${name}\\b`, 'i').test(text));
        if (services.length > 0) {
            sources.push({
                id: 'existing-rag-compose',
                type: 'existing-rag',
                enabled: true,
                trustLevel: 'medium',
                owner: 'repository',
                path: dockerCompose,
                status: 'available',
                detectedBy: 'compose',
                metadata: { services },
            });
        }
    }

    const envFiles = ['.env', '.env.local', '.env.development']
        .map(file => path.join(cwd, file))
        .filter(file => fs.existsSync(file));
    const envKeys = new Set<string>();
    for (const envFile of envFiles) {
        for (const line of safeRead(envFile).split(/\r?\n/)) {
            const key = line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1];
            if (key && RAG_ENV_KEYS.includes(key)) envKeys.add(key);
        }
    }
    if (envKeys.size > 0) {
        sources.push({
            id: 'existing-rag-env',
            type: 'existing-rag',
            enabled: true,
            trustLevel: 'low',
            owner: 'repository',
            path: cwd,
            status: 'available',
            detectedBy: '.env-keys',
            metadata: { keys: Array.from(envKeys) },
        });
    }

    return sources;
}

function detectObsidianVaults(cwd: string, generatedVault: string): string[] {
    const candidates = [cwd, path.join(cwd, 'docs'), generatedVault, path.join(generatedVault, 'obsidian')];
    return Array.from(new Set(candidates.filter(candidate => fs.existsSync(path.join(candidate, '.obsidian')) || fs.existsSync(path.join(candidate, 'Index.md')) && candidate.includes('obsidian'))));
}

function sourceIdForPath(rel: string): string {
    if (rel === 'llms.txt' || rel === 'llms-full.txt') return 'root-llms-txt';
    return 'repo-docs';
}

function addSource(sources: Map<string, KnowledgeSource>, source: KnowledgeSource): void {
    const existing = sources.get(source.id);
    sources.set(source.id, { ...existing, ...source });
}

function hashId(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    return Math.abs(hash).toString(36);
}

function safeRead(file: string): string {
    try {
        return readTextFile(file).slice(0, 200000);
    } catch {
        return '';
    }
}
