import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    WorkflowKnowledgeConfig,
} from './types';

export const DEFAULT_KNOWLEDGE_INCLUDE = [
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    'llms.txt',
    'llms-full.txt',
    'package.json',
    'tsconfig.json',
    'system_schema.json',
    '.codex/**/*.md',
    '.codex/agents/*.toml',
    'docs/**/*.md',
    'docs/**/*.mdx',
    'docs/**/*.txt',
    'docs/**/*.html',
    'docs/**/*.htm',
    'docs/**/*.json',
];

export const DEFAULT_KNOWLEDGE_EXCLUDE = [
    '.git/**',
    'node_modules/**',
    'dist/**',
    'build/**',
    'out/**',
    'coverage/**',
    '.ai-agent/runs/**',
    '.ai-agent/doc-cache/**',
    '.ai-agent/knowledge-vault/**',
    '.env',
    '.env.*',
    '**/*.pem',
    '**/*.key',
    '**/*token*',
    '**/*credential*',
    '.obsidian/workspace*.json',
    '_agents/*/tools/*.json',
    '**/oauth*.json',
];

export const SUPPORTED_KNOWLEDGE_EXTENSIONS = new Set([
    '.md',
    '.mdx',
    '.txt',
    '.html',
    '.htm',
    '.json',
    '.toml',
    '.yml',
    '.yaml',
]);

export function knowledgeConfigPath(cwd: string): string {
    return path.join(cwd, '.codex', 'workflow-knowledge.json');
}

export function knowledgeVaultDir(cwd: string, config = readKnowledgeConfig(cwd)): string {
    return path.resolve(cwd, config.generatedVaultDir || '.ai-agent/knowledge-vault');
}

export function localIndexPath(cwd: string, config = readKnowledgeConfig(cwd)): string {
    return path.join(knowledgeVaultDir(cwd, config), 'rag-index.json');
}

export function defaultKnowledgeConfig(): WorkflowKnowledgeConfig {
    return {
        version: 1,
        mode: 'auto',
        preferred: 'existing-first',
        fallback: 'local-hybrid',
        citationRequired: true,
        writeGeneratedVault: true,
        generatedVaultDir: '.ai-agent/knowledge-vault',
        include: [...DEFAULT_KNOWLEDGE_INCLUDE],
        exclude: [...DEFAULT_KNOWLEDGE_EXCLUDE],
        sources: [],
        embedding: {
            provider: 'none',
            model: 'none',
            externalData: false,
        },
        vectorDb: {
            provider: 'local-hybrid',
            mode: 'local',
            collectionPrefix: 'codex_workflow',
        },
        recommendation: {},
        integration: {
            strategy: 'absorb-copy-own-index',
            sourceOwnership: 'project',
            derivedOwnership: 'workflow',
            existingRagRole: 'baseline-and-fallback',
            activationMode: 'eval-gated',
            activatedSurfaces: [],
        },
    };
}

export function readKnowledgeConfig(cwd: string): WorkflowKnowledgeConfig {
    const file = knowledgeConfigPath(cwd);
    if (!fs.existsSync(file)) return defaultKnowledgeConfig();
    try {
        return normalizeKnowledgeConfig(JSON.parse(readTextFile(file)));
    } catch {
        return defaultKnowledgeConfig();
    }
}

