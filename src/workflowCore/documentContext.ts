import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CODEX_WORKFLOW_ROLES, CodexWorkflowRole } from './store';
import {
    buildAgentKnowledgeContext,
    exportKnowledgeVault,
    formatAgentKnowledgeContext,
    readKnowledgeConfig,
    readKnowledgeStatus,
    rebuildLocalKnowledgeIndex,
    KnowledgeStatus,
} from './knowledge';

export interface DocumentRule {
    include: string[];
    exclude: string[];
}

export interface AgentDocumentConfig {
    include: string[];
    exclude: string[];
    summaryMode?: 'summary' | 'off';
}

export interface ProjectDocumentProfile {
    version: 1;
    global: DocumentRule;
    agents: Partial<Record<CodexWorkflowRole, AgentDocumentConfig>>;
    updatedAt?: string;
}

export interface ScannedDocument {
    path: string;
    absolutePath: string;
    extension: string;
    size: number;
    hash: string;
    cacheStatus: 'fresh' | 'missing' | 'stale';
    relevantAgents: string[];
}

export interface DocumentSummaryCache {
    path: string;
    hash: string;
    summaryKo: string;
    rules: string[];
    commands: string[];
    warnings: string[];
    relevantAgents: string[];
    updatedAt: string;
}

export interface AgentDocumentBundleCache {
    role: string;
    profileHash: string;
    sourceDocs: string[];
    summaryKo: string;
    mustFollow: string[];
    warnings: string[];
    updatedAt: string;
}

export interface DocumentCacheState {
    profile: ProjectDocumentProfile;
    scanned: ScannedDocument[];
    summaries: DocumentSummaryCache[];
    bundles: AgentDocumentBundleCache[];
    knowledge?: KnowledgeStatus;
}

export type CodexTextRunner = (prompt: string, purpose: string) => Promise<string>;

const SUPPORTED_EXTENSIONS = new Set(['.md', '.mdx', '.html', '.htm', '.txt']);
const DEFAULT_INCLUDE = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/**/*.md', 'docs/**/*.mdx', 'docs/**/*.html', 'docs/**/*.htm', 'docs/**/*.txt'];
const DEFAULT_EXCLUDE = ['.git/**', 'node_modules/**', 'dist/**', 'build/**', 'out/**', '.ai-agent/runs/**', '.ai-agent/doc-cache/**'];
const MAX_DIRECT_CHARS = 28000;
const CHUNK_CHARS = 18000;
const MAX_CHUNKS = 8;

export function documentProfilePath(cwd: string): string {
    return path.join(cwd, '.codex', 'workflow-docs.json');
}

export function documentCacheDir(cwd: string): string {
    return path.join(cwd, '.ai-agent', 'doc-cache');
}

