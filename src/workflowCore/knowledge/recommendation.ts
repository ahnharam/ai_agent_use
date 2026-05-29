import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import {
    KnowledgeDetectionResult,
    RagProviderRecommendation,
    RagProviderRecommendationResult,
    RagProviderCatalog,
    RagProviderCatalogEntry,
    RagRecommendationAction,
    RagRecommendationActionResult,
    RagRecommendationActionability,
    RagRecommendationCitation,
    RagRecommendationEnvironment,
    RagEmbeddingEndpoint,
    RagRecommendationNextAction,
    RagRecommendationPortProbe,
    RagRecommendationReadiness,
    RagRecommendationServiceProbe,
    RagRecommendationProjectProfile,
    RagRecommendationScoreLabel,
    WorkflowKnowledgeConfig,
} from './types';
import { detectKnowledgeSources, scanKnowledgeDocuments } from './sourceRegistry';
import {
    knowledgeVaultDir,
    normalizeKnowledgeConfig,
    readJsonFile,
    readKnowledgeConfig,
    readTextFile,
    saveKnowledgeConfig,
    walkFiles,
    writeJsonFile,
} from './utils';

const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';
const QDRANT_DEFAULT_URL = 'http://127.0.0.1:6333';
const CHROMA_DEFAULT_URL = 'http://127.0.0.1:8000';

const CODE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.java', '.cs', '.go', '.rs', '.php', '.rb',
    '.swift', '.kt', '.cpp', '.c', '.h', '.hpp', '.sql',
]);

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc', '.html', '.htm']);
const API_KEY_NAMES = ['OPENAI_API_KEY', 'VOYAGE_API_KEY', 'COHERE_API_KEY', 'QDRANT_API_KEY', 'PINECONE_API_KEY'];

const QDRANT_CONTAINER_NAME = 'codex-workflow-qdrant';
const QDRANT_VOLUME_NAME = 'codex-workflow-qdrant-storage';
const CHROMA_CONTAINER_NAME = 'codex-workflow-chroma';
const CHROMA_VOLUME_NAME = 'codex-workflow-chroma-data';
const DOCKER_DESKTOP_EXE = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';

const BASIS: Record<string, RagRecommendationCitation> = {
    qdrantFastembed: {
        title: 'Qdrant FastEmbed',
        url: 'https://qdrant.tech/documentation/fastembed/',
        source: 'official-docs',
        note: 'Qdrant documents FastEmbed as a lightweight embedding generation path that integrates with Qdrant.',
    },
    qdrantEmbeddings: {
        title: 'Qdrant embeddings',
        url: 'https://qdrant.tech/documentation/embeddings/',
        source: 'official-docs',
        note: 'Qdrant supports dense text and multimodal embedding models and embedding services.',
    },
    chromaEmbeddings: {
        title: 'Chroma embedding functions',
        url: 'https://docs.trychroma.com/docs/embeddings/embedding-functions',
        source: 'official-docs',
        note: 'Chroma supports explicit embedding functions including OpenAI, Ollama, and Sentence Transformers integrations.',
    },
    ollamaEmbed: {
        title: 'Ollama embeddings API',
        url: 'https://docs.ollama.com/api/embed',
        source: 'official-docs',
        note: 'Ollama exposes a local /api/embed endpoint for embedding models.',
    },
    openaiEmbeddings: {
        title: 'OpenAI embeddings',
        url: 'https://platform.openai.com/docs/guides/embeddings',
        source: 'official-docs',
        note: 'OpenAI documents text-embedding-3-small and text-embedding-3-large, including vector dimensions.',
    },
    mteb: {
        title: 'MTEB leaderboard',
        url: 'https://huggingface.co/spaces/mteb/leaderboard',
        source: 'benchmark',
        note: 'MTEB is a public benchmark reference for comparing embedding models.',
    },
    bgeM3: {
        title: 'BAAI/bge-m3 model card',
        url: 'https://huggingface.co/BAAI/bge-m3',
        source: 'official-docs',
        note: 'BGE-M3 is documented as multilingual and long-context capable.',
    },
    qwen3Embedding: {
        title: 'Qwen3-Embedding',
        url: 'https://github.com/QwenLM/Qwen3-Embedding',
        source: 'official-docs',
        note: 'Qwen3-Embedding is documented for text retrieval, code retrieval, multilingual retrieval, and reranking.',
    },
    voyageEmbeddings: {
        title: 'Voyage embeddings',
        url: 'https://docs.voyageai.com/docs/embeddings',
        source: 'official-docs',
        note: 'Voyage documents voyage-code-3 for code retrieval and current Voyage 4 embedding models.',
    },
    localDetection: {
        title: 'Local environment detection',
        source: 'local-detection',
        note: 'Recommendation includes local Docker, Ollama, vector DB, API key name, and existing RAG signals.',
    },
    projectAnalysis: {
        title: 'Project source profile',
        source: 'project-analysis',
        note: 'Recommendation includes repository file mix, document language ratio, and existing RAG indicators.',
    },
};

const PROVIDER_CATALOG_SEED: RagProviderCatalogEntry[] = [
    {
        id: 'qdrant',
        title: 'Qdrant',
        kind: 'vector-db',
        defaultCandidate: true,
        officialUrl: BASIS.qdrantEmbeddings.url!,
        note: 'Primary managed/local vector DB candidate for the Workflow knowledge layer.',
    },
    {
        id: 'chroma',
        title: 'Chroma',
        kind: 'vector-db',
        defaultCandidate: false,
        officialUrl: BASIS.chromaEmbeddings.url!,
        note: 'Recommended mainly when the project already uses Chroma or is Python RAG oriented.',
    },
    {
        id: 'ollama',
        title: 'Ollama embeddings',
        kind: 'embedding-provider',
        defaultCandidate: true,
        officialUrl: BASIS.ollamaEmbed.url!,
        note: 'Local embedding provider candidate for privacy-first setups.',
    },
    {
        id: 'openai',
        title: 'OpenAI embeddings',
        kind: 'embedding-provider',
        defaultCandidate: false,
        officialUrl: BASIS.openaiEmbeddings.url!,
        note: 'External embedding provider candidate for operational quality.',
    },
    {
        id: 'bge-m3',
        title: 'BAAI/bge-m3',
        kind: 'embedding-model',
        defaultCandidate: true,
        officialUrl: BASIS.bgeM3.url!,
        note: 'Local multilingual embedding model candidate.',
    },
    {
        id: 'qwen3-embedding',
        title: 'Qwen3-Embedding',
        kind: 'embedding-model',
        defaultCandidate: false,
        officialUrl: BASIS.qwen3Embedding.url!,
        note: 'Higher-effort multilingual/code embedding and reranker candidate.',
    },
    {
        id: 'voyage-code',
        title: 'Voyage code embeddings',
        kind: 'embedding-model',
        defaultCandidate: false,
        officialUrl: BASIS.voyageEmbeddings.url!,
        note: 'External code-search embedding candidate.',
    },
    {
        id: 'mteb',
        title: 'MTEB',
        kind: 'benchmark',
        defaultCandidate: false,
        officialUrl: BASIS.mteb.url!,
        note: 'Benchmark reference for embedding-model comparisons.',
    },
];

export interface RagRecommendationOptions {
    refreshWeb?: boolean;
}

export interface RagRecommendationApplyResult {
    ok: boolean;
    profileId: string;
    message: string;
    config: WorkflowKnowledgeConfig;
}

export async function recommendRagProviders(cwd: string, options: RagRecommendationOptions = {}): Promise<RagProviderRecommendationResult> {
    const config = readKnowledgeConfig(cwd);
    const detection = detectKnowledgeSources(cwd, config);
    const environment = await detectRecommendationEnvironment(cwd);
    const project = analyzeProjectProfile(cwd, config, detection);
    const warnings = [...detection.warnings];
    const providerCatalog = await refreshProviderCatalog(options.refreshWeb === true);
    warnings.push(...providerCatalog.warnings);
    const basis = mergeCitationRefresh(Object.values(BASIS), providerCatalog);
    const citationMap = new Map(basis.map(citation => [citation.title, citation]));
    const recommendations = rankRecommendations(buildRecommendations(config, detection, environment, project, citationMap));
    const generatedAt = new Date().toISOString();
    const result: RagProviderRecommendationResult = {
        generatedAt,
        cachePath: ragRecommendationCachePath(cwd, config),
        currentDefault: {
            mode: config.mode,
            preferred: config.preferred,
            fallback: config.fallback,
        },
        environment,
        project,
        recommendations,
        warnings,
        citations: uniqueCitations(recommendations.flatMap(recommendation => recommendation.citations)),
        providerCatalog,
    };
    writeJsonFile(result.cachePath, result);
    return result;
}

export function readRagProviderRecommendations(cwd: string, config = readKnowledgeConfig(cwd)): RagProviderRecommendationResult | null {
    return readJsonFile<RagProviderRecommendationResult>(ragRecommendationCachePath(cwd, config));
}

export function emptyRagProviderRecommendations(cwd: string, config = readKnowledgeConfig(cwd)): { cachePath: string; recommendations: RagProviderRecommendation[]; warnings: string[] } {
    return {
        cachePath: ragRecommendationCachePath(cwd, config),
        recommendations: [],
        warnings: ['No cached RAG provider recommendations. Run POST /rag/recommend first.'],
    };
}

export async function applyRagProviderRecommendation(cwd: string, profileId: string): Promise<RagRecommendationApplyResult> {
    const cached = readRagProviderRecommendations(cwd) || await recommendRagProviders(cwd, { refreshWeb: false });
    const recommendation = cached.recommendations.find(item => item.profileId === profileId);
    if (!recommendation) throw new Error(`Unknown RAG recommendation profile: ${profileId}`);
    const current = readKnowledgeConfig(cwd);
    const now = new Date().toISOString();
    const next = normalizeKnowledgeConfig({
        ...current,
        ...recommendation.configPatch,
        embedding: {
            ...current.embedding,
            ...recommendation.configPatch.embedding,
        },
        vectorDb: {
            ...current.vectorDb,
            ...recommendation.configPatch.vectorDb,
        },
        recommendation: {
            ...(current.recommendation || {}),
            appliedProfileId: recommendation.profileId,
            appliedAt: now,
            lastRecommendedAt: cached.generatedAt,
        },
    });
    const saved = saveKnowledgeConfig(cwd, next);
    return {
        ok: true,
        profileId: recommendation.profileId,
        message: 'Recommendation applied to workflow-knowledge config only. No installs, service starts, or model downloads were performed.',
        config: saved,
    };
}