export function normalizeKnowledgeConfig(value: any): WorkflowKnowledgeConfig {
    const defaults = defaultKnowledgeConfig();
    return {
        version: 1,
        mode: ['auto', 'observe', 'bridge', 'mirror', 'own', 'off'].includes(value?.mode) ? value.mode : defaults.mode,
        preferred: value?.preferred === 'local-first' ? 'local-first' : 'existing-first',
        fallback: value?.fallback === 'off' ? 'off' : 'local-hybrid',
        citationRequired: typeof value?.citationRequired === 'boolean' ? value.citationRequired : defaults.citationRequired,
        writeGeneratedVault: typeof value?.writeGeneratedVault === 'boolean' ? value.writeGeneratedVault : defaults.writeGeneratedVault,
        generatedVaultDir: typeof value?.generatedVaultDir === 'string' && value.generatedVaultDir.trim() ? value.generatedVaultDir.trim() : defaults.generatedVaultDir,
        include: arrayOr(value?.include, defaults.include),
        exclude: arrayOr(value?.exclude, defaults.exclude),
        sources: Array.isArray(value?.sources) ? value.sources.map((source: any, index: number) => ({
            id: String(source?.id || `configured-${index + 1}`),
            type: source?.type || 'repo-docs',
            enabled: source?.enabled !== false,
            trustLevel: source?.trustLevel || 'unknown',
            owner: typeof source?.owner === 'string' ? source.owner : undefined,
            path: typeof source?.path === 'string' ? source.path : undefined,
            url: typeof source?.url === 'string' ? source.url : undefined,
            include: arrayOr(source?.include, []),
            exclude: arrayOr(source?.exclude, []),
            status: source?.status,
            detectedBy: source?.detectedBy,
            metadata: source?.metadata && typeof source.metadata === 'object' ? source.metadata : undefined,
        })) : [],
        embedding: normalizeEmbeddingConfig(value?.embedding, defaults.embedding),
        vectorDb: normalizeVectorDbConfig(value?.vectorDb, defaults.vectorDb),
        recommendation: value?.recommendation && typeof value.recommendation === 'object' ? {
            appliedProfileId: typeof value.recommendation.appliedProfileId === 'string' ? value.recommendation.appliedProfileId : undefined,
            appliedAt: typeof value.recommendation.appliedAt === 'string' ? value.recommendation.appliedAt : undefined,
            lastRecommendedAt: typeof value.recommendation.lastRecommendedAt === 'string' ? value.recommendation.lastRecommendedAt : undefined,
        } : defaults.recommendation,
        integration: normalizeIntegrationConfig(value?.integration, defaults.integration!),
    };
}

export function saveKnowledgeConfig(cwd: string, config: WorkflowKnowledgeConfig): WorkflowKnowledgeConfig {
    const normalized = normalizeKnowledgeConfig(config);
    writeJsonFile(knowledgeConfigPath(cwd), normalized);
    return normalized;
}

export function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

export function writeJsonFile(file: string, value: unknown): void {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

export function readJsonFile<T>(file: string): T | null {
    try {
        if (!fs.existsSync(file)) return null;
        return JSON.parse(readTextFile(file)) as T;
    } catch {
        return null;
    }
}

export function readTextFile(file: string): string {
    return fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
}

export function writeTextFile(file: string, value: string): void {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, value, 'utf-8');
}

export function hashFile(file: string): string {
    return sha256(fs.readFileSync(file));
}

export function sha256(value: string | Buffer): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeRel(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function relativePath(root: string, file: string): string {
    return normalizeRel(path.relative(root, file));
}

export function safeName(value: string): string {
    const cleaned = normalizeRel(value)
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
    return cleaned || 'document';
}

export function expandTilde(value: string): string {
    if (value === '~') return os.homedir();
    if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
    return value;
}

export function matchesAny(relPath: string, patterns: string[]): boolean {
    const normalized = normalizeRel(relPath);
    return patterns.some(pattern => globToRegExp(pattern).test(normalized));
}

export function walkFiles(root: string, excludes: string[], onFile: (rel: string, abs: string) => void): void {
    walk(root, '', excludes, onFile);
}

function walk(root: string, relDir: string, excludes: string[], onFile: (rel: string, abs: string) => void): void {
    const absDir = path.join(root, relDir);
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const rel = normalizeRel(path.join(relDir, entry.name));
        if (entry.isDirectory()) {
            if (matchesAny(`${rel}/`, excludes) || matchesAny(`${rel}/**`, excludes)) continue;
            walk(root, rel, excludes, onFile);
        } else if (entry.isFile()) {
            onFile(rel, path.join(root, rel));
        }
    }
}

export function tokenize(value: string): string[] {
    return Array.from(new Set((value || '')
        .toLowerCase()
        .replace(/[^a-z0-9가-힣_./:-]+/gi, ' ')
        .split(/\s+/)
        .map(token => token.trim())
        .filter(token => token.length >= 2)
        .slice(0, 1000)));
}