export function defaultDocumentProfile(): ProjectDocumentProfile {
    return {
        version: 1,
        global: {
            include: [...DEFAULT_INCLUDE],
            exclude: [...DEFAULT_EXCLUDE],
        },
        agents: {
            'docs-agent': { include: [...DEFAULT_INCLUDE], exclude: [], summaryMode: 'summary' },
            'frontend-coder': { include: ['docs/ui/**/*.md', 'docs/design/**/*.md', 'docs/**/*.html', '**/*frontend*.md', '**/*ui*.md'], exclude: [], summaryMode: 'summary' },
            'backend-coder': { include: ['docs/api/**/*.md', 'docs/database/**/*.md', 'docs/server/**/*.md', '**/*backend*.md', '**/*api*.md'], exclude: [], summaryMode: 'summary' },
            'qa-agent': { include: ['docs/test/**/*.md', 'docs/qa/**/*.md', 'CONTRIBUTING.md', '**/*test*.md'], exclude: [], summaryMode: 'summary' },
            'git-manager': { include: ['CONTRIBUTING.md', 'docs/release/**/*.md', 'docs/deploy/**/*.md', '**/*release*.md'], exclude: [], summaryMode: 'summary' },
            'doc-writer': { include: ['docs/**/*.md', 'README.md'], exclude: [], summaryMode: 'summary' },
            designer: { include: ['docs/design/**/*.md', 'docs/ui/**/*.md', '**/*design*.md', '**/*ux*.md'], exclude: [], summaryMode: 'summary' },
            'web-researcher': { include: ['README.md', 'docs/**/*.md'], exclude: [], summaryMode: 'summary' },
            'knowledge-source-agent': { include: ['README.md', 'llms.txt', 'docs/**/*.md', '.codex/**/*.md', '.codex/agents/*.toml'], exclude: [], summaryMode: 'summary' },
            'knowledge-index-agent': { include: ['README.md', 'llms.txt', 'docs/**/*.md', '.codex/workflow-knowledge.json'], exclude: [], summaryMode: 'summary' },
            'rag-retriever-agent': { include: ['README.md', 'llms.txt', 'docs/**/*.md', '.codex/workflow-knowledge.json'], exclude: [], summaryMode: 'summary' },
            'knowledge-auditor-agent': { include: ['README.md', 'AGENTS.md', 'llms.txt', 'docs/**/*.md', '.codex/**/*.toml', '.codex/**/*.json'], exclude: [], summaryMode: 'summary' },
            'wiki-export-agent': { include: ['README.md', 'llms.txt', 'docs/**/*.md', '.codex/workflow-knowledge.json'], exclude: [], summaryMode: 'summary' },
        },
    };
}

export function readDocumentProfile(cwd: string): ProjectDocumentProfile {
    const file = documentProfilePath(cwd);
    if (!fs.existsSync(file)) return defaultDocumentProfile();
    try {
        return normalizeProfile(JSON.parse(fs.readFileSync(file, 'utf-8')));
    } catch {
        return defaultDocumentProfile();
    }
}

export function saveDocumentProfile(cwd: string, profile: ProjectDocumentProfile): ProjectDocumentProfile {
    const normalized = normalizeProfile({ ...profile, updatedAt: new Date().toISOString() });
    fs.mkdirSync(path.dirname(documentProfilePath(cwd)), { recursive: true });
    fs.writeFileSync(documentProfilePath(cwd), JSON.stringify(normalized, null, 2), 'utf-8');
    return normalized;
}

export function scanProjectDocuments(cwd: string, profile = readDocumentProfile(cwd)): ScannedDocument[] {
    const normalized = normalizeProfile(profile);
    const files: ScannedDocument[] = [];
    const include = scanIncludePatterns(normalized);
    walk(cwd, '', normalized.global.exclude, rel => {
        const ext = path.extname(rel).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) return;
        if (!matchesAny(rel, include)) return;
        if (matchesAny(rel, normalized.global.exclude)) return;
        const abs = path.join(cwd, rel);
        let stat: fs.Stats;
        try { stat = fs.statSync(abs); }
        catch { return; }
        const hash = hashFile(abs);
        files.push({
            path: normalizeRel(rel),
            absolutePath: abs,
            extension: ext,
            size: stat.size,
            hash,
            cacheStatus: cacheStatus(cwd, rel, hash),
            relevantAgents: relevantAgentsForDocument(normalized, normalizeRel(rel)),
        });
    });
    return files.sort((a, b) => a.path.localeCompare(b.path));
}

function scanIncludePatterns(profile: ProjectDocumentProfile): string[] {
    return Array.from(new Set([
        ...profile.global.include,
        ...Object.values(profile.agents).flatMap(config => config?.include || []),
    ]));
}

export function readDocumentCacheState(cwd: string): DocumentCacheState {
    const profile = readDocumentProfile(cwd);
    const scanned = scanProjectDocuments(cwd, profile);
    const summaries = scanned
        .map(doc => readSummaryCache(cwd, doc.path))
        .filter((entry): entry is DocumentSummaryCache => !!entry);
    const bundles = CODEX_WORKFLOW_ROLES
        .map(role => readAgentBundle(cwd, role, bundleProfileHash(profile, scanned, role)))
        .filter((entry): entry is AgentDocumentBundleCache => !!entry);
    return { profile, scanned, summaries, bundles, knowledge: readKnowledgeStatus(cwd) };
}