export async function applyAndPrepareLocalRagProviderRecommendation(cwd: string, profileId: string, options: any = {}): Promise<RagRecommendationActionResult> {
    if (options.confirm !== true) {
        return {
            ok: false,
            action: 'prepare-local-and-apply',
            status: 'blocked',
            message: 'Action was not run. The request must include confirm=true because this can apply settings, start local services, or download local models.',
            blockingReasons: ['Missing explicit confirmation for local preparation and settings apply.'],
        };
    }
    const cached = readRagProviderRecommendations(cwd) || await recommendRagProviders(cwd, { refreshWeb: false });
    const recommendation = cached.recommendations.find(item => item.profileId === profileId);
    if (!recommendation) throw new Error(`Unknown RAG recommendation profile: ${profileId}`);

    const manualReasons = localPrepareManualReasons(recommendation);
    if (manualReasons.length) {
        return {
            ok: false,
            action: 'prepare-local-and-apply',
            status: 'blocked',
            message: 'Local preparation was not run because this recommendation requires manual external setup.',
            blockingReasons: manualReasons,
            suggestedActions: ['Use Settings Apply after manually registering the required API key or choose a local/free recommendation.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }

    const environmentBefore = await detectRecommendationEnvironment(cwd);
    const localActions = await localPreparationActions(cwd, recommendation, environmentBefore);
    const blockingReasons = recommendation.blockingReasons || [];
    if (recommendation.readiness !== 'ready' && !localActions.length && blockingReasons.length) {
        return {
            ok: false,
            action: 'prepare-local-and-apply',
            status: 'blocked',
            message: 'Local preparation cannot be completed automatically for this recommendation.',
            blockingReasons,
            suggestedActions: [
                'Resolve the blocked local prerequisite, then refresh recommendations.',
                'Use Settings Apply only if you intentionally want to save the config before the local runtime is ready.',
            ],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }

    const applyResult = await applyRagProviderRecommendation(cwd, profileId);
    const steps: RagRecommendationActionResult[] = [{
        ok: applyResult.ok,
        action: 'prepare-local-and-apply',
        status: applyResult.ok ? 'ok' : 'failed',
        message: applyResult.message,
        configUpdated: true,
    }];

    for (const action of localActions) {
        const result = await runRagRecommendationAction(cwd, action.action, {
            ...action,
            profileId,
            model: action.model || recommendation.embeddingModel,
            confirm: true,
        });
        steps.push(result);
        if (!result.ok && result.status !== 'noop') {
            return {
                ok: false,
                action: 'prepare-local-and-apply',
                status: result.status === 'failed' ? 'failed' : 'blocked',
                message: 'Settings were applied, but local preparation stopped before completion.',
                blockingReasons: result.blockingReasons || [result.message],
                suggestedActions: result.suggestedActions,
                output: summarizeActionSteps(steps),
                steps,
                configUpdated: true,
                environment: await detectRecommendationEnvironment(cwd),
            };
        }
    }

    for (const validation of localValidationActions(recommendation)) {
        const result = await runRagRecommendationAction(cwd, validation.action, {
            ...validation,
            profileId,
            model: validation.model || recommendation.embeddingModel,
        });
        steps.push(result);
    }

    const failedValidation = steps.find(step => !step.ok && (step.action === 'validate-vector-db' || step.action === 'validate-embedding-endpoint'));
    await recommendRagProviders(cwd, { refreshWeb: false });
    return {
        ok: !failedValidation,
        action: 'prepare-local-and-apply',
        status: failedValidation ? 'blocked' : 'ok',
        message: failedValidation
            ? 'Settings were applied and local preparation ran, but validation still has blockers.'
            : 'Local preparation, settings apply, and validation completed.',
        blockingReasons: failedValidation?.blockingReasons,
        suggestedActions: failedValidation?.suggestedActions,
        output: summarizeActionSteps(steps),
        steps,
        configUpdated: true,
        environment: await detectRecommendationEnvironment(cwd),
    };
}

export async function runRagRecommendationAction(cwd: string, action: RagRecommendationAction, options: any = {}): Promise<RagRecommendationActionResult> {
    if (action === 'health') {
        return {
            ok: true,
            action,
            status: 'ok',
            message: 'RAG provider health probe completed.',
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    if (action === 'prepare-qdrant') return prepareQdrantService(cwd);
    if (action === 'prepare-chroma') return prepareChromaService(cwd);
    if (action === 'validate-embedding-endpoint') return validateEmbeddingEndpoint(cwd, options);
    if (action === 'validate-vector-db') return validateVectorDb(cwd, options);
    if (options.confirm !== true) {
        return {
            ok: false,
            action,
            status: 'blocked',
            message: 'Action was not run. The request must include confirm=true because this can start services or download models.',
            blockingReasons: ['Missing explicit confirmation for a service start or model download action.'],
        };
    }
    if (action === 'install-docker-desktop') return installDockerDesktop(cwd);
    if (action === 'start-docker-engine') return startDockerEngine(cwd);
    if (action === 'install-native-ollama') return installNativeOllama(cwd);
    if (action === 'start-native-ollama') return startNativeOllama(cwd);
    if (action === 'start-qdrant') return startQdrantService(cwd);
    if (action === 'start-chroma') return startChromaService(cwd);
    if (action === 'pull-ollama-model') return pullOllamaModel(cwd, String(options.model || ''), normalizeBaseUrl(options.baseUrl || process.env.OLLAMA_HOST || configuredEmbeddingBaseUrl(readKnowledgeConfig(cwd), 'ollama') || OLLAMA_DEFAULT_URL));
    return { ok: false, action, status: 'failed', message: `Unsupported RAG recommendation action: ${action}` };
}

function localPrepareManualReasons(recommendation: RagProviderRecommendation): string[] {
    const provider = String(recommendation.embeddingProvider || '').toLowerCase();
    const reasons: string[] = [];
    if (provider === 'openai') reasons.push('OPENAI_API_KEY must be created and registered manually.');
    if (provider === 'voyage') reasons.push('VOYAGE_API_KEY must be created and registered manually.');
    if (provider === 'openai-compatible' && (recommendation.blockingReasons || []).some(reason => /openai-compatible local embedding endpoint/i.test(reason))) {
        reasons.push('OpenAI-compatible local embedding server setup is manual in v1.');
    }
    for (const item of recommendation.requiredInstall || []) {
        if (/api[_-]?key/i.test(item)) reasons.push(`${item} must be prepared manually.`);
    }
    if (recommendation.actionability === 'needs-key') {
        reasons.push('This recommendation is waiting for a manually registered API key.');
    }
    return uniqueStrings(reasons);
}

function isLocalPreparationAction(action: RagRecommendationAction): boolean {
    return action === 'install-docker-desktop'
        || action === 'start-docker-engine'
        || action === 'install-native-ollama'
        || action === 'start-native-ollama'
        || action === 'start-qdrant'
        || action === 'start-chroma'
        || action === 'pull-ollama-model';
}

function localPreparationActionOrder(action: RagRecommendationAction): number {
    if (action === 'install-docker-desktop') return 5;
    if (action === 'start-docker-engine') return 10;
    if (action === 'install-native-ollama') return 15;
    if (action === 'start-native-ollama') return 20;
    if (action === 'start-qdrant' || action === 'start-chroma') return 30;
    if (action === 'pull-ollama-model') return 40;
    return 100;
}

async function localPreparationActions(cwd: string, recommendation: RagProviderRecommendation, environment: RagRecommendationEnvironment): Promise<RagRecommendationNextAction[]> {
    const planned = new Map<string, RagRecommendationNextAction>();
    const add = (action: RagRecommendationNextAction) => {
        planned.set(`${action.action}:${action.model || ''}`, action);
    };
    for (const action of (recommendation.nextActions || [])
        .filter(action => isLocalPreparationAction(action.action) && action.enabled !== false)
    ) {
        add(action);
    }
    const vectorDb = String(recommendation.vectorDb || '').toLowerCase();
    const provider = String(recommendation.embeddingProvider || '').toLowerCase();
    if ((vectorDb.includes('qdrant') || vectorDb.includes('chroma')) && !environment.docker.running) {
        if (!environment.docker.installed && wingetInstalled()) {
            add({ action: 'install-docker-desktop', label: 'Install Docker Desktop', requiresConfirm: true, enabled: true });
        }
        if (environment.docker.desktopInstalled || environment.docker.installed || wingetInstalled()) {
            add({ action: 'start-docker-engine', label: 'Start Docker Engine', requiresConfirm: true, enabled: true });
        }
    }
    if (vectorDb.includes('qdrant') && !environment.qdrant.reachable) {
        add({ action: 'start-qdrant', label: 'Start Qdrant', requiresConfirm: true, enabled: true });
    }
    if (vectorDb.includes('chroma') && !environment.chroma.reachable) {
        add({ action: 'start-chroma', label: 'Start Chroma', requiresConfirm: true, enabled: true });
    }
    if (provider === 'ollama') {
        const nativeEndpoint = (environment.embeddingEndpoints || []).find(endpoint => endpoint.kind === 'native-ollama' && endpoint.capabilities.canPullModels);
        if (!nativeEndpoint) {
            const ollamaExe = detectNativeOllamaExecutable();
            if (!ollamaExe && wingetInstalled()) {
                add({ action: 'install-native-ollama', label: 'Install native Ollama', requiresConfirm: true, enabled: true });
            }
            add({ action: 'start-native-ollama', label: 'Start native Ollama', requiresConfirm: true, enabled: true });
        }
        if (recommendation.embeddingModel && recommendation.embeddingModel !== 'none') {
            add({ action: 'pull-ollama-model', label: `Pull ${recommendation.embeddingModel}`, requiresConfirm: true, enabled: true, model: recommendation.embeddingModel });
        }
    }
    return Array.from(planned.values())
        .sort((a, b) => localPreparationActionOrder(a.action) - localPreparationActionOrder(b.action));
}

function disabledLocalPreparationActions(recommendation: RagProviderRecommendation): RagRecommendationNextAction[] {
    return (recommendation.nextActions || [])
        .filter(action => isLocalPreparationAction(action.action) && action.enabled === false);
}

function localValidationActions(recommendation: RagProviderRecommendation): RagRecommendationNextAction[] {
    const actions: RagRecommendationNextAction[] = [];
    const vectorDb = String(recommendation.vectorDb || '').toLowerCase();
    const provider = String(recommendation.embeddingProvider || '').toLowerCase();
    if (vectorDb.includes('qdrant') || vectorDb.includes('chroma')) {
        actions.push({ action: 'validate-vector-db', label: 'Validate vector DB', requiresConfirm: false, enabled: true });
    }
    if (provider === 'ollama' || provider === 'openai-compatible') {
        actions.push({ action: 'validate-embedding-endpoint', label: 'Validate embedding endpoint', requiresConfirm: false, enabled: true, model: recommendation.embeddingModel });
    }
    return actions;
}

function summarizeActionSteps(steps: RagRecommendationActionResult[]): string {
    return steps.map((step, index) => {
        const status = step.status || (step.ok ? 'ok' : 'failed');
        return [
            `${index + 1}. ${step.action}: ${status}`,
            step.message,
            step.command ? `command: ${step.command}` : '',
            step.blockingReasons?.length ? `blocking: ${step.blockingReasons.join('; ')}` : '',
            step.suggestedActions?.length ? `suggested: ${step.suggestedActions.join('; ')}` : '',
        ].filter(Boolean).join('\n');
    }).join('\n\n');
}

export function ragRecommendationCacheDir(cwd: string, config = readKnowledgeConfig(cwd)): string {
    return path.join(knowledgeVaultDir(cwd, config), 'recommendations');
}

export function ragRecommendationCachePath(cwd: string, config = readKnowledgeConfig(cwd)): string {
    return path.join(ragRecommendationCacheDir(cwd, config), 'latest.json');
}

async function detectRecommendationEnvironment(cwd: string): Promise<RagRecommendationEnvironment> {
    const config = readKnowledgeConfig(cwd);
    const docker = detectDocker();
    const ollamaBaseUrl = normalizeBaseUrl(process.env.OLLAMA_HOST || process.env.HARAM_AI_OLLAMA_URL || configuredEmbeddingBaseUrl(config, 'ollama') || OLLAMA_DEFAULT_URL);
    const qdrantUrl = normalizeBaseUrl(process.env.QDRANT_URL || configuredVectorDbUrl(config, 'qdrant') || QDRANT_DEFAULT_URL);
    const chromaUrl = normalizeBaseUrl(process.env.CHROMA_URL || configuredVectorDbUrl(config, 'chroma') || CHROMA_DEFAULT_URL);
    const openAiCompatibleUrl = normalizeOptionalBaseUrl(process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.QWEN_EMBEDDING_BASE_URL || 'http://127.0.0.1:8080/v1');
    const [embeddingEndpoints, qdrant, chroma, ports] = await Promise.all([
        detectEmbeddingEndpoints(ollamaBaseUrl, openAiCompatibleUrl),
        probeQdrant(qdrantUrl),
        probeChroma(chromaUrl),
        detectPorts([ollamaBaseUrl, qdrantUrl, chromaUrl, openAiCompatibleUrl || 'http://127.0.0.1:8080']),
    ]);
    const ollamaEndpoint = embeddingEndpoints.find(endpoint => endpoint.kind === 'native-ollama' || endpoint.kind === 'ollama-compatible');
    const ollama = legacyOllamaState(ollamaBaseUrl, ollamaEndpoint);
    return {
        docker,
        ollama,
        qdrant,
        chroma,
        vectorDbs: { qdrant, chroma },
        embeddingEndpoints,
        ports,
        apiKeys: detectApiKeyNames(cwd),
    };
}

function configuredVectorDbUrl(config: WorkflowKnowledgeConfig, provider: 'qdrant' | 'chroma'): string | undefined {
    if (config.vectorDb.provider !== provider) return undefined;
    return config.vectorDb.url;
}

function configuredEmbeddingBaseUrl(config: WorkflowKnowledgeConfig, provider: 'ollama' | 'openai-compatible'): string | undefined {
    if (config.embedding.provider !== provider) return undefined;
    return config.embedding.baseUrl;
}

function detectDocker(): RagRecommendationEnvironment['docker'] {
    const version = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
        encoding: 'utf-8',
        timeout: 3000,
        windowsHide: true,
    });
    if (version.error && (version.error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { installed: false, running: false, engineRunning: false, desktopInstalled: false, message: 'docker command was not found.' };
    }
    if (version.status === 0) {
        return {
            installed: true,
            running: true,
            engineRunning: true,
            desktopInstalled: detectDockerDesktopInstalled(),
            version: String(version.stdout || '').trim(),
            message: 'Docker Engine is reachable.',
        };
    }
    const client = spawnSync('docker', ['--version'], {
        encoding: 'utf-8',
        timeout: 3000,
        windowsHide: true,
    });
    return {
        installed: client.status === 0,
        running: false,
        engineRunning: false,
        desktopInstalled: detectDockerDesktopInstalled(),
        version: client.status === 0 ? String(client.stdout || '').trim() : undefined,
        message: String(version.stderr || version.stdout || 'Docker Engine is not reachable.').trim(),
    };
}

async function detectOllama(baseUrl: string): Promise<RagRecommendationEnvironment['ollama']> {
    return legacyOllamaState(baseUrl, (await detectEmbeddingEndpoints(baseUrl, undefined))[0]);
}

function detectDockerDesktopInstalled(): boolean {
    if (process.platform !== 'win32') return false;
    return fs.existsSync(DOCKER_DESKTOP_EXE);
}

function wingetInstalled(): boolean {
    if (process.platform !== 'win32') return false;
    const result = spawnSync('winget', ['--version'], {
        encoding: 'utf-8',
        timeout: 3000,
        windowsHide: true,
    });
    return result.status === 0;
}

function detectNativeOllamaExecutable(): string | null {
    const candidates = [
        process.env.OLLAMA_EXE || '',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Ollama', 'ollama.exe'),
        'C:\\Program Files\\Ollama\\ollama.exe',
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    const where = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['ollama'], {
        encoding: 'utf-8',
        timeout: 3000,
        windowsHide: true,
    });
    if (where.status === 0) {
        const first = String(where.stdout || '').split(/\r?\n/).map(item => item.trim()).find(Boolean);
        if (first && fs.existsSync(first)) return first;
    }
    return null;
}

async function detectEmbeddingEndpoints(ollamaBaseUrl: string, openAiCompatibleBaseUrl?: string): Promise<RagEmbeddingEndpoint[]> {
    const endpoints: RagEmbeddingEndpoint[] = [];
    endpoints.push(await detectOllamaEndpoint(ollamaBaseUrl));
    if (openAiCompatibleBaseUrl) {
        const openAiCompatible = await detectOpenAiCompatibleEndpoint(openAiCompatibleBaseUrl);
        if (openAiCompatible.runtimeState.reachable || process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.QWEN_EMBEDDING_BASE_URL) {
            endpoints.push(openAiCompatible);
        }
    }
    return endpoints;
}

async function detectOllamaEndpoint(baseUrl: string): Promise<RagEmbeddingEndpoint> {
    const normalized = baseUrl.replace(/\/$/, '');
    const tags = await readOptionalJsonUrl<any>(`${normalized}/api/tags`, 1600);
    if (!tags.ok) {
        return {
            id: 'ollama-default',
            kind: 'none',
            baseUrl,
            models: [],
            message: tags.message || 'Ollama endpoint is not reachable.',
            capabilities: {
                canEmbed: false,
                canPullModels: false,
                canListModels: false,
                supportsBatch: false,
                supportsDimensions: false,
            },
            runtimeState: {
                installed: false,
                running: false,
                reachable: false,
                validated: false,
                portConflict: false,
                blockedReason: tags.message,
            },
        };
    }
    const models = Array.isArray(tags.value?.models)
        ? tags.value.models.map((model: any) => String(model?.name || model?.model || '')).filter(Boolean)
        : [];
    const version = await readOptionalJsonUrl<any>(`${normalized}/api/version`, 1200);
    const embedProbe = await probeOllamaEmbeddingEndpoint(baseUrl, models[0] || 'bge-m3');
    const native = version.ok;
    const canEmbed = native || embedProbe.ok;
    const kind = native ? 'native-ollama' : 'ollama-compatible';
    return {
        id: 'ollama-default',
        kind,
        baseUrl,
        models,
        version: native ? String(version.value?.version || '').trim() : undefined,
        message: native
            ? models.length ? `Native Ollama is reachable with ${models.length} model(s).` : 'Native Ollama is reachable.'
            : models.length
                ? `An Ollama-compatible /api/tags endpoint is reachable with ${models.length} model(s), but native Ollama /api/version is unavailable; model pull actions are disabled.`
                : 'An Ollama-compatible endpoint is reachable, but native Ollama /api/version is unavailable; model pull actions are disabled.',
        capabilities: {
            canEmbed,
            canPullModels: native,
            canListModels: true,
            supportsBatch: true,
            supportsDimensions: false,
        },
        runtimeState: {
            installed: native,
            running: true,
            reachable: true,
            validated: canEmbed,
            portConflict: false,
            blockedReason: canEmbed ? undefined : embedProbe.message,
        },
    };
}

async function detectOpenAiCompatibleEndpoint(baseUrl: string): Promise<RagEmbeddingEndpoint> {
    const normalized = baseUrl.replace(/\/$/, '');
    const models = await readOptionalJsonUrl<any>(`${normalized}/models`, 1200);
    const reachable = models.ok;
    const modelNames = models.ok && Array.isArray(models.value?.data)
        ? models.value.data.map((model: any) => String(model?.id || '')).filter(Boolean)
        : [];
    return {
        id: 'openai-compatible-local',
        kind: reachable ? 'openai-compatible' : 'none',
        baseUrl,
        models: modelNames,
        message: reachable ? `OpenAI-compatible endpoint is reachable with ${modelNames.length} model(s).` : models.message,
        capabilities: {
            canEmbed: reachable,
            canPullModels: false,
            canListModels: reachable,
            supportsBatch: true,
            supportsDimensions: true,
        },
        runtimeState: {
            installed: false,
            running: reachable,
            reachable,
            validated: reachable,
            portConflict: false,
            blockedReason: reachable ? undefined : models.message,
        },
    };
}

function legacyOllamaState(baseUrl: string, endpoint?: RagEmbeddingEndpoint): RagRecommendationEnvironment['ollama'] {
    if (!endpoint || endpoint.kind === 'none') {
        return {
            running: false,
            baseUrl,
            models: [],
            apiCompatible: false,
            native: false,
            canPullModels: false,
            message: endpoint?.message || 'Ollama is not reachable.',
        };
    }
    return {
        running: endpoint.runtimeState.reachable,
        baseUrl: endpoint.baseUrl,
        models: endpoint.models,
        message: endpoint.message,
        apiCompatible: endpoint.kind === 'native-ollama' || endpoint.kind === 'ollama-compatible',
        native: endpoint.kind === 'native-ollama',
        canPullModels: endpoint.capabilities.canPullModels,
        version: endpoint.version,
    };
}

function analyzeProjectProfile(cwd: string, config: WorkflowKnowledgeConfig, detection: KnowledgeDetectionResult): RagRecommendationProjectProfile {
    const docs = scanKnowledgeDocuments(cwd, config);
    let repoFileCount = 0;
    let repoSizeBytes = 0;
    let codeFileCount = 0;
    let docFileCount = docs.length;
    let hasPython = false;
    const exclude = Array.from(new Set([...config.exclude, '.ai-agent/**']));
    walkFiles(cwd, exclude, (rel, abs) => {
        repoFileCount += 1;
        const ext = path.extname(rel).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) codeFileCount += 1;
        if (DOC_EXTENSIONS.has(ext)) docFileCount += 1;
        if (ext === '.py') hasPython = true;
        try {
            repoSizeBytes += fs.statSync(abs).size;
        } catch {
            // ignore files that disappear during scan
        }
    });

    const docSample = docs.slice(0, 80).map(doc => {
        try {
            return readTextFile(doc.absolutePath).slice(0, 20000);
        } catch {
            return '';
        }
    }).join('\n').slice(0, 1000000);
    const koreanChars = (docSample.match(/[\uAC00-\uD7A3]/g) || []).length;
    const meaningfulChars = Math.max(1, docSample.replace(/\s/g, '').length);
    return {
        cwd,
        repoFileCount,
        repoSizeBytes,
        codeFileCount,
        docFileCount,
        codeFileRatio: Number((codeFileCount / Math.max(1, repoFileCount)).toFixed(4)),
        koreanCharRatio: Number((koreanChars / meaningfulChars).toFixed(4)),
        hasPython,
        hasPackageJson: fs.existsSync(path.join(cwd, 'package.json')),
        existingRagKinds: deriveExistingRagKinds(detection),
    };
}

function buildRecommendations(
    config: WorkflowKnowledgeConfig,
    detection: KnowledgeDetectionResult,
    environment: RagRecommendationEnvironment,
    project: RagRecommendationProjectProfile,
    citations: Map<string, RagRecommendationCitation>,
): RagProviderRecommendation[] {
    const localDetection = citation(citations, 'Local environment detection');
    const projectAnalysis = citation(citations, 'Project source profile');
    const hasExistingRag = detection.existingRag.length > 0;
    const hasChroma = project.existingRagKinds.includes('chroma') || environment.chroma.reachable;
    const codeHeavy = project.codeFileRatio >= 0.35 || project.codeFileCount >= 100;
    const multilingual = project.koreanCharRatio >= 0.015;
    const hasOpenAiKey = environment.apiKeys.includes('OPENAI_API_KEY');
    const hasVoyageKey = environment.apiKeys.includes('VOYAGE_API_KEY');
    const bgeM3Available = hasOllamaModel(environment.ollama.models, 'bge-m3');
    const embeddingGemmaAvailable = hasOllamaModel(environment.ollama.models, 'embeddinggemma');
    const qdrantInstall = qdrantInstallNeeds(environment);
    const ollamaInstall = ollamaInstallNeeds(environment);
    const ollamaScore = environment.ollama.canPullModels ? 10 : environment.ollama.apiCompatible ? 3 : 0;
    const bgeM3Install = ollamaModelInstallNeeds(environment, 'bge-m3', bgeM3Available);
    const embeddingGemmaInstall = ollamaModelInstallNeeds(environment, 'embeddinggemma', embeddingGemmaAvailable);
    const ollamaCompatibilityRisk = ollamaEndpointRisk(environment);

    const recommendations: RagProviderRecommendation[] = [{
        profileId: 'current-default-local-hybrid',
        title: 'Current default: existing-first + local-hybrid fallback',
        rank: 0,
        score: 35,
        vectorDb: 'local-hybrid',
        embeddingProvider: 'none',
        embeddingModel: 'none',
        privacy: 'local',
        cost: 'free-local',
        installEffort: 'none',
        externalData: false,
        currentDefault: true,
        requiredInstall: [],
        why: [
            'This keeps the current safe default. It does not assume a vector database or embedding provider exists.',
            'It is useful as a guaranteed fallback, not as the best semantic RAG setup.',
        ],
        risks: ['Lexical retrieval cannot provide the same recall as semantic vector retrieval.'],
        citations: [localDetection, projectAnalysis],
        configPatch: {
            mode: 'auto',
            preferred: 'existing-first',
            fallback: 'local-hybrid',
            embedding: { provider: 'none', model: 'none', externalData: false },
            vectorDb: { provider: 'local-hybrid', mode: 'local', collectionPrefix: 'codex_workflow' },
        },
    }];

    if (hasExistingRag) {
        recommendations.push({
            profileId: 'existing-rag-bridge',
            title: 'Bridge the existing project RAG first',
            rank: 0,
            score: 88 + Math.min(8, detection.existingRag.length * 2),
            vectorDb: project.existingRagKinds.join(', ') || 'existing',
            embeddingProvider: 'existing',
            embeddingModel: 'existing project embedding pipeline',
            privacy: environment.apiKeys.length ? 'mixed' : 'unknown',
            cost: 'existing',
            installEffort: 'low',
            externalData: environment.apiKeys.some(key => key === 'OPENAI_API_KEY' || key === 'VOYAGE_API_KEY'),
            currentDefault: false,
            requiredInstall: [],
            why: [
                'The repository already has RAG indicators, so bridge/observe avoids duplicating infrastructure.',
                `Detected existing RAG signal(s): ${detection.existingRag.map(source => source.id).join(', ')}.`,
            ],
            risks: ['Bridge quality depends on the existing project RAG health and adapter compatibility.'],
            citations: [localDetection, projectAnalysis, citation(citations, 'Qdrant embeddings'), citation(citations, 'Chroma embedding functions')],
            configPatch: {
                mode: 'bridge',
                preferred: 'existing-first',
                fallback: 'local-hybrid',
                embedding: { provider: 'existing', model: 'existing', externalData: environment.apiKeys.length > 0 },
                vectorDb: { provider: 'existing', mode: 'existing', collectionPrefix: 'codex_workflow' },
            },
        });
    }

    recommendations.push({
        profileId: 'local-qdrant-ollama-bge-m3',
        title: 'Local privacy-first: Qdrant + Ollama bge-m3',
        rank: 0,
        score: 70
            + (environment.qdrant.reachable ? 8 : 0)
            + (environment.docker.running ? 5 : 0)
            + ollamaScore
            + (bgeM3Available ? 7 : 0)
            + (multilingual ? 10 : 0),
        vectorDb: 'qdrant',
        embeddingProvider: 'ollama',
        embeddingModel: 'bge-m3',
        reranker: 'optional qwen3-reranker or FastEmbed reranker later',
        privacy: 'local',
        cost: 'free-local',
        installEffort: ollamaRecommendationEffort(environment, qdrantInstall, bgeM3Install),
        externalData: false,
        currentDefault: false,
        requiredInstall: [...qdrantInstall, ...ollamaInstall, ...bgeM3Install],
        why: [
            'Good default upgrade when privacy matters because documents can stay local.',
            multilingual ? 'Project documents include Korean/non-English signals, so a multilingual embedding model is preferred.' : 'BGE-M3 is a stable multilingual local embedding candidate.',
        ],
        risks: [
            'Requires local model storage and embedding throughput depends on this machine.',
            'Qdrant service startup is separate from applying this recommendation.',
            ...(ollamaCompatibilityRisk ? [ollamaCompatibilityRisk] : []),
        ],
        citations: [citation(citations, 'Qdrant FastEmbed'), citation(citations, 'Qdrant embeddings'), citation(citations, 'Ollama embeddings API'), citation(citations, 'BAAI/bge-m3 model card'), localDetection, projectAnalysis],
        configPatch: {
            mode: 'own',
            preferred: 'local-first',
            fallback: 'local-hybrid',
            embedding: { provider: 'ollama', model: 'bge-m3', baseUrl: environment.ollama.baseUrl, externalData: false },
            vectorDb: { provider: 'qdrant', url: environment.qdrant.url, mode: 'managed', collectionPrefix: 'codex_workflow' },
        },
    });

    recommendations.push({
        profileId: 'local-qdrant-ollama-embeddinggemma',
        title: 'Local lightweight: Qdrant + Ollama embeddinggemma',
        rank: 0,
        score: 64
            + (environment.qdrant.reachable ? 8 : 0)
            + ollamaScore
            + (embeddingGemmaAvailable ? 7 : 0)
            + (!codeHeavy ? 4 : 0),
        vectorDb: 'qdrant',
        embeddingProvider: 'ollama',
        embeddingModel: 'embeddinggemma',
        privacy: 'local',
        cost: 'free-local',
        installEffort: ollamaRecommendationEffort(environment, qdrantInstall, embeddingGemmaInstall),
        externalData: false,
        currentDefault: false,
        requiredInstall: [...qdrantInstall, ...ollamaInstall, ...embeddingGemmaInstall],
        why: [
            'Lower-friction local option when the repo is mostly documents and a lighter embedding model is enough.',
            'Keeps data on the local machine while adding semantic retrieval.',
        ],
        risks: [
            'May underperform stronger multilingual or code-specialized embeddings for mixed Korean/code retrieval.',
            ...(ollamaCompatibilityRisk ? [ollamaCompatibilityRisk] : []),
        ],
        citations: [citation(citations, 'Qdrant FastEmbed'), citation(citations, 'Ollama embeddings API'), localDetection, projectAnalysis],
        configPatch: {
            mode: 'own',
            preferred: 'local-first',
            fallback: 'local-hybrid',
            embedding: { provider: 'ollama', model: 'embeddinggemma', baseUrl: environment.ollama.baseUrl, externalData: false },
            vectorDb: { provider: 'qdrant', url: environment.qdrant.url, mode: 'managed', collectionPrefix: 'codex_workflow' },
        },
    });

    recommendations.push({
        profileId: 'multilingual-qdrant-qwen3-openai-compatible',
        title: 'Higher-quality multilingual/code candidate: Qdrant + Qwen3 embedding runtime',
        rank: 0,
        score: 66 + (multilingual ? 12 : 0) + (codeHeavy ? 8 : 0) + (environment.qdrant.reachable ? 5 : 0),
        vectorDb: 'qdrant',
        embeddingProvider: 'openai-compatible',
        embeddingModel: 'Qwen/Qwen3-Embedding-0.6B or larger',
        reranker: 'Qwen3-Reranker optional',
        privacy: 'local',
        cost: 'free-local',
        installEffort: 'high',
        externalData: false,
        currentDefault: false,
        requiredInstall: [...qdrantInstall, 'OpenAI-compatible local embedding server for Qwen3'],
        why: [
            'Useful when Korean/multilingual and code retrieval quality matter more than setup simplicity.',
            'Keeps an adapter boundary compatible with OpenAI-style embedding APIs.',
        ],
        risks: [
            'Higher setup cost than Ollama defaults.',
            'Qwen3 embedding models can require model-specific prompt/input formatting; validate on project samples before making it the only path.',
        ],
        citations: [citation(citations, 'Qwen3-Embedding'), citation(citations, 'MTEB leaderboard'), citation(citations, 'Qdrant embeddings'), localDetection, projectAnalysis],
        configPatch: {
            mode: 'own',
            preferred: 'local-first',
            fallback: 'local-hybrid',
            embedding: { provider: 'openai-compatible', model: 'Qwen/Qwen3-Embedding-0.6B', baseUrl: 'http://127.0.0.1:8080/v1', externalData: false },
            vectorDb: { provider: 'qdrant', url: environment.qdrant.url, mode: 'managed', collectionPrefix: 'codex_workflow' },
        },
    });

    recommendations.push({
        profileId: 'managed-quality-qdrant-openai',
        title: 'Operational quality: Qdrant + OpenAI text-embedding-3-large',
        rank: 0,
        score: 67 + (hasOpenAiKey ? 12 : 0) + (environment.qdrant.reachable ? 5 : 0),
        vectorDb: 'qdrant',
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-large',
        privacy: 'external',
        cost: 'usage-based',
        installEffort: hasOpenAiKey && (environment.qdrant.reachable || environment.docker.running) ? 'low' : 'medium',
        externalData: true,
        currentDefault: false,
        requiredInstall: [...qdrantInstall, ...(hasOpenAiKey ? [] : ['OPENAI_API_KEY'])],
        why: [
            'Best fit when API-based operational reliability and embedding quality matter more than local-only privacy.',
            'OpenAI embedding dimensions are documented and straightforward to integrate with vector databases.',
        ],
        risks: ['Documents/chunks are sent to an external embedding API and token usage is billed.'],
        citations: [citation(citations, 'OpenAI embeddings'), citation(citations, 'Qdrant embeddings'), localDetection, projectAnalysis],
        configPatch: {
            mode: 'own',
            preferred: 'local-first',
            fallback: 'local-hybrid',
            embedding: { provider: 'openai', model: 'text-embedding-3-large', dimensions: 3072, externalData: true },
            vectorDb: { provider: 'qdrant', url: environment.qdrant.url, mode: 'managed', collectionPrefix: 'codex_workflow' },
        },
    });

    if (codeHeavy || hasVoyageKey) {
        recommendations.push({
            profileId: 'code-search-qdrant-voyage-code',
            title: 'Code retrieval: Qdrant + Voyage code embeddings',
            rank: 0,
            score: 72 + (codeHeavy ? 12 : 0) + (hasVoyageKey ? 10 : 0),
            vectorDb: 'qdrant',
            embeddingProvider: 'voyage',
            embeddingModel: 'voyage-code-3',
            privacy: 'external',
            cost: 'usage-based',
            installEffort: hasVoyageKey ? 'low' : 'medium',
            externalData: true,
            currentDefault: false,
            requiredInstall: [...qdrantInstall, ...(hasVoyageKey ? [] : ['VOYAGE_API_KEY'])],
            why: [
                'The repository has a code-heavy profile, so code-specialized embeddings are worth considering.',
                'Voyage documents voyage-code-3 as optimized for code retrieval.',
            ],
            risks: ['Code and document chunks are sent to an external embedding API.'],
            citations: [citation(citations, 'Voyage embeddings'), citation(citations, 'Qdrant embeddings'), localDetection, projectAnalysis],
            configPatch: {
                mode: 'own',
                preferred: 'local-first',
                fallback: 'local-hybrid',
                embedding: { provider: 'voyage', model: 'voyage-code-3', dimensions: 1024, externalData: true },
                vectorDb: { provider: 'qdrant', url: environment.qdrant.url, mode: 'managed', collectionPrefix: 'codex_workflow' },
            },
        });
    }

    if (hasChroma || project.hasPython) {
        recommendations.push({
            profileId: 'python-chroma-bridge',
            title: 'Python/RAG-friendly: Chroma bridge or local Chroma',
            rank: 0,
            score: 62 + (hasChroma ? 18 : 0) + (project.hasPython ? 6 : 0),
            vectorDb: 'chroma',
            embeddingProvider: hasChroma ? 'existing' : 'ollama',
            embeddingModel: hasChroma ? 'existing project embedding function' : 'bge-m3',
            privacy: environment.apiKeys.length ? 'mixed' : 'local',
            cost: hasChroma ? 'existing' : 'free-local',
            installEffort: hasChroma ? 'low' : 'medium',
            externalData: environment.apiKeys.some(key => key === 'OPENAI_API_KEY' || key === 'VOYAGE_API_KEY'),
            currentDefault: false,
            requiredInstall: hasChroma ? [] : [...ollamaInstall, ...bgeM3Install, 'Chroma server or Python chromadb'],
            why: [
                hasChroma ? 'Chroma is already detected or reachable, so bridge/observe is lower risk than adding another vector DB.' : 'Python projects can use Chroma with local or API embedding functions.',
            ],
            risks: ['Chroma integration should preserve the existing project embedding function and collection ownership.'],
            citations: [citation(citations, 'Chroma embedding functions'), citation(citations, 'Ollama embeddings API'), localDetection, projectAnalysis],
            configPatch: {
                mode: hasChroma ? 'bridge' : 'own',
                preferred: hasChroma ? 'existing-first' : 'local-first',
                fallback: 'local-hybrid',
                embedding: hasChroma
                    ? { provider: 'existing', model: 'existing', externalData: environment.apiKeys.length > 0 }
                    : { provider: 'ollama', model: 'bge-m3', baseUrl: environment.ollama.baseUrl, externalData: false },
                vectorDb: { provider: 'chroma', url: environment.chroma.url, mode: hasChroma ? 'existing' : 'managed', collectionPrefix: 'codex_workflow' },
            },
        });
    }

    return recommendations.map(recommendation => finalizeRecommendation(recommendation, environment, project));
}

function finalizeRecommendation(
    recommendation: RagProviderRecommendation,
    environment: RagRecommendationEnvironment,
    project: RagRecommendationProjectProfile,
): RagProviderRecommendation {
    const blockingReasons: string[] = [];
    const nextActions: RagRecommendationNextAction[] = [{
        action: 'health',
        label: 'Health Check',
        requiresConfirm: false,
        enabled: true,
    }];

    addVectorReadiness(recommendation, environment, blockingReasons, nextActions);
    addEmbeddingReadiness(recommendation, environment, blockingReasons, nextActions);

    const baseScore = recommendation.score;
    const hardBlocked = blockingReasons.some(reason => /port .*occupied|port conflict|does not look like|only Ollama-compatible/i.test(reason));
    const readiness: RagRecommendationReadiness = blockingReasons.length === 0
        ? 'ready'
        : hardBlocked
            ? 'blocked'
            : 'install-required';
    const actionability: RagRecommendationActionability = readiness === 'ready'
        ? 'ready'
        : readiness === 'blocked'
            ? 'blocked'
            : blockingReasons.some(reason => /api[_\s-]*key/i.test(reason))
                ? 'needs-key'
                : blockingReasons.some(reason => /model/i.test(reason))
                    ? 'needs-model'
                    : blockingReasons.some(reason => /docker engine|service|container/i.test(reason))
                        ? 'needs-start'
                        : 'needs-install';
    const readinessAdjustment = readinessScoreAdjustment(readiness);
    const costAdjustment = costScoreAdjustment(recommendation);
    const potentialScore = baseScore + readinessScoreAdjustment('ready') + costAdjustment;
    const readinessAdjustedScore = baseScore + readinessAdjustment + costAdjustment;
    const finalized: RagProviderRecommendation = {
        ...recommendation,
        score: potentialScore,
        readinessAdjustedScore,
        readiness,
        actionability,
        blockingReasons: uniqueStrings(blockingReasons),
        nextActions: dedupeActions(nextActions),
    };
    return decorateRecommendationForUi(finalized, environment, project, baseScore, readinessAdjustment, costAdjustment);
}

function addVectorReadiness(
    recommendation: RagProviderRecommendation,
    environment: RagRecommendationEnvironment,
    blockingReasons: string[],
    nextActions: RagRecommendationNextAction[],
): void {
    const vectorDb = String(recommendation.vectorDb || '').toLowerCase();
    if (vectorDb.includes('local-hybrid') || vectorDb === 'existing') return;
    if (vectorDb.includes('qdrant')) {
        nextActions.push({ action: 'validate-vector-db', label: 'Validate Qdrant', requiresConfirm: false, enabled: true });
        if (environment.qdrant.reachable) return;
        if (environment.qdrant.portConflict) {
            const reason = environment.qdrant.conflictSummary || 'Qdrant port conflict: 6333 is occupied by a non-Qdrant service.';
            blockingReasons.push(reason);
            nextActions.push({ action: 'prepare-qdrant', label: 'Prepare Qdrant', requiresConfirm: false, enabled: true });
            nextActions.push({
                action: 'start-qdrant',
                label: 'Start Qdrant on alternate port',
                requiresConfirm: true,
                enabled: environment.docker.installed && (environment.docker.engineRunning || environment.docker.running),
                disabledReason: environment.docker.installed && (environment.docker.engineRunning || environment.docker.running) ? undefined : 'Docker Engine is not running.',
            });
            return;
        }
        if (!environment.docker.installed) {
            blockingReasons.push('Docker Engine or an external Qdrant URL is required before Qdrant can be used.');
            nextActions.push({ action: 'prepare-qdrant', label: 'Prepare Qdrant', requiresConfirm: false, enabled: true });
            nextActions.push({ action: 'install-docker-desktop', label: 'Install Docker Desktop', requiresConfirm: true, enabled: wingetInstalled(), disabledReason: wingetInstalled() ? undefined : 'winget is not available.' });
            nextActions.push({ action: 'start-qdrant', label: 'Start Qdrant', requiresConfirm: true, enabled: false, disabledReason: 'Docker is not installed.' });
            return;
        }
        if (!environment.docker.engineRunning && !environment.docker.running) {
            blockingReasons.push('Docker Engine is installed but not running; start Docker Desktop before Qdrant can be started.');
            nextActions.push({ action: 'prepare-qdrant', label: 'Prepare Qdrant', requiresConfirm: false, enabled: true });
            nextActions.push({ action: 'start-docker-engine', label: 'Start Docker Engine', requiresConfirm: true, enabled: !!environment.docker.desktopInstalled, disabledReason: environment.docker.desktopInstalled ? undefined : 'Docker Desktop is not installed.' });
            nextActions.push({ action: 'start-qdrant', label: 'Start Qdrant', requiresConfirm: true, enabled: false, disabledReason: 'Docker Engine is not running.' });
            return;
        }
        blockingReasons.push('Qdrant service is not reachable yet.');
        nextActions.push({ action: 'prepare-qdrant', label: 'Prepare Qdrant', requiresConfirm: false, enabled: true });
        nextActions.push({ action: 'start-qdrant', label: 'Start Qdrant', requiresConfirm: true, enabled: true });
    }
    if (vectorDb.includes('chroma')) {
        nextActions.push({ action: 'validate-vector-db', label: 'Validate Chroma', requiresConfirm: false, enabled: true });
        if (environment.chroma.reachable) return;
        if (environment.chroma.portConflict) {
            const reason = environment.chroma.conflictSummary || 'Chroma port conflict: 8000 is occupied by a non-Chroma service.';
            blockingReasons.push(reason);
            nextActions.push({ action: 'prepare-chroma', label: 'Use alternate port', requiresConfirm: false, enabled: true });
            nextActions.push({
                action: 'start-chroma',
                label: 'Start Chroma on alternate port',
                requiresConfirm: true,
                enabled: environment.docker.installed && (environment.docker.engineRunning || environment.docker.running),
                disabledReason: environment.docker.installed && (environment.docker.engineRunning || environment.docker.running) ? undefined : 'Docker Engine is not running.',
            });
            return;
        }
        if (!environment.docker.installed || (!environment.docker.engineRunning && !environment.docker.running)) {
            blockingReasons.push('Docker Engine must be running before a managed Chroma service can be started.');
            nextActions.push({ action: 'prepare-chroma', label: 'Prepare Chroma', requiresConfirm: false, enabled: true });
            if (!environment.docker.installed) {
                nextActions.push({ action: 'install-docker-desktop', label: 'Install Docker Desktop', requiresConfirm: true, enabled: wingetInstalled(), disabledReason: wingetInstalled() ? undefined : 'winget is not available.' });
            } else {
                nextActions.push({ action: 'start-docker-engine', label: 'Start Docker Engine', requiresConfirm: true, enabled: !!environment.docker.desktopInstalled, disabledReason: environment.docker.desktopInstalled ? undefined : 'Docker Desktop is not installed.' });
            }
            nextActions.push({ action: 'start-chroma', label: 'Start Chroma', requiresConfirm: true, enabled: false, disabledReason: 'Docker Engine is not running.' });
            return;
        }
        blockingReasons.push('Chroma service is not reachable yet.');
        nextActions.push({ action: 'prepare-chroma', label: 'Prepare Chroma', requiresConfirm: false, enabled: true });
        nextActions.push({ action: 'start-chroma', label: 'Start Chroma', requiresConfirm: true, enabled: true });
    }
}

function addEmbeddingReadiness(
    recommendation: RagProviderRecommendation,
    environment: RagRecommendationEnvironment,
    blockingReasons: string[],
    nextActions: RagRecommendationNextAction[],
): void {
    const provider = String(recommendation.embeddingProvider || '').toLowerCase();
    const model = String(recommendation.embeddingModel || '');
    if (!provider || provider === 'none' || provider === 'existing') return;
    if (provider === 'openai') {
        if (!environment.apiKeys.includes('OPENAI_API_KEY')) blockingReasons.push('OPENAI_API_KEY is required for this external embedding provider.');
        return;
    }
    if (provider === 'voyage') {
        if (!environment.apiKeys.includes('VOYAGE_API_KEY')) blockingReasons.push('VOYAGE_API_KEY is required for this external embedding provider.');
        return;
    }
    if (provider === 'openai-compatible') {
        const endpoint = (environment.embeddingEndpoints || []).find(item => item.kind === 'openai-compatible' && item.runtimeState.validated);
        if (!endpoint) {
            blockingReasons.push('OpenAI-compatible local embedding endpoint is not reachable or validated.');
            nextActions.push({ action: 'validate-embedding-endpoint', label: 'Validate Embedding Endpoint', requiresConfirm: false, enabled: true, model });
        }
        return;
    }
    if (provider === 'ollama') {
        const endpoint = (environment.embeddingEndpoints || []).find(item => item.kind === 'native-ollama' || item.kind === 'ollama-compatible');
        nextActions.push({ action: 'validate-embedding-endpoint', label: 'Validate Embedding Endpoint', requiresConfirm: false, enabled: !!endpoint, disabledReason: endpoint ? undefined : 'No Ollama-compatible endpoint is reachable.', model });
        if (!endpoint || !endpoint.runtimeState.reachable) {
            blockingReasons.push('Ollama or an Ollama-compatible embedding endpoint is not reachable.');
            nextActions.push({ action: 'install-native-ollama', label: 'Install native Ollama', requiresConfirm: true, enabled: !detectNativeOllamaExecutable() && wingetInstalled(), disabledReason: detectNativeOllamaExecutable() ? 'Native Ollama is already installed.' : wingetInstalled() ? undefined : 'winget is not available.' });
            nextActions.push({ action: 'start-native-ollama', label: 'Start native Ollama', requiresConfirm: true, enabled: !!detectNativeOllamaExecutable() || wingetInstalled(), disabledReason: detectNativeOllamaExecutable() || wingetInstalled() ? undefined : 'Native Ollama is not installed.' });
            return;
        }
        if (!endpoint.capabilities.canEmbed) {
            blockingReasons.push(endpoint.runtimeState.blockedReason || 'The configured Ollama-compatible endpoint did not validate an embedding request.');
        }
        const modelAvailable = hasOllamaModel(endpoint.models, model);
        if (!modelAvailable) {
            if (endpoint.capabilities.canPullModels) {
                blockingReasons.push(`Embedding model ${model} is not installed in native Ollama.`);
                nextActions.push({ action: 'pull-ollama-model', label: `Pull ${model}`, requiresConfirm: true, enabled: true, model });
            } else {
                blockingReasons.push(`Embedding model ${model} is not exposed by the configured Ollama-compatible endpoint.`);
                nextActions.push({ action: 'install-native-ollama', label: 'Install native Ollama', requiresConfirm: true, enabled: !detectNativeOllamaExecutable() && wingetInstalled(), disabledReason: detectNativeOllamaExecutable() ? 'Native Ollama is already installed.' : wingetInstalled() ? undefined : 'winget is not available.' });
                nextActions.push({ action: 'start-native-ollama', label: 'Start native Ollama', requiresConfirm: true, enabled: !!detectNativeOllamaExecutable() || wingetInstalled(), disabledReason: detectNativeOllamaExecutable() || wingetInstalled() ? undefined : 'Native Ollama is not installed.' });
                nextActions.push({ action: 'pull-ollama-model', label: `Pull ${model}`, requiresConfirm: true, enabled: false, disabledReason: 'Model pull requires native Ollama.', model });
            }
        }
    }
}

function readinessScoreAdjustment(readiness: RagRecommendationReadiness): number {
    if (readiness === 'ready') return 20;
    if (readiness === 'partial') return 5;
    if (readiness === 'install-required') return -35;
    return -55;
}

function costScoreAdjustment(recommendation: RagProviderRecommendation): number {
    if (recommendation.cost === 'usage-based') return -25;
    if (recommendation.cost === 'unknown') return -8;
    return 0;
}

function costSortPriority(recommendation: RagProviderRecommendation): number {
    if (recommendation.cost === 'free-local') return 0;
    if (recommendation.cost === 'existing') return 1;
    if (recommendation.cost === 'unknown') return 2;
    return 3;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function dedupeActions(actions: RagRecommendationNextAction[]): RagRecommendationNextAction[] {
    const seen = new Set<string>();
    const result: RagRecommendationNextAction[] = [];
    for (const action of actions) {
        const key = `${action.action}:${action.model || ''}:${action.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(action);
    }
    return result;
}

function decorateRecommendationForUi(
    recommendation: RagProviderRecommendation,
    environment: RagRecommendationEnvironment,
    project: RagRecommendationProjectProfile,
    baseScore: number,
    readinessAdjustment: number,
    costAdjustment: number,
): RagProviderRecommendation {
    const normalizedScore = clampRecommendationScore(recommendation.score);
    const readinessAdjustedScore = clampRecommendationScore(recommendation.readinessAdjustedScore ?? recommendation.score);
    const blockingReasonsKo = (recommendation.blockingReasons || []).map(reason => recommendationReasonKo(reason));
    return {
        ...recommendation,
        score: normalizedScore,
        readinessAdjustedScore,
        scoreLabel: scoreLabelForScore(normalizedScore),
        readinessAdjustedScoreLabel: scoreLabelForScore(readinessAdjustedScore),
        titleKo: recommendationTitleKo(recommendation),
        summaryKo: recommendationSummaryKo(recommendation),
        fitForThisComputerKo: computerFitKo(recommendation, environment),
        scoreExplanationKo: scoreExplanationKo(recommendation, project, baseScore, readinessAdjustment, costAdjustment),
        whyKo: recommendationWhyKo(recommendation, project),
        risksKo: recommendationRisksKo(recommendation),
        blockingReasonsKo,
        nextStepKo: nextStepKo(recommendation, blockingReasonsKo),
    };
}

function rankRecommendations(recommendations: RagProviderRecommendation[]): RagProviderRecommendation[] {
    return recommendations
        .map(recommendation => {
            const score = clampRecommendationScore(recommendation.score);
            const readinessAdjustedScore = clampRecommendationScore(recommendation.readinessAdjustedScore ?? recommendation.score);
            return {
                ...recommendation,
                score,
                readinessAdjustedScore,
                scoreLabel: scoreLabelForScore(score),
                readinessAdjustedScoreLabel: scoreLabelForScore(readinessAdjustedScore),
            };
        })
        .sort((a, b) => b.score - a.score || costSortPriority(a) - costSortPriority(b) || a.profileId.localeCompare(b.profileId))
        .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
}

function clampRecommendationScore(score: number): number {
    return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreLabelForScore(score: number): RagRecommendationScoreLabel {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'recommended';
    if (score >= 40) return 'conditional';
    if (score >= 20) return 'needs-prep';
    return 'low-priority';
}

function recommendationTitleKo(recommendation: RagProviderRecommendation): string {
    switch (recommendation.profileId) {
        case 'current-default-local-hybrid':
            return '현재 기본값: existing-first + local-hybrid fallback';
        case 'existing-rag-bridge':
            return '기존 RAG 우선 연결';
        case 'local-qdrant-ollama-bge-m3':
            return '로컬/프라이버시 우선: Qdrant + Ollama bge-m3';
        case 'local-qdrant-ollama-embeddinggemma':
            return '로컬 경량 후보: Qdrant + Ollama embeddinggemma';
        case 'multilingual-qdrant-qwen3-openai-compatible':
            return '한국어/코드 품질 우선: Qdrant + Qwen3 embedding';
        case 'managed-quality-qdrant-openai':
            return '운영 품질 우선: Qdrant + OpenAI embedding';
        case 'code-search-qdrant-voyage-code':
            return '코드 검색 우선: Qdrant + Voyage code embedding';
        case 'python-chroma-bridge':
            return 'Python/RAG 친화: Chroma 연결 또는 로컬 Chroma';
        default:
            return recommendation.title;
    }
}

function recommendationSummaryKo(recommendation: RagProviderRecommendation): string {
    const status = recommendation.readiness === 'ready'
        ? '지금 바로 사용할 수 있습니다.'
        : recommendation.readiness === 'blocked'
            ? '현재 PC 상태에서는 차단되어 있습니다.'
            : '설치나 설정을 마친 뒤 사용할 수 있습니다.';
    switch (recommendation.profileId) {
        case 'current-default-local-hybrid':
            return `${status} 벡터 DB나 embedding 모델 없이 동작하는 안전한 기본값이지만, semantic vector 검색 품질을 기대하는 후보는 아닙니다.`;
        case 'existing-rag-bridge':
            return `${status} 프로젝트에 이미 있는 RAG를 먼저 연결해 중복 인프라를 피하는 후보입니다.`;
        case 'local-qdrant-ollama-bge-m3':
            return `${status} 문서를 외부로 보내지 않고 한국어/다국어 문서 검색 품질을 올리는 로컬 후보입니다.`;
        case 'local-qdrant-ollama-embeddinggemma':
            return `${status} 로컬 실행을 유지하면서 더 가벼운 embedding 모델로 semantic 검색을 추가하는 후보입니다.`;
        case 'multilingual-qdrant-qwen3-openai-compatible':
            return `${status} 한국어/다국어와 코드 검색 품질을 더 중시할 때 검토할 고품질 로컬 후보입니다.`;
        case 'managed-quality-qdrant-openai':
            return `${status} 외부 API 비용과 데이터 전송을 허용할 때 운영 안정성과 embedding 품질을 우선하는 후보입니다.`;
        case 'code-search-qdrant-voyage-code':
            return `${status} 코드 비율이 높은 저장소에서 코드 검색 recall을 우선할 때 검토하는 외부 API 후보입니다.`;
        case 'python-chroma-bridge':
            return `${status} Python RAG 프로젝트나 기존 Chroma 사용 흔적이 있을 때 낮은 마찰로 연결하는 후보입니다.`;
        default:
            return status;
    }
}

function computerFitKo(recommendation: RagProviderRecommendation, environment: RagRecommendationEnvironment): string[] {
    const items: string[] = [];
    const vectorDb = String(recommendation.vectorDb || '').toLowerCase();
    const provider = String(recommendation.embeddingProvider || '').toLowerCase();
    const model = String(recommendation.embeddingModel || '');

    if (vectorDb.includes('local-hybrid')) {
        items.push('벡터 DB와 embedding 모델이 없어도 현재 로컬 fallback 검색으로 바로 동작합니다.');
    } else if (vectorDb.includes('qdrant')) {
        if (environment.qdrant.reachable) {
            items.push('Qdrant readiness 검증이 통과해 vector DB 연결은 바로 사용할 수 있습니다.');
        } else if (environment.qdrant.portConflict) {
            items.push(`Qdrant 기본 포트가 다른 서비스에 점유되어 있습니다. ${environment.qdrant.conflictSummary ? recommendationReasonKo(environment.qdrant.conflictSummary) : '6333 포트를 정리하거나 외부 Qdrant URL을 지정해야 합니다.'}`);
        } else if (environment.docker.installed && !(environment.docker.engineRunning || environment.docker.running)) {
            items.push('Docker는 설치되어 있지만 Engine이 꺼져 있어 Qdrant 컨테이너를 바로 시작할 수 없습니다.');
        } else if (!environment.docker.installed) {
            items.push('Qdrant를 로컬 managed 모드로 쓰려면 Docker Engine 또는 외부 Qdrant URL이 필요합니다.');
        } else {
            items.push('Qdrant 서비스가 아직 reachable 상태가 아니어서 시작 또는 검증이 필요합니다.');
        }
    } else if (vectorDb.includes('chroma')) {
        if (environment.chroma.reachable) {
            items.push('Chroma heartbeat 검증이 통과해 Chroma 연결은 사용할 수 있습니다.');
        } else if (environment.chroma.portConflict) {
            items.push(`Chroma 기본 포트 8000이 다른 서비스에 점유되어 있습니다. ${environment.chroma.conflictSummary ? recommendationReasonKo(environment.chroma.conflictSummary) : '대체 포트 또는 CHROMA_URL 설정이 필요합니다.'}`);
        } else if (environment.docker.installed && !(environment.docker.engineRunning || environment.docker.running)) {
            items.push('Docker는 설치되어 있지만 Engine이 꺼져 있어 managed Chroma를 바로 시작할 수 없습니다.');
        } else {
            items.push('Chroma 서버 또는 Python chromadb 연결 검증이 아직 필요합니다.');
        }
    } else if (vectorDb.includes('existing')) {
        items.push('프로젝트 안의 기존 RAG 신호를 우선 연결하므로 새 vector DB를 즉시 추가하지 않습니다.');
    }

    if (provider === 'none') {
        items.push('embedding provider가 없어 설치 없이 바로 쓸 수 있지만 의미 기반 검색 성능은 제한됩니다.');
    } else if (provider === 'ollama') {
        const endpoint = (environment.embeddingEndpoints || []).find(item => item.kind === 'native-ollama' || item.kind === 'ollama-compatible');
        if (!endpoint || !endpoint.runtimeState.reachable) {
            items.push('Ollama 또는 Ollama 호환 embedding endpoint가 아직 reachable 상태가 아닙니다.');
        } else if (endpoint.kind === 'ollama-compatible' && !endpoint.capabilities.canPullModels) {
            items.push(`${endpoint.baseUrl}에는 Ollama 호환 endpoint가 있지만 native Ollama가 아니므로 모델 pull 버튼은 숨깁니다.`);
        } else if (endpoint.kind === 'native-ollama') {
            items.push('native Ollama endpoint가 감지되어 모델 목록 확인과 pull 액션을 지원할 수 있습니다.');
        }
        if (endpoint && !endpoint.capabilities.canEmbed) {
            items.push('현재 embedding endpoint는 고정 검증 샘플을 처리하지 못해 semantic embedding 용도로 확정되지 않았습니다.');
        }
        if (endpoint && model && !hasOllamaModel(endpoint.models, model)) {
            items.push(`embedding 모델 ${model}이 현재 endpoint에 노출되어 있지 않습니다.`);
        }
    } else if (provider === 'openai-compatible') {
        const endpoint = (environment.embeddingEndpoints || []).find(item => item.kind === 'openai-compatible' && item.runtimeState.validated);
        items.push(endpoint
            ? 'OpenAI-compatible 로컬 embedding endpoint가 검증되어 adapter 연결 후보가 됩니다.'
            : 'OpenAI-compatible 로컬 embedding endpoint가 아직 검증되지 않았습니다.');
    } else if (provider === 'openai') {
        items.push(environment.apiKeys.includes('OPENAI_API_KEY')
            ? 'OPENAI_API_KEY가 감지되어 OpenAI embedding API 호출 준비가 되어 있습니다.'
            : 'OPENAI_API_KEY가 감지되지 않아 즉시 실행 후보가 아닙니다.');
    } else if (provider === 'voyage') {
        items.push(environment.apiKeys.includes('VOYAGE_API_KEY')
            ? 'VOYAGE_API_KEY가 감지되어 Voyage embedding API 호출 준비가 되어 있습니다.'
            : 'VOYAGE_API_KEY가 감지되지 않아 즉시 실행 후보가 아닙니다.');
    }

    items.push(recommendation.externalData
        ? '이 후보는 문서 chunk를 외부 embedding API로 전송하므로 비용과 프라이버시 검토가 필요합니다.'
        : '이 후보는 문서 chunk를 외부 API로 보내지 않는 로컬 중심 경로입니다.');
    return uniqueStrings(items);
}

function scoreExplanationKo(
    recommendation: RagProviderRecommendation,
    project: RagRecommendationProjectProfile,
    baseScore: number,
    readinessAdjustment: number,
    costAdjustment: number,
): string[] {
    const items = [
        `기본 조합 적합도 ${Math.round(baseScore)}/100에서 시작했습니다.`,
        `설치/검증 완료를 가정한 추천도는 ${clampRecommendationScore(recommendation.score)}/100입니다.`,
        `현재 PC 기준 실행 가능 점수는 준비 상태(${readinessKo(recommendation.readiness)}) 보정 ${signedNumber(readinessAdjustment)}점이 적용된 ${clampRecommendationScore(recommendation.readinessAdjustedScore ?? recommendation.score)}/100입니다.`,
    ];
    if (costAdjustment) {
        items.push(`비용 보정 ${signedNumber(costAdjustment)}점이 적용되었습니다. 사용량 과금 또는 비용 불확실성이 있는 후보는 무료/로컬 후보보다 후순위로 둡니다.`);
    }
    if (project.existingRagKinds.length) {
        items.push(`기존 RAG 신호(${project.existingRagKinds.join(', ')})가 감지되어 bridge 후보가 유리합니다.`);
    }
    if (project.codeFileRatio >= 0.35 || project.codeFileCount >= 100) {
        items.push(`저장소의 코드 비율이 ${percent(project.codeFileRatio)}이고 코드 파일이 ${project.codeFileCount}개라 코드 검색 후보에 가중치가 붙습니다.`);
    }
    if (project.koreanCharRatio >= 0.015) {
        items.push(`한국어/다국어 문서 신호가 있어 multilingual embedding 후보에 가중치가 붙습니다.`);
    }
    if ((recommendation.blockingReasons || []).length) {
        items.push(`차단 사유 ${(recommendation.blockingReasons || []).length}개 때문에 즉시 실행 가능 점수가 낮아졌습니다.`);
    }
    if (recommendation.externalData) {
        items.push('외부 API 후보라 비용과 데이터 전송 여부를 별도로 판단해야 합니다.');
    }
    return items;
}

function recommendationWhyKo(recommendation: RagProviderRecommendation, project: RagRecommendationProjectProfile): string[] {
    switch (recommendation.profileId) {
        case 'current-default-local-hybrid':
            return [
                '기존 설정을 바꾸지 않고 바로 동작하는 안전한 fallback입니다.',
                '벡터 DB나 embedding provider가 없어도 사용할 수 있어 현재 PC 예외 상태에서 즉시 사용 후보가 됩니다.',
            ];
        case 'existing-rag-bridge':
            return [
                '프로젝트에 이미 RAG 신호가 있으므로 먼저 연결/관찰하는 편이 중복 인프라보다 안전합니다.',
                `감지된 기존 RAG 종류: ${project.existingRagKinds.join(', ') || '상세 종류 미확정'}.`,
            ];
        case 'local-qdrant-ollama-bge-m3':
            return [
                '문서를 외부로 보내지 않으면서 semantic vector 검색을 추가할 수 있습니다.',
                '한국어/다국어 문서가 섞인 프로젝트에는 bge-m3 같은 다국어 embedding 후보가 적합합니다.',
            ];
        case 'local-qdrant-ollama-embeddinggemma':
            return [
                '로컬 실행을 유지하면서 비교적 가벼운 embedding 후보를 사용할 수 있습니다.',
                '강한 다국어/코드 검색보다 설치와 실행 부담을 낮추는 쪽에 맞습니다.',
            ];
        case 'multilingual-qdrant-qwen3-openai-compatible':
            return [
                '한국어/다국어와 코드 검색 품질을 더 중시할 때 상위 후보가 됩니다.',
                'OpenAI-compatible adapter 경계를 쓰면 로컬 embedding 서버를 교체하기 쉽습니다.',
            ];
        case 'managed-quality-qdrant-openai':
            return [
                '외부 API 사용을 허용하면 운영 안정성과 embedding 품질을 확보하기 쉽습니다.',
                'OpenAI embedding 모델은 dimension과 API 동작이 명확해 vector DB 연동이 단순합니다.',
            ];
        case 'code-search-qdrant-voyage-code':
            return [
                '이 저장소는 코드 비율이 높아 코드 특화 embedding 후보를 검토할 가치가 있습니다.',
                'Voyage code embedding은 코드 검색 품질을 우선할 때 쓰는 외부 API 후보입니다.',
            ];
        case 'python-chroma-bridge':
            return [
                'Python RAG 프로젝트나 Chroma 사용 흔적이 있을 때 기존 collection/embedding function을 보존하기 쉽습니다.',
            ];
        default:
            return recommendation.why;
    }
}

function recommendationRisksKo(recommendation: RagProviderRecommendation): string[] {
    switch (recommendation.profileId) {
        case 'current-default-local-hybrid':
            return ['keyword 중심 검색이라 semantic vector 검색만큼 recall이 좋지는 않습니다.'];
        case 'existing-rag-bridge':
            return ['기존 RAG의 health와 adapter 호환성이 확인되어야 안정적으로 연결할 수 있습니다.'];
        case 'local-qdrant-ollama-bge-m3':
            return [
                '로컬 모델 저장 공간과 embedding 처리 속도는 현재 PC 성능에 영향을 받습니다.',
                'Qdrant 서비스 시작은 설정 적용과 별도 단계입니다.',
                ...ollamaRiskKo(recommendation),
            ];
        case 'local-qdrant-ollama-embeddinggemma':
            return [
                '한국어/코드가 섞인 검색에서는 더 강한 다국어 또는 코드 특화 embedding보다 품질이 낮을 수 있습니다.',
                ...ollamaRiskKo(recommendation),
            ];
        case 'multilingual-qdrant-qwen3-openai-compatible':
            return [
                'Ollama 기본 후보보다 embedding 서버 준비 비용이 큽니다.',
                'Qwen3 embedding 계열은 모델별 입력 형식 검증이 필요하므로 프로젝트 샘플 평가 후 기본값으로 바꾸는 편이 안전합니다.',
            ];
        case 'managed-quality-qdrant-openai':
            return ['문서 chunk가 외부 embedding API로 전송되고 사용량 기반 비용이 발생합니다.'];
        case 'code-search-qdrant-voyage-code':
            return ['코드와 문서 chunk가 외부 embedding API로 전송됩니다.'];
        case 'python-chroma-bridge':
            return ['기존 Chroma collection과 embedding function 소유권을 보존하도록 bridge 범위를 명확히 해야 합니다.'];
        default:
            return recommendation.risks.map(reason => recommendationReasonKo(reason));
    }
}

function ollamaRiskKo(recommendation: RagProviderRecommendation): string[] {
    return recommendation.risks
        .filter(risk => /Ollama-compatible|model pull/i.test(risk))
        .map(risk => recommendationReasonKo(risk));
}

function recommendationReasonKo(reason: string): string {
    const text = String(reason || '');
    const embeddingMissing = text.match(/^Embedding model (.+) is not installed in native Ollama\.$/);
    if (embeddingMissing) return `embedding 모델 ${embeddingMissing[1]}이 native Ollama에 설치되어 있지 않습니다.`;
    const embeddingNotExposed = text.match(/^Embedding model (.+) is not exposed by the configured Ollama-compatible endpoint\.$/);
    if (embeddingNotExposed) return `embedding 모델 ${embeddingNotExposed[1]}이 현재 Ollama 호환 endpoint에 노출되어 있지 않습니다.`;
    if (/Docker Engine is installed but not running/i.test(text)) return 'Docker는 설치되어 있지만 Docker Engine이 실행 중이 아닙니다. Docker Desktop을 먼저 시작해야 합니다.';
    if (/Docker Engine or an external Qdrant URL is required/i.test(text)) return 'Qdrant를 사용하려면 Docker Engine 또는 외부 Qdrant URL이 필요합니다.';
    if (/Docker Engine must be running before a managed Chroma/i.test(text)) return 'managed Chroma를 시작하려면 Docker Engine이 실행 중이어야 합니다.';
    if (/Docker CLI is not installed/i.test(text)) return 'Docker CLI가 설치되어 있지 않습니다.';
    if (/Qdrant service is not reachable yet/i.test(text)) return 'Qdrant 서비스가 아직 연결 가능한 상태가 아닙니다.';
    if (/Chroma service is not reachable yet/i.test(text)) return 'Chroma 서비스가 아직 연결 가능한 상태가 아닙니다.';
    if (/OPENAI_API_KEY is required/i.test(text)) return 'OPENAI_API_KEY가 필요합니다. 현재 환경에서는 감지되지 않았습니다.';
    if (/VOYAGE_API_KEY is required/i.test(text)) return 'VOYAGE_API_KEY가 필요합니다. 현재 환경에서는 감지되지 않았습니다.';
    if (/OpenAI-compatible local embedding endpoint is not reachable or validated/i.test(text)) return 'OpenAI-compatible 로컬 embedding endpoint가 아직 연결/검증되지 않았습니다.';
    if (/Ollama or an Ollama-compatible embedding endpoint is not reachable/i.test(text)) return 'Ollama 또는 Ollama 호환 embedding endpoint가 연결되지 않았습니다.';
    if (/No Ollama embedding endpoint accepted the fixed validation sample/i.test(text)) return '현재 Ollama 계열 endpoint가 embedding 검증 샘플을 처리하지 못했습니다.';
    if (/configured Ollama-compatible endpoint did not validate an embedding request/i.test(text)) return '현재 Ollama 호환 endpoint가 embedding 요청 검증을 통과하지 못했습니다.';
    if (/configured 11434 endpoint is only Ollama-compatible/i.test(text)) return '11434 endpoint는 native Ollama가 아니라 Ollama 호환 서버입니다. 모델 pull은 native Ollama나 별도 embedding endpoint가 필요합니다.';
    if (/Model pull requires native Ollama/i.test(text)) return '모델 pull은 native Ollama에서만 가능합니다.';
    if (/Missing explicit confirmation/i.test(text)) return '서비스 시작 또는 모델 다운로드에는 별도 확인이 필요합니다.';
    if (/Port is occupied but .*\/api\/v2\/heartbeat did not validate/i.test(text)) return `Chroma 기본 포트가 다른 서비스에 점유되어 heartbeat 검증을 통과하지 못했습니다. ${extractRootTitle(text)}`;
    if (/Port 8000 is occupied by a non-Chroma HTTP service/i.test(text)) return '8000 포트가 Chroma가 아닌 HTTP 서비스에 의해 사용 중입니다.';
    if (/Qdrant port conflict|6333 is occupied/i.test(text)) return 'Qdrant 기본 포트 6333이 Qdrant가 아닌 서비스에 점유되어 있습니다.';
    if (/Chroma port conflict|8000 is occupied/i.test(text)) return 'Chroma 기본 포트 8000이 Chroma가 아닌 서비스에 점유되어 있습니다.';
    return text;
}

function extractRootTitle(text: string): string {
    const title = text.match(/Root HTTP 200 \(([^)]+)\)/);
    return title ? `현재 감지된 서비스: ${title[1]}.` : '';
}

function nextStepKo(recommendation: RagProviderRecommendation, blockingReasonsKo: string[]): string {
    if (recommendation.readiness === 'ready') {
        return recommendation.currentDefault
            ? '지금은 이 기본값으로 바로 사용할 수 있습니다. 더 높은 검색 품질이 필요하면 설치 후 후보를 준비한 뒤 다시 비교하세요.'
            : '상태 확인 후 설정 적용을 검토할 수 있습니다. 설정 적용은 설치나 다운로드를 자동으로 수행하지 않습니다.';
    }
    if (recommendation.actionability === 'needs-key') return '필요한 API 키를 환경 변수에 설정한 뒤 추천을 다시 갱신하세요.';
    if (recommendation.actionability === 'needs-model') return 'embedding 모델을 현재 endpoint에 노출하거나 native Ollama를 준비한 뒤 다시 검증하세요.';
    if (recommendation.actionability === 'needs-start') return 'Docker Desktop 또는 필요한 로컬 서비스를 먼저 시작한 뒤 준비 확인을 실행하세요.';
    if (recommendation.actionability === 'blocked') return `차단 사유를 먼저 해결해야 합니다: ${blockingReasonsKo[0] || '세부 사유를 확인하세요.'}`;
    return '필요 설치 항목을 준비한 뒤 추천을 다시 갱신하세요.';
}

function readinessKo(readiness?: RagRecommendationReadiness): string {
    if (readiness === 'ready') return '준비됨';
    if (readiness === 'partial') return '일부 준비';
    if (readiness === 'blocked') return '차단됨';
    if (readiness === 'install-required') return '설치 필요';
    return '알 수 없음';
}

function signedNumber(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function percent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function qdrantInstallNeeds(environment: RagRecommendationEnvironment): string[] {
    if (environment.qdrant.reachable) return [];
    if (environment.docker.engineRunning || environment.docker.running) return ['Start Qdrant service/container'];
    if (environment.docker.installed) return ['Start Docker Engine', 'Start Qdrant service/container'];
    return ['Docker Engine or external Qdrant URL', 'Qdrant service/container'];
}

function ollamaInstallNeeds(environment: RagRecommendationEnvironment): string[] {
    if (!environment.ollama.running) return ['Ollama or Ollama-compatible embedding endpoint'];
    if (environment.ollama.canPullModels) return [];
    return ['Native Ollama server or embedding-capable Ollama-compatible endpoint'];
}

function ollamaModelInstallNeeds(environment: RagRecommendationEnvironment, model: string, available: boolean): string[] {
    if (available) return [];
    if (environment.ollama.canPullModels) return [`ollama pull ${model}`];
    if (environment.ollama.running) return [`Expose embedding model ${model} in the configured embedding endpoint`];
    return [`Install or pull embedding model ${model}`];
}

function ollamaRecommendationEffort(
    environment: RagRecommendationEnvironment,
    qdrantInstall: string[],
    modelInstall: string[],
): 'low' | 'medium' | 'high' {
    if (!qdrantInstall.length && !modelInstall.length) return 'low';
    if (environment.ollama.running && !environment.ollama.canPullModels && modelInstall.length > 0) return 'high';
    return 'medium';
}

function ollamaEndpointRisk(environment: RagRecommendationEnvironment): string | null {
    if (!environment.ollama.running || environment.ollama.canPullModels !== false) return null;
    return 'The configured 11434 endpoint is only Ollama-compatible; model pull requires native Ollama or another embedding endpoint.';
}

function deriveExistingRagKinds(detection: KnowledgeDetectionResult): string[] {
    const kinds = new Set<string>();
    for (const source of detection.existingRag) {
        for (const dep of toStringArray(source.metadata?.dependencies)) addRagKind(kinds, dep);
        for (const service of toStringArray(source.metadata?.services)) addRagKind(kinds, service);
        if (typeof source.metadata?.directory === 'string') addRagKind(kinds, source.metadata.directory);
        if (source.path) addRagKind(kinds, source.path);
        if (source.detectedBy) kinds.add(source.detectedBy);
    }
    return Array.from(kinds).sort();
}

function addRagKind(kinds: Set<string>, value: string): void {
    const lower = value.toLowerCase();
    if (lower.includes('qdrant')) kinds.add('qdrant');
    else if (lower.includes('chroma')) kinds.add('chroma');
    else if (lower.includes('faiss')) kinds.add('faiss');
    else if (lower.includes('llamaindex')) kinds.add('llamaindex');
    else if (lower.includes('langchain')) kinds.add('langchain');
    else if (lower.includes('haystack')) kinds.add('haystack');
    else if (lower.includes('weaviate')) kinds.add('weaviate');
    else if (lower.includes('pinecone')) kinds.add('pinecone');
    else if (lower.includes('milvus')) kinds.add('milvus');
    else if (lower.includes('rag') || lower.includes('retriev') || lower.includes('embedding') || lower.includes('vector')) kinds.add('custom');
}

function detectApiKeyNames(cwd: string): string[] {
    const found = new Set<string>();
    for (const key of API_KEY_NAMES) {
        if (process.env[key]) found.add(key);
    }
    for (const file of ['.env', '.env.local', '.env.development']) {
        const abs = path.join(cwd, file);
        if (!fs.existsSync(abs)) continue;
        let text = '';
        try {
            text = readTextFile(abs).slice(0, 200000);
        } catch {
            continue;
        }
        for (const line of text.split(/\r?\n/)) {
            const key = line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1];
            if (key && API_KEY_NAMES.includes(key)) found.add(key);
        }
    }
    return Array.from(found).sort();
}

function hasOllamaModel(models: string[], name: string): boolean {
    return models.some(model => model === name || model.startsWith(`${name}:`));
}

function normalizeBaseUrl(value: string): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) return OLLAMA_DEFAULT_URL;
    if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '');
    return `http://${trimmed.replace(/\/+$/, '')}`;
}

function normalizeOptionalBaseUrl(value: string | undefined): string | undefined {
    const trimmed = String(value || '').trim();
    if (!trimmed) return undefined;
    if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '');
    return `http://${trimmed.replace(/\/+$/, '')}`;
}

async function detectPorts(values: string[]): Promise<RagRecommendationPortProbe[]> {
    const unique = Array.from(new Set(values.filter(Boolean).map(value => normalizeBaseUrl(value))));
    return Promise.all(unique.map(async value => {
        const url = new URL(value);
        const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
        const open = await portOpen(url.hostname, port, 900);
        const root = open ? await readHttpResult(`${url.protocol}//${url.hostname}:${port}`, 900).catch(() => null) : null;
        const processInfo = open ? detectPortProcess(url.hostname, port) : {};
        const title = root ? extractTitle(root.text) : undefined;
        return {
            host: url.hostname,
            port,
            url: `${url.protocol}//${url.hostname}:${port}`,
            open,
            protocol: url.protocol.replace(':', ''),
            title,
            summary: open ? `Port ${port} is open${title ? ` (${title})` : ''}.` : `Port ${port} is not open.`,
            ...processInfo,
        };
    }));
}

function detectPortProcess(host: string, port: number): { pid?: number; processName?: string } {
    if (process.platform !== 'win32') return {};
    const script = [
        `$c=Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;`,
        'if($c){',
        '$p=Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue;',
        '[pscustomobject]@{pid=$c.OwningProcess;processName=$p.ProcessName}|ConvertTo-Json -Compress',
        '}',
    ].join('');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf-8',
        timeout: 1500,
        windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout.trim()) return {};
    try {
        const parsed = JSON.parse(result.stdout);
        return {
            pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
            processName: typeof parsed.processName === 'string' ? parsed.processName : undefined,
        };
    } catch {
        return {};
    }
}

async function probeQdrant(baseUrl: string): Promise<RagRecommendationServiceProbe> {
    const endpoint = `${baseUrl.replace(/\/$/, '')}/readyz`;
    try {
        const response = await readHttp(endpoint, 1800);
        if (response.statusCode >= 200 && response.statusCode < 300) {
            return {
                reachable: true,
                url: baseUrl,
                validated: true,
                endpoint,
                message: response.text.trim() || 'Qdrant readiness endpoint returned HTTP 2xx.',
                actionability: 'ready',
                runtimeState: runtimeState(true, true, true, false),
            };
        }
        const conflict = await portConflictSummary(baseUrl, endpoint);
        const portConflict = conflict.portConflict || response.statusCode === 404;
        const conflictSummary = conflict.summary || (portConflict ? `Port is occupied but ${endpoint} returned HTTP ${response.statusCode}.` : undefined);
        return {
            reachable: false,
            url: baseUrl,
            validated: false,
            endpoint,
            message: `Qdrant readiness endpoint returned HTTP ${response.statusCode}.`,
            portConflict,
            conflictSummary,
            actionability: portConflict ? 'blocked' : 'needs-start',
            runtimeState: runtimeState(true, true, false, portConflict, conflictSummary),
        };
    } catch (e: any) {
        const open = await urlPortOpen(baseUrl);
        return {
            reachable: false,
            url: baseUrl,
            validated: false,
            endpoint,
            message: e?.message || 'Qdrant readiness endpoint is not reachable.',
            actionability: open ? 'blocked' : 'needs-start',
            runtimeState: runtimeState(false, open, false, false, e?.message || 'Qdrant readiness endpoint is not reachable.'),
        };
    }
}

async function probeChroma(baseUrl: string): Promise<RagRecommendationServiceProbe> {
    const endpoint = `${baseUrl.replace(/\/$/, '')}/api/v2/heartbeat`;
    try {
        const response = await readHttp(endpoint, 1800);
        if (response.statusCode < 200 || response.statusCode >= 300) {
            const conflict = await portConflictSummary(baseUrl, endpoint);
            const portConflict = conflict.portConflict || response.statusCode === 404;
            const conflictSummary = conflict.summary || (portConflict ? `Port is occupied but ${endpoint} returned HTTP ${response.statusCode}.` : undefined);
            return {
                reachable: false,
                url: baseUrl,
                validated: false,
                endpoint,
                message: `Chroma heartbeat endpoint returned HTTP ${response.statusCode}.`,
                portConflict,
                conflictSummary,
                actionability: portConflict ? 'blocked' : 'needs-start',
                runtimeState: runtimeState(true, true, false, portConflict, conflictSummary),
            };
        }
        const payload = parseJson(response.text);
        const heartbeat = typeof payload?.['nanosecond heartbeat'] === 'number'
            ? payload['nanosecond heartbeat']
            : typeof payload?.nanosecond_heartbeat === 'number'
                ? payload.nanosecond_heartbeat
                : undefined;
        if (typeof heartbeat === 'number' && heartbeat >= 0) {
            return {
                reachable: true,
                url: baseUrl,
                validated: true,
                endpoint,
                message: `Chroma heartbeat returned ${heartbeat}.`,
                actionability: 'ready',
                runtimeState: runtimeState(true, true, true, false),
            };
        }
        const conflict = await portConflictSummary(baseUrl, endpoint);
        const portConflict = conflict.portConflict || await urlPortOpen(baseUrl);
        const conflictSummary = conflict.summary || (portConflict ? `Port is occupied but ${endpoint} did not return a Chroma heartbeat payload.` : undefined);
        return {
            reachable: false,
            url: baseUrl,
            validated: false,
            endpoint,
            message: 'Chroma heartbeat endpoint responded but did not return the expected heartbeat payload.',
            portConflict,
            conflictSummary,
            actionability: portConflict ? 'blocked' : 'needs-start',
            runtimeState: runtimeState(true, true, false, portConflict, conflictSummary),
        };
    } catch (e: any) {
        const open = await urlPortOpen(baseUrl);
        return {
            reachable: false,
            url: baseUrl,
            validated: false,
            endpoint,
            message: e?.message || 'Chroma heartbeat endpoint is not reachable.',
            actionability: open ? 'blocked' : 'needs-start',
            runtimeState: runtimeState(false, open, false, false, e?.message || 'Chroma heartbeat endpoint is not reachable.'),
        };
    }
}

function runtimeState(installed: boolean, running: boolean, validated: boolean, portConflict: boolean, blockedReason?: string) {
    return {
        installed,
        running,
        reachable: running,
        validated,
        portConflict,
        blockedReason,
    };
}

async function portConflictSummary(baseUrl: string, expectedEndpoint: string): Promise<{ portConflict: boolean; summary?: string }> {
    const root = await readHttpResult(baseUrl.replace(/\/$/, '') || baseUrl, 1200).catch(() => null);
    if (!root || root.statusCode < 200 || root.statusCode >= 500) return { portConflict: false };
    const title = extractTitle(root.text);
    const summary = `Port is occupied but ${expectedEndpoint} did not validate. Root HTTP ${root.statusCode}${title ? ` (${title})` : ''}.`;
    return { portConflict: true, summary };
}

function urlPortOpen(value: string): Promise<boolean> {
    try {
        const url = new URL(value);
        const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
        return portOpen(url.hostname, port, 1200);
    } catch {
        return Promise.resolve(false);
    }
}

function portOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise(resolve => {
        const socket = net.createConnection({ host, port });
        let settled = false;
        const done = (ok: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });
}

function readJsonUrl<T>(value: string, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const url = new URL(value);
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, { method: 'GET', timeout: timeoutMs }, res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(Buffer.from(chunk)));
            res.on('end', () => {
                if ((res.statusCode || 0) >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.once('timeout', () => {
            req.destroy(new Error('request timed out'));
        });
        req.once('error', reject);
        req.end();
    });
}

async function readOptionalJsonUrl<T>(value: string, timeoutMs: number): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
    try {
        return { ok: true, value: await readJsonUrl<T>(value, timeoutMs) };
    } catch (e: any) {
        return { ok: false, message: e?.message || String(e) };
    }
}

async function probeOllamaEmbeddingEndpoint(baseUrl: string, model: string): Promise<{ ok: boolean; message: string }> {
    const normalized = baseUrl.replace(/\/$/, '');
    const sample = 'rag provider validation sample';
    const candidates = [
        { url: `${normalized}/api/embed`, payload: { model, input: sample } },
        { url: `${normalized}/api/embeddings`, payload: { model, prompt: sample } },
    ];
    for (const candidate of candidates) {
        try {
            const response = await postJson(candidate.url, candidate.payload, 2500);
            if (response.statusCode >= 200 && response.statusCode < 300) return { ok: true, message: `${candidate.url} accepted a fixed validation sample.` };
            if (response.statusCode !== 404) return { ok: false, message: `${candidate.url} returned HTTP ${response.statusCode}.` };
        } catch (e: any) {
            return { ok: false, message: e?.message || String(e) };
        }
    }
    return { ok: false, message: 'No Ollama embedding endpoint accepted the fixed validation sample.' };
}

async function refreshProviderCatalog(refreshWeb: boolean): Promise<RagProviderCatalog> {
    const checkedAt = new Date().toISOString();
    if (!refreshWeb) {
        return {
            refreshedAt: checkedAt,
            entries: PROVIDER_CATALOG_SEED.map(entry => ({ ...entry })),
            warnings: [],
        };
    }
    const warnings: string[] = [];
    const entries = await Promise.all(PROVIDER_CATALOG_SEED.map(async entry => {
        try {
            const response = await readHttp(entry.officialUrl, 3500);
            const ok = response.statusCode >= 200 && response.statusCode < 500;
            const retrievedTitle = extractTitle(response.text) || entry.title;
            return {
                ...entry,
                refreshedAt: checkedAt,
                reachable: ok,
                retrievedTitle,
                note: ok ? `${entry.note} Live page title: ${retrievedTitle}.` : `${entry.note} Live check returned HTTP ${response.statusCode}.`,
            };
        } catch (e: any) {
            warnings.push(`Provider catalog refresh failed for ${entry.id}: ${e?.message || e}`);
            return {
                ...entry,
                refreshedAt: checkedAt,
                reachable: false,
                note: `${entry.note} Live refresh failed.`,
            };
        }
    }));
    return { refreshedAt: checkedAt, entries, warnings };
}

function mergeCitationRefresh(citations: RagRecommendationCitation[], catalog: RagProviderCatalog): RagRecommendationCitation[] {
    const byUrl = new Map(catalog.entries.map(entry => [entry.officialUrl, entry]));
    const checkedAt = catalog.refreshedAt;
    return citations.map(citation => {
        if (!citation.url) return citation;
        const entry = byUrl.get(citation.url);
        return entry ? {
            ...citation,
            checkedAt,
            reachable: entry.reachable,
            retrievedTitle: entry.retrievedTitle,
            note: entry.note || citation.note,
        } : citation;
    });
}

function readHttp(value: string, timeoutMs: number): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; text: string }> {
    return readHttpResult(value, timeoutMs);
}

function readHttpResult(value: string, timeoutMs: number): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; text: string }> {
    return new Promise((resolve, reject) => {
        let url: URL;
        try {
            url = new URL(value);
        } catch {
            reject(new Error(`Invalid URL: ${value}`));
            return;
        }
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, { method: 'GET', timeout: timeoutMs }, res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(Buffer.from(chunk)));
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode || 0,
                    headers: res.headers,
                    text: Buffer.concat(chunks).toString('utf-8'),
                });
            });
        });
        req.once('timeout', () => {
            req.destroy(new Error('request timed out'));
        });
        req.once('error', reject);
        req.end();
    });
}