export function snippet(value: string, max = 700): string {
    const clean = (value || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

export function titleFromPath(rel: string): string {
    return path.basename(rel).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}

export function arrayOr(value: any, fallback: string[]): string[] {
    if (!Array.isArray(value)) return [...fallback];
    return value.map(item => String(item || '').trim()).filter(Boolean);
}

function normalizeEmbeddingConfig(value: any, fallback: WorkflowKnowledgeConfig['embedding']): WorkflowKnowledgeConfig['embedding'] {
    const provider = ['none', 'existing', 'ollama', 'openai-compatible', 'openai', 'voyage'].includes(value?.provider)
        ? value.provider
        : fallback.provider;
    const dimensions = Number(value?.dimensions);
    return {
        provider,
        model: typeof value?.model === 'string' && value.model.trim() ? value.model.trim() : fallback.model,
        baseUrl: typeof value?.baseUrl === 'string' && value.baseUrl.trim() ? value.baseUrl.trim() : undefined,
        dimensions: Number.isFinite(dimensions) && dimensions > 0 ? dimensions : undefined,
        externalData: typeof value?.externalData === 'boolean' ? value.externalData : fallback.externalData,
    };
}

function normalizeVectorDbConfig(value: any, fallback: WorkflowKnowledgeConfig['vectorDb']): WorkflowKnowledgeConfig['vectorDb'] {
    const provider = ['local-hybrid', 'existing', 'qdrant', 'chroma', 'custom'].includes(value?.provider)
        ? value.provider
        : fallback.provider;
    const mode = ['existing', 'managed', 'external', 'local'].includes(value?.mode) ? value.mode : fallback.mode;
    return {
        provider,
        url: typeof value?.url === 'string' && value.url.trim() ? value.url.trim() : fallback.url,
        collectionPrefix: typeof value?.collectionPrefix === 'string' && value.collectionPrefix.trim() ? value.collectionPrefix.trim() : fallback.collectionPrefix,
        mode,
    };
}

function normalizeIntegrationConfig(value: any, fallback: NonNullable<WorkflowKnowledgeConfig['integration']>): NonNullable<WorkflowKnowledgeConfig['integration']> {
    const strategy = ['existing-first', 'absorb-copy-own-index'].includes(value?.strategy) ? value.strategy : fallback.strategy;
    const sourceOwnership = ['project', 'workflow', 'external'].includes(value?.sourceOwnership) ? value.sourceOwnership : fallback.sourceOwnership;
    const derivedOwnership = ['workflow', 'project', 'external'].includes(value?.derivedOwnership) ? value.derivedOwnership : fallback.derivedOwnership;
    const existingRagRole = ['baseline-and-fallback', 'fallback-only', 'baseline-only', 'off'].includes(value?.existingRagRole)
        ? value.existingRagRole
        : fallback.existingRagRole;
    const activationMode = ['eval-gated', 'manual', 'off'].includes(value?.activationMode) ? value.activationMode : fallback.activationMode;
    return {
        strategy,
        sourceOwnership,
        derivedOwnership,
        existingRagRole,
        activationMode,
        activatedSurfaces: arrayOr(value?.activatedSurfaces, fallback.activatedSurfaces || []),
        lastActivatedAt: typeof value?.lastActivatedAt === 'string' ? value.lastActivatedAt : undefined,
        lastEvaluatedAt: typeof value?.lastEvaluatedAt === 'string' ? value.lastEvaluatedAt : undefined,
    };
}

function globToRegExp(pattern: string): RegExp {
    const normalized = normalizeRel(pattern).replace(/^\.\/+/, '');
    let source = '';
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized[i];
        const next = normalized[i + 1];
        const afterNext = normalized[i + 2];
        if (char === '*' && next === '*' && afterNext === '/') {
            source += '(?:.*/)?';
            i += 2;
        } else if (char === '*' && next === '*') {
            source += '.*';
            i += 1;
        } else if (char === '*') {
            source += '[^/]*';
        } else {
            source += escapeRegExp(char);
        }
    }
    return new RegExp(`^${source}$`, 'i');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