export async function recommendDocumentProfile(cwd: string, runner: CodexTextRunner): Promise<{ profile: ProjectDocumentProfile; scanned: ScannedDocument[]; raw: string; reasons: any[]; error?: string }> {
    const baseProfile = readDocumentProfile(cwd);
    const scanned = scanProjectDocuments(cwd, baseProfile);
    const candidates = scanned.slice(0, 160).map(doc => ({
        path: doc.path,
        extension: doc.extension,
        size: doc.size,
        preview: readDocumentText(doc.absolutePath).slice(0, 800),
    }));
    const prompt = [
        'You are docs-agent. Recommend which project guide/rule documents each workflow agent should read.',
        'Return JSON only with this shape:',
        '{"agents":{"docs-agent":{"include":[],"exclude":[]},"frontend-coder":{"include":[],"exclude":[]},"backend-coder":{"include":[],"exclude":[]},"qa-agent":{"include":[],"exclude":[]},"git-manager":{"include":[],"exclude":[]},"designer":{"include":[],"exclude":[]},"doc-writer":{"include":[],"exclude":[]}},"reasons":[{"path":"...","agents":["..."],"reasonKo":"..."}]}',
        'Use only paths from the candidate list. Keep include lists practical and avoid broad patterns unless the folder is clearly role-specific.',
        '',
        JSON.stringify({ cwd, candidates }, null, 2),
    ].join('\n');
    const raw = await runner(prompt, 'document-profile-recommendation');
    const parsed = parseJsonObject(raw);
    const profile = normalizeProfile({
        ...baseProfile,
        agents: {
            ...baseProfile.agents,
            ...(parsed?.agents || {}),
        },
        updatedAt: new Date().toISOString(),
    });
    return {
        profile,
        scanned,
        raw,
        reasons: Array.isArray(parsed?.reasons) ? parsed.reasons : [],
        ...(parsed ? {} : { error: 'docs-agent recommendation did not return valid JSON. The existing profile was kept.' }),
    };
}

export async function rebuildDocumentCache(cwd: string, runner: CodexTextRunner, roles?: string[]): Promise<DocumentCacheState> {
    const knowledgeConfig = readKnowledgeConfig(cwd);
    rebuildLocalKnowledgeIndex(cwd, knowledgeConfig);
    if (knowledgeConfig.writeGeneratedVault) exportKnowledgeVault(cwd);

    const profile = readDocumentProfile(cwd);
    const scanned = scanProjectDocuments(cwd, profile);
    const targetRoles = (roles && roles.length ? roles : [...CODEX_WORKFLOW_ROLES]).filter(role => CODEX_WORKFLOW_ROLES.includes(role as CodexWorkflowRole));
    const neededDocs = scanned.filter(doc => doc.relevantAgents.some(role => targetRoles.includes(role)));
    for (const doc of neededDocs) {
        const existing = readSummaryCache(cwd, doc.path);
        if (existing?.hash === doc.hash) continue;
        const summary = await summarizeDocument(doc, runner);
        writeSummaryCache(cwd, {
            path: doc.path,
            hash: doc.hash,
            summaryKo: summary.summaryKo || summary.text || '',
            rules: toStringArray(summary.rules),
            commands: toStringArray(summary.commands),
            warnings: toStringArray(summary.warnings),
            relevantAgents: doc.relevantAgents,
            updatedAt: new Date().toISOString(),
        });
    }
    for (const role of targetRoles) {
        const roleDocs = docsForAgent(profile, scanned, role as CodexWorkflowRole);
        const profileHash = bundleProfileHash(profile, scanned, role);
        const existingBundle = readAgentBundle(cwd, role, profileHash);
        if (existingBundle) continue;
        const summaries = roleDocs
            .map(doc => readSummaryCache(cwd, doc.path))
            .filter((entry): entry is DocumentSummaryCache => !!entry && entry.hash === roleDocs.find(doc => doc.path === entry.path)?.hash);
        if (summaries.length === 0) continue;
        const bundle = await summarizeAgentBundle(role, summaries, runner);
        writeAgentBundle(cwd, {
            role,
            profileHash,
            sourceDocs: summaries.map(s => s.path),
            summaryKo: bundle.summaryKo || summaries.map(s => `${s.path}: ${s.summaryKo}`).join('\n\n'),
            mustFollow: toStringArray(bundle.mustFollow),
            warnings: toStringArray(bundle.warnings),
            updatedAt: new Date().toISOString(),
        });
    }
    return readDocumentCacheState(cwd);
}