function parseJson(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function extractTitle(text: string): string | undefined {
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        || text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
        || text.match(/^#\s+(.+)$/m)?.[1];
    return title ? title.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) : undefined;
}

async function prepareQdrantService(cwd: string): Promise<RagRecommendationActionResult> {
    const environment = await detectRecommendationEnvironment(cwd);
    const blockingReasons: string[] = [];
    const suggestedActions: string[] = [];
    const alternate = await chooseQdrantManagedPorts(cwd);
    if (environment.qdrant.reachable) {
        return { ok: true, action: 'prepare-qdrant', status: 'noop', message: 'Qdrant is already reachable.', environment };
    }
    if (environment.qdrant.portConflict) {
        suggestedActions.push(environment.qdrant.conflictSummary || 'Qdrant port is occupied by a non-Qdrant service.');
        suggestedActions.push(alternate
            ? `Managed Qdrant can use alternate URL ${alternate.serviceUrl} with host ports ${alternate.httpPort}/${alternate.grpcPort}.`
            : 'No free alternate Qdrant port was found in 6335-6399. Free port 6333/6334 or configure an external Qdrant URL.');
        if (!alternate) blockingReasons.push('No free alternate Qdrant port was found.');
    }
    if (!environment.docker.installed) {
        blockingReasons.push('Docker CLI is not installed.');
        suggestedActions.push('Install Docker Desktop or configure an external Qdrant URL.');
    } else if (!environment.docker.engineRunning && !environment.docker.running) {
        blockingReasons.push('Docker Engine is not running.');
        suggestedActions.push('Start Docker Desktop, then rerun Start Qdrant.');
    } else {
        suggestedActions.push(alternate
            ? `Ready to run docker container ${QDRANT_CONTAINER_NAME} on ${alternate.serviceUrl}.`
            : `Ready to run docker container ${QDRANT_CONTAINER_NAME} on 127.0.0.1:6333/6334.`);
    }
    return {
        ok: blockingReasons.length === 0,
        action: 'prepare-qdrant',
        status: blockingReasons.length ? 'blocked' : 'ok',
        message: blockingReasons.length ? 'Qdrant is not ready to start automatically.' : 'Qdrant can be started with the managed Docker action. Port conflicts will use an alternate free port automatically.',
        blockingReasons,
        suggestedActions,
        serviceUrl: alternate?.serviceUrl,
        environment,
    };
}

async function prepareChromaService(cwd: string): Promise<RagRecommendationActionResult> {
    const environment = await detectRecommendationEnvironment(cwd);
    const blockingReasons: string[] = [];
    const suggestedActions: string[] = [];
    const alternate = await chooseChromaManagedPort(cwd);
    if (environment.chroma.reachable) {
        return { ok: true, action: 'prepare-chroma', status: 'noop', message: 'Chroma is already reachable.', environment };
    }
    if (environment.chroma.portConflict) {
        suggestedActions.push(environment.chroma.conflictSummary || 'Chroma default port 8000 is occupied by a non-Chroma service.');
        suggestedActions.push(alternate
            ? `Managed Chroma can use alternate URL ${alternate.serviceUrl}.`
            : 'No free alternate Chroma port was found in 8001-8099. Free port 8000 or configure CHROMA_URL to an existing Chroma service.');
        if (!alternate) blockingReasons.push('No free alternate Chroma port was found.');
    }
    if (!environment.docker.installed) {
        blockingReasons.push('Docker CLI is not installed.');
        suggestedActions.push('Install Docker Desktop or use Python chromadb/external Chroma.');
    } else if (!environment.docker.engineRunning && !environment.docker.running) {
        blockingReasons.push('Docker Engine is not running.');
        suggestedActions.push('Start Docker Desktop before starting a managed Chroma container.');
    } else {
        suggestedActions.push(alternate
            ? `Ready to run docker container ${CHROMA_CONTAINER_NAME} on ${alternate.serviceUrl}.`
            : `Ready to run docker container ${CHROMA_CONTAINER_NAME} on 127.0.0.1:8000.`);
    }
    return {
        ok: blockingReasons.length === 0,
        action: 'prepare-chroma',
        status: blockingReasons.length ? 'blocked' : 'ok',
        message: blockingReasons.length ? 'Chroma is not ready to start automatically.' : 'Chroma can be started with the managed Docker action. Port conflicts will use an alternate free port automatically.',
        blockingReasons,
        suggestedActions,
        serviceUrl: alternate?.serviceUrl,
        environment,
    };
}

async function validateEmbeddingEndpoint(cwd: string, options: any): Promise<RagRecommendationActionResult> {
    const environment = await detectRecommendationEnvironment(cwd);
    const model = String(options.model || options.embeddingModel || 'bge-m3');
    const endpoint = (environment.embeddingEndpoints || []).find(item => item.kind === 'native-ollama' || item.kind === 'ollama-compatible' || item.kind === 'openai-compatible');
    if (!endpoint || !endpoint.runtimeState.reachable) {
        return {
            ok: false,
            action: 'validate-embedding-endpoint',
            status: 'blocked',
            message: 'No local embedding endpoint is reachable.',
            blockingReasons: ['Start native Ollama, an Ollama-compatible embedding server, or an OpenAI-compatible local embedding server.'],
            suggestedActions: ['Configure OLLAMA_HOST or OPENAI_COMPATIBLE_BASE_URL if the endpoint uses a non-default URL.'],
            environment,
        };
    }
    if (endpoint.kind === 'openai-compatible') {
        const response = await postJson(`${endpoint.baseUrl.replace(/\/$/, '')}/embeddings`, { model, input: 'rag provider validation sample' }, 5000).catch((e: any) => ({ statusCode: 0, headers: {}, text: e?.message || String(e) }));
        const ok = response.statusCode >= 200 && response.statusCode < 300;
        return {
            ok,
            action: 'validate-embedding-endpoint',
            status: ok ? 'ok' : 'blocked',
            message: ok ? 'OpenAI-compatible embedding endpoint accepted the fixed validation sample.' : `OpenAI-compatible embedding validation failed with HTTP ${response.statusCode}.`,
            output: response.text.slice(0, 1000),
            blockingReasons: ok ? [] : ['The configured OpenAI-compatible endpoint did not accept the fixed validation sample.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const result = await probeOllamaEmbeddingEndpoint(endpoint.baseUrl, model);
    return {
        ok: result.ok,
        action: 'validate-embedding-endpoint',
        status: result.ok ? 'ok' : 'blocked',
        message: result.message,
        blockingReasons: result.ok ? [] : ['The configured Ollama-compatible endpoint did not validate an embedding request.'],
        environment: await detectRecommendationEnvironment(cwd),
    };
}

async function validateVectorDb(cwd: string, options: any): Promise<RagRecommendationActionResult> {
    const cached = readRagProviderRecommendations(cwd);
    const profile = cached?.recommendations.find(item => item.profileId === options.profileId);
    const provider = String(options.provider || profile?.vectorDb || '').toLowerCase();
    const environment = await detectRecommendationEnvironment(cwd);
    if (provider.includes('chroma')) {
        return {
            ok: environment.chroma.reachable,
            action: 'validate-vector-db',
            status: environment.chroma.reachable ? 'ok' : 'blocked',
            message: environment.chroma.message,
            blockingReasons: environment.chroma.reachable ? [] : [environment.chroma.conflictSummary || environment.chroma.message],
            environment,
        };
    }
    return {
        ok: environment.qdrant.reachable,
        action: 'validate-vector-db',
        status: environment.qdrant.reachable ? 'ok' : 'blocked',
        message: environment.qdrant.message,
        blockingReasons: environment.qdrant.reachable ? [] : [environment.qdrant.conflictSummary || environment.qdrant.message],
        environment,
    };
}

async function findOpenLocalPort(start: number, end: number): Promise<number | null> {
    for (let port = start; port <= end; port += 1) {
        if (!(await portOpen('127.0.0.1', port, 300))) return port;
    }
    return null;
}

async function findOpenLocalPortPair(start: number, end: number): Promise<{ httpPort: number; grpcPort: number } | null> {
    for (let port = start; port < end; port += 1) {
        const httpOpen = await portOpen('127.0.0.1', port, 300);
        const grpcOpen = await portOpen('127.0.0.1', port + 1, 300);
        if (!httpOpen && !grpcOpen) return { httpPort: port, grpcPort: port + 1 };
    }
    return null;
}

function localPortFromUrl(value: string, fallback: number): number {
    try {
        const url = new URL(value);
        const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
        return Number.isFinite(port) && port > 0 ? port : fallback;
    } catch {
        return fallback;
    }
}

function localUrlWithPort(value: string, port: number): string {
    try {
        const url = new URL(value);
        url.hostname = '127.0.0.1';
        url.port = String(port);
        url.pathname = '';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return `http://127.0.0.1:${port}`;
    }
}

async function chooseQdrantManagedPorts(cwd: string): Promise<{ httpPort: number; grpcPort: number; serviceUrl: string; usedAlternate: boolean } | null> {
    const config = readKnowledgeConfig(cwd);
    const configuredUrl = normalizeBaseUrl(process.env.QDRANT_URL || configuredVectorDbUrl(config, 'qdrant') || QDRANT_DEFAULT_URL);
    const preferredHttp = localPortFromUrl(configuredUrl, 6333);
    const preferredGrpc = preferredHttp === 6333 ? 6334 : preferredHttp + 1;
    const preferredFree = !(await portOpen('127.0.0.1', preferredHttp, 300)) && !(await portOpen('127.0.0.1', preferredGrpc, 300));
    if (preferredFree) return { httpPort: preferredHttp, grpcPort: preferredGrpc, serviceUrl: localUrlWithPort(configuredUrl, preferredHttp), usedAlternate: preferredHttp !== 6333 };
    const alternate = await findOpenLocalPortPair(Math.max(6335, preferredHttp + 2), 6399) || await findOpenLocalPortPair(6335, 6399);
    return alternate ? { ...alternate, serviceUrl: localUrlWithPort(QDRANT_DEFAULT_URL, alternate.httpPort), usedAlternate: true } : null;
}

async function chooseChromaManagedPort(cwd: string): Promise<{ port: number; serviceUrl: string; usedAlternate: boolean } | null> {
    const config = readKnowledgeConfig(cwd);
    const configuredUrl = normalizeBaseUrl(process.env.CHROMA_URL || configuredVectorDbUrl(config, 'chroma') || CHROMA_DEFAULT_URL);
    const preferred = localPortFromUrl(configuredUrl, 8000);
    if (!(await portOpen('127.0.0.1', preferred, 300))) return { port: preferred, serviceUrl: localUrlWithPort(configuredUrl, preferred), usedAlternate: preferred !== 8000 };
    const alternate = await findOpenLocalPort(Math.max(8001, preferred + 1), 8099) || await findOpenLocalPort(8001, 8099);
    return alternate ? { port: alternate, serviceUrl: localUrlWithPort(CHROMA_DEFAULT_URL, alternate), usedAlternate: true } : null;
}

function saveManagedVectorDbUrl(cwd: string, provider: 'qdrant' | 'chroma', serviceUrl: string): void {
    const current = readKnowledgeConfig(cwd);
    saveKnowledgeConfig(cwd, {
        ...current,
        vectorDb: {
            ...current.vectorDb,
            provider,
            mode: 'managed',
            url: serviceUrl,
            collectionPrefix: current.vectorDb.collectionPrefix || 'codex_workflow',
        },
        recommendation: {
            ...(current.recommendation || {}),
            appliedAt: current.recommendation?.appliedAt,
        },
    });
}

function saveOllamaEmbeddingBaseUrl(cwd: string, baseUrl: string): void {
    const current = readKnowledgeConfig(cwd);
    saveKnowledgeConfig(cwd, {
        ...current,
        embedding: {
            ...current.embedding,
            provider: 'ollama',
            baseUrl,
            externalData: false,
        },
        recommendation: {
            ...(current.recommendation || {}),
            appliedAt: current.recommendation?.appliedAt,
        },
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDockerEngine(timeoutMs: number): Promise<RagRecommendationEnvironment['docker']> {
    const deadline = Date.now() + timeoutMs;
    let state = detectDocker();
    while (!state.running && Date.now() < deadline) {
        await sleep(2500);
        state = detectDocker();
    }
    return state;
}

async function waitForNativeOllama(baseUrl: string, timeoutMs: number): Promise<RagRecommendationEnvironment['ollama']> {
    const deadline = Date.now() + timeoutMs;
    let state = await detectOllama(baseUrl);
    while (!(state.running && state.native && state.canPullModels) && Date.now() < deadline) {
        await sleep(1500);
        state = await detectOllama(baseUrl);
    }
    return state;
}

async function installDockerDesktop(cwd: string): Promise<RagRecommendationActionResult> {
    if (detectDockerDesktopInstalled()) {
        return { ok: true, action: 'install-docker-desktop', status: 'noop', message: 'Docker Desktop is already installed.', environment: await detectRecommendationEnvironment(cwd) };
    }
    if (!wingetInstalled()) {
        return {
            ok: false,
            action: 'install-docker-desktop',
            status: 'blocked',
            message: 'winget is not available, so Docker Desktop cannot be installed automatically.',
            blockingReasons: ['Install Docker Desktop manually or install winget/App Installer first.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const result = spawnSync('winget', ['install', '-e', '--id', 'Docker.DockerDesktop', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity', '--silent'], {
        cwd,
        encoding: 'utf-8',
        timeout: 30 * 60 * 1000,
        windowsHide: true,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    const installed = detectDockerDesktopInstalled();
    return {
        ok: result.status === 0 && installed,
        action: 'install-docker-desktop',
        status: result.status === 0 && installed ? 'ok' : 'blocked',
        command: 'winget install -e --id Docker.DockerDesktop',
        output: output.slice(0, 4000),
        message: result.status === 0 && installed ? 'Docker Desktop installation completed.' : 'Docker Desktop installation did not complete automatically.',
        blockingReasons: result.status === 0 && installed ? undefined : ['Docker Desktop may require manual installer approval, administrator permission, or a Windows restart.'],
        suggestedActions: result.status === 0 && installed ? ['Start Docker Engine.'] : ['Finish Docker Desktop installation manually, then rerun local preparation.'],
        environment: await detectRecommendationEnvironment(cwd),
    };
}

async function startDockerEngine(cwd: string): Promise<RagRecommendationActionResult> {
    const current = detectDocker();
    if (current.running) {
        return { ok: true, action: 'start-docker-engine', status: 'noop', message: 'Docker Engine is already running.', environment: await detectRecommendationEnvironment(cwd) };
    }
    if (!detectDockerDesktopInstalled()) {
        return {
            ok: false,
            action: 'start-docker-engine',
            status: 'blocked',
            message: 'Docker Desktop is not installed, so Docker Engine cannot be started automatically.',
            blockingReasons: ['Docker Desktop is required for the managed local vector DB action.'],
            suggestedActions: wingetInstalled() ? ['Run Install Docker Desktop, then retry.'] : ['Install Docker Desktop manually, then retry.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    try {
        const child = spawn(DOCKER_DESKTOP_EXE, [], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        child.unref();
    } catch (e: any) {
        return {
            ok: false,
            action: 'start-docker-engine',
            status: 'failed',
            message: `Failed to launch Docker Desktop: ${e?.message || e}`,
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const docker = await waitForDockerEngine(150000);
    return {
        ok: !!docker.running,
        action: 'start-docker-engine',
        status: docker.running ? 'ok' : 'blocked',
        command: DOCKER_DESKTOP_EXE,
        message: docker.running ? 'Docker Engine is running.' : 'Docker Desktop was launched, but Docker Engine did not become ready before timeout.',
        blockingReasons: docker.running ? undefined : [docker.message],
        suggestedActions: docker.running ? ['Continue with vector DB startup.'] : ['Wait for Docker Desktop to finish starting, then rerun local preparation.'],
        environment: await detectRecommendationEnvironment(cwd),
    };
}

async function installNativeOllama(cwd: string): Promise<RagRecommendationActionResult> {
    const existing = detectNativeOllamaExecutable();
    if (existing) {
        return { ok: true, action: 'install-native-ollama', status: 'noop', message: `Native Ollama is already installed at ${existing}.`, environment: await detectRecommendationEnvironment(cwd) };
    }
    if (!wingetInstalled()) {
        return {
            ok: false,
            action: 'install-native-ollama',
            status: 'blocked',
            message: 'winget is not available, so native Ollama cannot be installed automatically.',
            blockingReasons: ['Install Ollama manually or install winget/App Installer first.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const result = spawnSync('winget', ['install', '-e', '--id', 'Ollama.Ollama', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity', '--silent'], {
        cwd,
        encoding: 'utf-8',
        timeout: 30 * 60 * 1000,
        windowsHide: true,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    const installed = detectNativeOllamaExecutable();
    return {
        ok: result.status === 0 && !!installed,
        action: 'install-native-ollama',
        status: result.status === 0 && installed ? 'ok' : 'blocked',
        command: 'winget install -e --id Ollama.Ollama',
        output: output.slice(0, 4000),
        message: result.status === 0 && installed ? `Native Ollama installation completed at ${installed}.` : 'Native Ollama installation did not complete automatically.',
        blockingReasons: result.status === 0 && installed ? undefined : ['Ollama may require manual installer approval or a new shell PATH refresh.'],
        suggestedActions: result.status === 0 && installed ? ['Start native Ollama.'] : ['Finish Ollama installation manually, then rerun local preparation.'],
        environment: await detectRecommendationEnvironment(cwd),
    };
}

async function startNativeOllama(cwd: string): Promise<RagRecommendationActionResult> {
    const config = readKnowledgeConfig(cwd);
    const configured = normalizeBaseUrl(process.env.OLLAMA_HOST || process.env.HARAM_AI_OLLAMA_URL || configuredEmbeddingBaseUrl(config, 'ollama') || OLLAMA_DEFAULT_URL);
    const current = await detectOllama(configured);
    if (current.running && current.native && current.canPullModels) {
        saveOllamaEmbeddingBaseUrl(cwd, configured);
        return { ok: true, action: 'start-native-ollama', status: 'noop', message: `Native Ollama is already running at ${configured}.`, serviceUrl: configured, configUpdated: true, environment: await detectRecommendationEnvironment(cwd) };
    }
    let executable = detectNativeOllamaExecutable();
    if (!executable && wingetInstalled()) {
        const install = await installNativeOllama(cwd);
        if (!install.ok) return { ...install, action: 'start-native-ollama' };
        executable = detectNativeOllamaExecutable();
    }
    if (!executable) {
        return {
            ok: false,
            action: 'start-native-ollama',
            status: 'blocked',
            message: 'Native Ollama executable was not found.',
            blockingReasons: ['Install native Ollama before model pull can run.'],
            suggestedActions: wingetInstalled() ? ['Run Install native Ollama, then retry.'] : ['Install Ollama manually, then retry.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const preferredPort = localPortFromUrl(configured, 11434);
    const preferredOpen = await portOpen('127.0.0.1', preferredPort, 300);
    const servicePort = preferredOpen && !(current.running && current.native)
        ? await findOpenLocalPort(Math.max(11435, preferredPort + 1), 11499) || await findOpenLocalPort(11435, 11499)
        : preferredPort;
    if (!servicePort) {
        return {
            ok: false,
            action: 'start-native-ollama',
            status: 'blocked',
            message: 'No free port was found for native Ollama.',
            blockingReasons: ['Default Ollama port is occupied and no free alternate port was found in 11435-11499.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const serviceUrl = localUrlWithPort(OLLAMA_DEFAULT_URL, servicePort);
    try {
        const child = spawn(executable, ['serve'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: {
                ...process.env,
                OLLAMA_HOST: `127.0.0.1:${servicePort}`,
            },
        });
        child.unref();
    } catch (e: any) {
        return {
            ok: false,
            action: 'start-native-ollama',
            status: 'failed',
            message: `Failed to start native Ollama: ${e?.message || e}`,
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const ollama = await waitForNativeOllama(serviceUrl, 45000);
    if (ollama.running && ollama.native && ollama.canPullModels) {
        saveOllamaEmbeddingBaseUrl(cwd, serviceUrl);
    }
    return {
        ok: !!(ollama.running && ollama.native && ollama.canPullModels),
        action: 'start-native-ollama',
        status: ollama.running && ollama.native && ollama.canPullModels ? 'ok' : 'blocked',
        command: `${executable} serve`,
        serviceUrl,
        configUpdated: !!(ollama.running && ollama.native && ollama.canPullModels),
        message: ollama.running && ollama.native && ollama.canPullModels
            ? `Native Ollama is running at ${serviceUrl}.`
            : `Native Ollama did not become ready at ${serviceUrl} before timeout.`,
        blockingReasons: ollama.running && ollama.native && ollama.canPullModels ? undefined : [ollama.message],
        suggestedActions: ollama.running && ollama.native && ollama.canPullModels ? ['Continue with model pull.'] : ['Check Ollama startup logs or free the Ollama port, then retry.'],
        environment: await detectRecommendationEnvironment(cwd),
    };
}

async function startQdrantService(cwd: string): Promise<RagRecommendationActionResult> {
    if (process.env.QDRANT_URL) {
        const explicit = await probeQdrant(normalizeBaseUrl(process.env.QDRANT_URL));
        if (explicit.portConflict) {
            return {
                ok: false,
                action: 'start-qdrant',
                status: 'blocked',
                message: `QDRANT_URL is explicitly set to ${explicit.url}, but that port does not validate as Qdrant.`,
                blockingReasons: [explicit.conflictSummary || explicit.message],
                suggestedActions: ['Change QDRANT_URL to a reachable Qdrant endpoint or remove it so the managed action can choose an alternate port.'],
                environment: await detectRecommendationEnvironment(cwd),
            };
        }
    }
    const currentUrl = normalizeBaseUrl(configuredVectorDbUrl(readKnowledgeConfig(cwd), 'qdrant') || QDRANT_DEFAULT_URL);
    const current = await probeQdrant(currentUrl);
    if (current.reachable) {
        return {
            ok: true,
            action: 'start-qdrant',
            status: 'noop',
            message: `Qdrant is already reachable at ${currentUrl}.`,
            serviceUrl: currentUrl,
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const docker = detectDocker();
    if (!docker.running) {
        return {
            ok: false,
            action: 'start-qdrant',
            status: 'blocked',
            message: `Docker Engine is not running. ${docker.message}`,
            blockingReasons: ['Docker Engine is not running.'],
            suggestedActions: ['Start Docker Desktop, then rerun Start Qdrant.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const ports = await chooseQdrantManagedPorts(cwd);
    if (!ports) {
        return {
            ok: false,
            action: 'start-qdrant',
            status: 'blocked',
            message: 'No free local Qdrant port pair was found.',
            blockingReasons: ['Ports 6333/6334 are unavailable and no free pair was found in 6335-6399.'],
            suggestedActions: ['Free Qdrant ports or configure QDRANT_URL to an external service.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const existing = spawnDocker(['ps', '-a', '--filter', `name=^/${QDRANT_CONTAINER_NAME}$`, '--format', '{{.Names}}'], cwd);
    if (!existing.ok) return { ok: false, action: 'start-qdrant', status: 'failed', message: existing.message, output: existing.output };
    const command = String(existing.output || '').trim() === QDRANT_CONTAINER_NAME
        ? ['start', QDRANT_CONTAINER_NAME]
        : ['run', '-d', '--name', QDRANT_CONTAINER_NAME, '-p', `127.0.0.1:${ports.httpPort}:6333`, '-p', `127.0.0.1:${ports.grpcPort}:6334`, '-v', `${QDRANT_VOLUME_NAME}:/qdrant/storage`, 'qdrant/qdrant:latest'];
    const result = spawnDocker(command, cwd);
    if (result.ok) saveManagedVectorDbUrl(cwd, 'qdrant', ports.serviceUrl);
    const environment = await detectRecommendationEnvironment(cwd);
    return {
        ok: result.ok && environment.qdrant.reachable,
        action: 'start-qdrant',
        status: result.ok && environment.qdrant.reachable ? 'ok' : result.ok ? 'blocked' : 'failed',
        command: `docker ${command.join(' ')}`,
        output: result.output,
        serviceUrl: ports.serviceUrl,
        configUpdated: result.ok,
        environment,
        message: result.ok
            ? environment.qdrant.reachable ? `Qdrant service is running at ${ports.serviceUrl} and readiness probe passed.` : `Docker command completed and workflow-knowledge vectorDb.url was set to ${ports.serviceUrl}, but Qdrant readiness probe did not pass yet.`
            : result.message,
        blockingReasons: result.ok && !environment.qdrant.reachable ? [environment.qdrant.message] : undefined,
    };
}

async function startChromaService(cwd: string): Promise<RagRecommendationActionResult> {
    if (process.env.CHROMA_URL) {
        const explicit = await probeChroma(normalizeBaseUrl(process.env.CHROMA_URL));
        if (explicit.portConflict) {
            return {
                ok: false,
                action: 'start-chroma',
                status: 'blocked',
                message: `CHROMA_URL is explicitly set to ${explicit.url}, but that port does not validate as Chroma.`,
                blockingReasons: [explicit.conflictSummary || explicit.message],
                suggestedActions: ['Change CHROMA_URL to a reachable Chroma endpoint or remove it so the managed action can choose an alternate port.'],
                environment: await detectRecommendationEnvironment(cwd),
            };
        }
    }
    const currentUrl = normalizeBaseUrl(configuredVectorDbUrl(readKnowledgeConfig(cwd), 'chroma') || CHROMA_DEFAULT_URL);
    const current = await probeChroma(currentUrl);
    if (current.reachable) {
        return { ok: true, action: 'start-chroma', status: 'noop', message: 'Chroma is already reachable.', environment: await detectRecommendationEnvironment(cwd) };
    }
    const docker = detectDocker();
    if (!docker.running) {
        return {
            ok: false,
            action: 'start-chroma',
            status: 'blocked',
            message: `Docker Engine is not running. ${docker.message}`,
            blockingReasons: ['Docker Engine is not running.'],
            suggestedActions: ['Start Docker Desktop, then rerun Start Chroma.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const portPlan = await chooseChromaManagedPort(cwd);
    if (!portPlan) {
        return {
            ok: false,
            action: 'start-chroma',
            status: 'blocked',
            message: 'No free local Chroma port was found.',
            blockingReasons: ['Port 8000 is unavailable and no free port was found in 8001-8099.'],
            suggestedActions: ['Free Chroma ports or configure CHROMA_URL to an external service.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const existing = spawnDocker(['ps', '-a', '--filter', `name=^/${CHROMA_CONTAINER_NAME}$`, '--format', '{{.Names}}'], cwd);
    if (!existing.ok) return { ok: false, action: 'start-chroma', status: 'failed', message: existing.message, output: existing.output };
    const command = String(existing.output || '').trim() === CHROMA_CONTAINER_NAME
        ? ['start', CHROMA_CONTAINER_NAME]
        : ['run', '-d', '--name', CHROMA_CONTAINER_NAME, '-p', `127.0.0.1:${portPlan.port}:8000`, '-v', `${CHROMA_VOLUME_NAME}:/data`, 'chromadb/chroma:latest'];
    const result = spawnDocker(command, cwd);
    if (result.ok) saveManagedVectorDbUrl(cwd, 'chroma', portPlan.serviceUrl);
    const environment = await detectRecommendationEnvironment(cwd);
    return {
        ok: result.ok && environment.chroma.reachable,
        action: 'start-chroma',
        status: result.ok && environment.chroma.reachable ? 'ok' : result.ok ? 'blocked' : 'failed',
        command: `docker ${command.join(' ')}`,
        output: result.output,
        serviceUrl: portPlan.serviceUrl,
        configUpdated: result.ok,
        environment,
        message: result.ok
            ? environment.chroma.reachable ? `Chroma service is running at ${portPlan.serviceUrl} and heartbeat probe passed.` : `Docker command completed and workflow-knowledge vectorDb.url was set to ${portPlan.serviceUrl}, but Chroma heartbeat probe did not pass yet.`
            : result.message,
        blockingReasons: result.ok && !environment.chroma.reachable ? [environment.chroma.message] : undefined,
    };
}

async function pullOllamaModel(cwd: string, model: string, baseUrl: string): Promise<RagRecommendationActionResult> {
    if (!/^[A-Za-z0-9._/:@-]+$/.test(model)) {
        return { ok: false, action: 'pull-ollama-model', status: 'failed', message: 'Invalid Ollama model name.' };
    }
    const ollama = await detectOllama(baseUrl);
    if (!ollama.running) {
        return {
            ok: false,
            action: 'pull-ollama-model',
            status: 'blocked',
            message: `Ollama is not reachable at ${baseUrl}. ${ollama.message}`,
            blockingReasons: ['Native Ollama is not reachable.'],
            suggestedActions: ['Start native Ollama or configure OLLAMA_HOST.'],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    if (!ollama.canPullModels) {
        return {
            ok: false,
            action: 'pull-ollama-model',
            status: 'blocked',
            message: `Model pull is not available at ${baseUrl}. ${ollama.message}`,
            blockingReasons: ['Model pull requires native Ollama; the current endpoint is only Ollama-compatible.'],
            suggestedActions: [`Expose embedding model ${model} in the current endpoint or install native Ollama.`],
            environment: await detectRecommendationEnvironment(cwd),
        };
    }
    const response = await postJson(`${baseUrl.replace(/\/$/, '')}/api/pull`, { model, stream: false }, 30 * 60 * 1000);
    const environment = await detectRecommendationEnvironment(cwd);
    return {
        ok: response.statusCode >= 200 && response.statusCode < 300,
        action: 'pull-ollama-model',
        status: response.statusCode >= 200 && response.statusCode < 300 ? 'ok' : 'failed',
        command: `POST ${baseUrl.replace(/\/$/, '')}/api/pull ${model}`,
        output: response.text.slice(0, 2000),
        environment,
        message: response.statusCode >= 200 && response.statusCode < 300 ? `Ollama model pull completed or is already satisfied: ${model}` : `Ollama pull failed with HTTP ${response.statusCode}.`,
    };
}

function postJson(value: string, payload: unknown, timeoutMs: number): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; text: string }> {
    return new Promise((resolve, reject) => {
        const url = new URL(value);
        const body = JSON.stringify(payload);
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, {
            method: 'POST',
            timeout: timeoutMs,
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
            },
        }, res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(Buffer.from(chunk)));
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode || 0,
                    headers: res.headers,
                    text: Buffer.concat(chunks).toString('utf-8'),
                });
            });
        });
        req.once('timeout', () => req.destroy(new Error('request timed out')));
        req.once('error', reject);
        req.write(body);
        req.end();
    });
}

function spawnDocker(args: string[], cwd: string): { ok: boolean; message: string; output: string } {
    const result = spawnSync('docker', args, {
        cwd,
        encoding: 'utf-8',
        timeout: 5 * 60 * 1000,
        windowsHide: true,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    if (result.error) return { ok: false, message: result.error.message, output };
    return { ok: result.status === 0, message: result.status === 0 ? 'docker command completed.' : `docker exited with ${result.status}`, output };
}

function citation(citations: Map<string, RagRecommendationCitation>, title: string): RagRecommendationCitation {
    return citations.get(title) || BASIS.localDetection;
}

function uniqueCitations(citations: RagRecommendationCitation[]): RagRecommendationCitation[] {
    const seen = new Set<string>();
    const unique: RagRecommendationCitation[] = [];
    for (const citation of citations) {
        const key = citation.url || citation.title;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(citation);
    }
    return unique;
}

function toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(item => String(item || '')).filter(Boolean) : [];
}