export function agentDocumentContext(cwd: string, role: string): string {
    if (!CODEX_WORKFLOW_ROLES.includes(role as CodexWorkflowRole)) return '';
    const profile = readDocumentProfile(cwd);
    const scanned = scanProjectDocuments(cwd, profile);
    const currentHashes = new Map(scanned.map(doc => [doc.path, doc.hash]));
    const bundle = readAgentBundle(cwd, role, bundleProfileHash(profile, scanned, role));
    const knowledgeContext = formatKnowledgeContext(cwd, role);
    if (bundle) return [formatAgentBundle(bundle), knowledgeContext].filter(Boolean).join('\n\n');
    const docs = docsForAgent(profile, scanned, role as CodexWorkflowRole)
        .map(doc => readSummaryCache(cwd, doc.path))
        .filter((entry): entry is DocumentSummaryCache => !!entry && entry.hash === currentHashes.get(entry.path));
    if (docs.length === 0) return knowledgeContext;
    return [formatAgentBundle({
        role,
        profileHash: bundleProfileHash(profile, scanned, role),
        sourceDocs: docs.map(doc => doc.path),
        summaryKo: docs.map(doc => `${doc.path}: ${doc.summaryKo}`).join('\n\n'),
        mustFollow: Array.from(new Set(docs.flatMap(doc => doc.rules || []))),
        warnings: Array.from(new Set(docs.flatMap(doc => doc.warnings || []))),
        updatedAt: new Date().toISOString(),
    }), knowledgeContext].filter(Boolean).join('\n\n');
}

function formatKnowledgeContext(cwd: string, role: string): string {
    try {
        const query = `${role} project rules docs rag knowledge citations implementation constraints`;
        return formatAgentKnowledgeContext(buildAgentKnowledgeContext(cwd, role, query));
    } catch {
        return '';
    }
}

export function bundleProfileHash(profile: ProjectDocumentProfile, scanned: ScannedDocument[], role: string): string {
    const roleDocs = CODEX_WORKFLOW_ROLES.includes(role as CodexWorkflowRole)
        ? docsForAgent(profile, scanned, role as CodexWorkflowRole).map(doc => ({ path: doc.path, hash: doc.hash }))
        : [];
    return sha256(JSON.stringify({ global: profile.global, agent: (profile.agents as any)[role] || null, roleDocs })).slice(0, 20);
}

function normalizeProfile(value: any): ProjectDocumentProfile {
    const defaults = defaultDocumentProfile();
    const agents: Partial<Record<CodexWorkflowRole, AgentDocumentConfig>> = {};
    const rawAgents = value?.agents && typeof value.agents === 'object' ? value.agents : {};
    for (const role of CODEX_WORKFLOW_ROLES) {
        const raw = rawAgents[role] || {};
        const fallback = defaults.agents[role] || { include: [], exclude: [], summaryMode: 'summary' as const };
        agents[role] = {
            include: arrayOr(raw.include, fallback.include || []),
            exclude: arrayOr(raw.exclude, fallback.exclude || []),
            summaryMode: raw.summaryMode === 'off' ? 'off' : 'summary',
        };
    }
    return {
        version: 1,
        global: {
            include: arrayOr(value?.global?.include, defaults.global.include),
            exclude: arrayOr(value?.global?.exclude, defaults.global.exclude),
        },
        agents,
        updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : undefined,
    };
}

function relevantAgentsForDocument(profile: ProjectDocumentProfile, rel: string): string[] {
    return CODEX_WORKFLOW_ROLES.filter(role => {
        const config = profile.agents[role];
        if (!config || config.summaryMode === 'off') return false;
        if (matchesAny(rel, [...profile.global.exclude, ...(config.exclude || [])])) return false;
        return matchesAny(rel, config.include || []);
    });
}

function docsForAgent(profile: ProjectDocumentProfile, scanned: ScannedDocument[], role: CodexWorkflowRole): ScannedDocument[] {
    const config = profile.agents[role];
    if (!config || config.summaryMode === 'off') return [];
    return scanned.filter(doc => {
        if (matchesAny(doc.path, [...profile.global.exclude, ...(config.exclude || [])])) return false;
        return matchesAny(doc.path, config.include || []);
    });
}

async function summarizeDocument(doc: ScannedDocument, runner: CodexTextRunner): Promise<any> {
    const text = readDocumentText(doc.absolutePath);
    if (text.length <= MAX_DIRECT_CHARS) {
        const raw = await runner(documentSummaryPrompt(doc.path, text), `document-summary:${doc.path}`);
        return parseJsonObject(raw) || { text: raw, summaryKo: raw, rules: [], commands: [], warnings: [] };
    }
    const chunkSummaries: string[] = [];
    const chunks = chunkText(text, CHUNK_CHARS).slice(0, MAX_CHUNKS);
    for (let i = 0; i < chunks.length; i++) {
        const raw = await runner(documentChunkSummaryPrompt(doc.path, i + 1, chunks.length, chunks[i]), `document-chunk-summary:${doc.path}:${i + 1}`);
        chunkSummaries.push(raw);
    }
    const raw = await runner(documentSummaryPrompt(doc.path, chunkSummaries.join('\n\n--- chunk summary ---\n\n')), `document-summary:${doc.path}:final`);
    return parseJsonObject(raw) || { text: raw, summaryKo: raw, rules: [], commands: [], warnings: [] };
}

async function summarizeAgentBundle(role: string, summaries: DocumentSummaryCache[], runner: CodexTextRunner): Promise<any> {
    const raw = await runner([
        `You are docs-agent. Create a concise Korean document context bundle for ${role}.`,
        'Return JSON only with this shape:',
        '{"summaryKo":"...","mustFollow":["..."],"warnings":["..."]}',
        'Use the document summaries below. Do not invent rules.',
        JSON.stringify(summaries.map(s => ({ path: s.path, summaryKo: s.summaryKo, rules: s.rules, commands: s.commands, warnings: s.warnings })), null, 2),
    ].join('\n'), `agent-document-bundle:${role}`);
    return parseJsonObject(raw) || { summaryKo: raw, mustFollow: [], warnings: [] };
}

function documentSummaryPrompt(relPath: string, text: string): string {
    return [
        'You are docs-agent. Summarize this project guide/rule document for Codex Workflow agents.',
        'Return JSON only with this shape:',
        '{"summaryKo":"...","rules":["..."],"commands":["..."],"warnings":["..."],"relevantAgents":["docs-agent","frontend-coder","backend-coder","qa-agent","git-manager","designer","doc-writer"]}',
        'Keep Korean concise. Extract implementation rules, test/build commands, and risks. Do not invent facts.',
        `Document path: ${relPath}`,
        'Document text:',
        text,
    ].join('\n');
}

function documentChunkSummaryPrompt(relPath: string, index: number, total: number, text: string): string {
    return [
        'You are docs-agent. Summarize this chunk of a large project guide/rule document in Korean.',
        `Document path: ${relPath}`,
        `Chunk: ${index}/${total}`,
        'Return concise text only with rules, commands, and risks found in this chunk.',
        text,
    ].join('\n');
}

function formatAgentBundle(bundle: AgentDocumentBundleCache): string {
    const lines = [
        `프로젝트 참고 문서 요약 - ${bundle.role}`,
        '',
        '참고 문서:',
        ...bundle.sourceDocs.map(doc => `- ${doc}`),
        '',
        '반드시 지킬 규칙:',
        ...(bundle.mustFollow.length ? bundle.mustFollow.map(rule => `- ${rule}`) : ['- 캐시된 필수 규칙 없음']),
        '',
        '주의:',
        ...(bundle.warnings.length ? bundle.warnings.map(warning => `- ${warning}`) : ['- 캐시된 주의 사항 없음']),
        '',
        '요약:',
        bundle.summaryKo,
    ];
    return lines.join('\n').trim();
}

function writeSummaryCache(cwd: string, entry: DocumentSummaryCache): void {
    ensureCacheDir(cwd);
    fs.writeFileSync(summaryCachePath(cwd, entry.path), JSON.stringify(entry, null, 2), 'utf-8');
}

function readSummaryCache(cwd: string, rel: string): DocumentSummaryCache | null {
    try {
        const file = summaryCachePath(cwd, rel);
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as DocumentSummaryCache;
    } catch {
        return null;
    }
}

function writeAgentBundle(cwd: string, entry: AgentDocumentBundleCache): void {
    ensureCacheDir(cwd);
    fs.writeFileSync(agentBundlePath(cwd, entry.role, entry.profileHash), JSON.stringify(entry, null, 2), 'utf-8');
}

function readAgentBundle(cwd: string, role: string, profileHash: string): AgentDocumentBundleCache | null {
    try {
        const file = agentBundlePath(cwd, role, profileHash);
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as AgentDocumentBundleCache;
    } catch {
        return null;
    }
}

function summaryCachePath(cwd: string, rel: string): string {
    return path.join(documentCacheDir(cwd), `doc-${sha256(normalizeRel(rel)).slice(0, 20)}.json`);
}

function agentBundlePath(cwd: string, role: string, profileHash: string): string {
    return path.join(documentCacheDir(cwd), `bundle-${safeName(role)}-${profileHash}.json`);
}

function ensureCacheDir(cwd: string): void {
    fs.mkdirSync(documentCacheDir(cwd), { recursive: true });
}

function cacheStatus(cwd: string, rel: string, hash: string): ScannedDocument['cacheStatus'] {
    const existing = readSummaryCache(cwd, rel);
    if (!existing) return 'missing';
    return existing.hash === hash ? 'fresh' : 'stale';
}

function walk(root: string, relDir: string, excludes: string[], onFile: (rel: string) => void): void {
    const absDir = path.join(root, relDir);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
        const rel = normalizeRel(path.join(relDir, entry.name));
        if (entry.isDirectory()) {
            if (matchesAny(`${rel}/`, excludes) || matchesAny(`${rel}/**`, excludes)) continue;
            walk(root, rel, excludes, onFile);
        } else if (entry.isFile()) {
            onFile(rel);
        }
    }
}

function matchesAny(relPath: string, patterns: string[]): boolean {
    const normalized = normalizeRel(relPath);
    return patterns.some(pattern => globToRegExp(pattern).test(normalized));
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
    return new RegExp(`^${source}$`);
}

function readDocumentText(abs: string): string {
    const raw = fs.readFileSync(abs, 'utf-8').replace(/^\uFEFF/, '');
    const ext = path.extname(abs).toLowerCase();
    if (ext === '.html' || ext === '.htm') {
        return raw
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
    return raw;
}

function chunkText(text: string, size: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
    return chunks;
}

function hashFile(abs: string): string {
    return sha256(fs.readFileSync(abs));
}

function sha256(value: string | Buffer): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeRel(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function safeName(value: string): string {
    return value.replace(/[^a-z0-9._-]+/gi, '-');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function arrayOr(value: any, fallback: string[]): string[] {
    if (!Array.isArray(value)) return [...fallback];
    return value.map(item => String(item || '').trim()).filter(Boolean);
}

function toStringArray(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(item => String(item || '').trim()).filter(Boolean);
}

function parseJsonObject(text: string): any | null {
    const raw = String(text || '').trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const candidate = fenced || raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    try { return JSON.parse(candidate); }
    catch { return null; }
}
