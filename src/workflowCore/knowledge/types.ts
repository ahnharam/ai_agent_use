export type KnowledgeSourceType =
    | 'repo-docs'
    | 'llms-txt'
    | 'obsidian-vault'
    | 'second-brain'
    | 'existing-rag'
    | 'generated-vault'
    | 'project-capability';

export type KnowledgeTrustLevel = 'high' | 'medium' | 'low' | 'unknown';
export type KnowledgeMode = 'auto' | 'observe' | 'bridge' | 'mirror' | 'own' | 'off';
export type KnowledgeFallback = 'local-hybrid' | 'off';
export type KnowledgeIntegrationStrategy = 'existing-first' | 'absorb-copy-own-index';
export type KnowledgeSourceOwnership = 'project' | 'workflow' | 'external';
export type KnowledgeDerivedOwnership = 'workflow' | 'project' | 'external';
export type KnowledgeExistingRagRole = 'baseline-and-fallback' | 'fallback-only' | 'baseline-only' | 'off';
export type KnowledgeActivationMode = 'eval-gated' | 'manual' | 'off';
export type KnowledgeIntegrationStageStatus =
    | 'not-started'
    | 'running'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'stale'
    | 'active'
    | 'blocked';
export type RagAdapterKind = 'local' | 'custom' | 'qdrant' | 'chroma' | 'faiss' | 'llamaindex' | 'langchain' | 'unknown';
export type KnowledgeEmbeddingProvider = 'none' | 'existing' | 'ollama' | 'openai-compatible' | 'openai' | 'voyage';
export type KnowledgeVectorDbProvider = 'local-hybrid' | 'existing' | 'qdrant' | 'chroma' | 'custom';
export type RagRecommendationPrivacy = 'local' | 'external' | 'mixed' | 'unknown';
export type RagRecommendationCost = 'free-local' | 'usage-based' | 'existing' | 'unknown';
export type RagRecommendationInstallEffort = 'none' | 'low' | 'medium' | 'high';
export type RagEmbeddingEndpointKind = 'native-ollama' | 'ollama-compatible' | 'openai-compatible' | 'none';
export type RagRecommendationActionability = 'ready' | 'needs-start' | 'needs-install' | 'needs-model' | 'needs-key' | 'blocked';
export type RagRecommendationReadiness = 'ready' | 'partial' | 'blocked' | 'install-required';
export type RagRecommendationActionStatus = 'ok' | 'failed' | 'blocked' | 'noop';

export interface KnowledgeEmbeddingConfig {
    provider: KnowledgeEmbeddingProvider;
    model: string;
    baseUrl?: string;
    dimensions?: number;
    externalData?: boolean;
}

export interface KnowledgeVectorDbConfig {
    provider: KnowledgeVectorDbProvider;
    url?: string;
    collectionPrefix?: string;
    mode?: 'existing' | 'managed' | 'external' | 'local';
}

export interface KnowledgeRecommendationConfig {
    appliedProfileId?: string;
    appliedAt?: string;
    lastRecommendedAt?: string;
}

export interface KnowledgeIntegrationConfig {
    strategy: KnowledgeIntegrationStrategy;
    sourceOwnership: KnowledgeSourceOwnership;
    derivedOwnership: KnowledgeDerivedOwnership;
    existingRagRole: KnowledgeExistingRagRole;
    activationMode: KnowledgeActivationMode;
    activatedSurfaces?: string[];
    lastActivatedAt?: string;
    lastEvaluatedAt?: string;
}

export interface KnowledgeSource {
    id: string;
    type: KnowledgeSourceType;
    enabled: boolean;
    trustLevel: KnowledgeTrustLevel;
    owner?: string;
    path?: string;
    url?: string;
    include?: string[];
    exclude?: string[];
    status?: 'available' | 'missing' | 'unhealthy';
    detectedBy?: string;
    metadata?: Record<string, unknown>;
}

export interface WorkflowKnowledgeConfig {
    version: 1;
    mode: KnowledgeMode;
    preferred: 'existing-first' | 'local-first';
    fallback: KnowledgeFallback;
    citationRequired: boolean;
    writeGeneratedVault: boolean;
    generatedVaultDir: string;
    include: string[];
    exclude: string[];
    sources: KnowledgeSource[];
    embedding: KnowledgeEmbeddingConfig;
    vectorDb: KnowledgeVectorDbConfig;
    recommendation?: KnowledgeRecommendationConfig;
    integration?: KnowledgeIntegrationConfig;
}

export interface KnowledgeDocument {
    sourceId: string;
    sourceType: KnowledgeSourceType;
    path: string;
    absolutePath: string;
    title: string;
    extension: string;
    size: number;
    hash: string;
    modifiedAt: string;
    trustLevel: KnowledgeTrustLevel;
}

export interface KnowledgeChunk {
    sourceId: string;
    sourcePath: string;
    sourceHash: string;
    chunkId: string;
    title: string;
    text: string;
    contextualText: string;
    modifiedAt: string;
    trustLevel: KnowledgeTrustLevel;
    tokens: string[];
}

export interface KnowledgeIndex {
    version: 1;
    generatedAt: string;
    configHash: string;
    sourceCount: number;
    chunkCount: number;
    chunks: KnowledgeChunk[];
    vectorDb?: KnowledgeVectorIndexStatus;
}

export interface KnowledgeVectorIndexStatus {
    provider: KnowledgeVectorDbProvider;
    ok: boolean;
    url?: string;
    collection?: string;
    pointCount?: number;
    message: string;
}

export interface RagFilters {
    role?: string;
    sourceTypes?: KnowledgeSourceType[];
    limit?: number;
}

export interface RagHit {
    sourceId: string;
    sourcePath: string;
    chunkId: string;
    score: number;
    retrievedBy: string;
    sourceHash: string;
    modifiedAt: string;
    trustLevel: KnowledgeTrustLevel;
    snippet: string;
}

export interface RagSearchResult {
    query: string;
    adapter: RagAdapterKind | 'local-hybrid';
    mode: KnowledgeMode;
    hits: RagHit[];
    warnings: string[];
    tracePath?: string;
}

export interface RagHealth {
    ok: boolean;
    adapter: RagAdapterKind;
    message: string;
}

export interface RagAdapter {
    id: string;
    kind: RagAdapterKind;
    health(): Promise<RagHealth>;
    search(query: string, filters: RagFilters): Promise<RagHit[]>;
    read(hit: RagHit): Promise<KnowledgeChunk | null>;
    explain?(hit: RagHit): Promise<string>;
}

export interface AgentKnowledgeContext {
    role: string;
    query: string;
    summaryKo: string;
    citations: RagHit[];
    conflicts: string[];
    warnings: string[];
    mustFollow: string[];
}

export interface KnowledgeDetectionResult {
    configPath: string;
    vaultDir: string;
    sources: KnowledgeSource[];
    existingRag: KnowledgeSource[];
    warnings: string[];
}

export interface KnowledgeVerifyIssue {
    severity: 'info' | 'warn' | 'error';
    code: string;
    path?: string;
    message: string;
}

export interface KnowledgeVerifyResult {
    ok: boolean;
    checkedAt: string;
    issues: KnowledgeVerifyIssue[];
    sourceCount: number;
    documentCount: number;
}

export interface KnowledgeVaultExportResult {
    vaultDir: string;
    manifestPath: string;
    llmsPath: string;
    llmsFullPath: string;
    obsidianDir: string;
    mkdocsDir?: string;
    documentCount: number;
    sourceCount: number;
}

export interface KnowledgeSnapshotRecord {
    id: string;
    sourcePath: string;
    snapshotPath: string;
    sourceHash: string;
    sourceModifiedAt: string;
    importedAt: string;
    size: number;
    recordKind: 'doc' | 'skill' | 'agent' | 'policy' | 'routing' | 'rag' | 'config';
    status: KnowledgeIntegrationStageStatus;
    staleReason?: string;
    warnings?: string[];
}

export interface KnowledgeAbsorbResult {
    ok: boolean;
    projectId: string;
    importedRoot: string;
    manifestPath: string;
    importedAt: string;
    recordCount: number;
    copiedCount: number;
    skippedCount: number;
    records: KnowledgeSnapshotRecord[];
    warnings: string[];
}

export interface ProjectSkillCapability {
    id: string;
    name: string;
    description: string;
    sourcePath: string;
    sourceHash: string;
    triggers: string[];
    requiredDocs: string[];
    validationHints: string[];
    warnings: string[];
}

export interface ProjectAgentCapability {
    id: string;
    role: string;
    description: string;
    sourcePath: string;
    sourceHash: string;
    writeScope: string[];
    triggers: string[];
    requiredDocs: string[];
    validationHints: string[];
    warnings: string[];
}

export interface ProjectRoutingPolicy {
    id: string;
    sourcePath: string;
    sourceHash: string;
    intents: string[];
    preferredCapabilities: string[];
    notes: string[];
    warnings: string[];
}

export interface ProjectCapabilityGraph {
    version: 1;
    projectId: string;
    generatedAt: string;
    sourceManifestPath: string;
    skills: ProjectSkillCapability[];
    agents: ProjectAgentCapability[];
    routingPolicies: ProjectRoutingPolicy[];
    edges: Array<{
        from: string;
        to: string;
        relation: 'requires-doc' | 'routes-to' | 'validates-with' | 'fallback-to';
        reason: string;
    }>;
    warnings: string[];
}

export interface KnowledgeCompileResult {
    ok: boolean;
    status: KnowledgeIntegrationStageStatus;
    projectId: string;
    compiledRoot: string;
    skillRegistryPath: string;
    agentRegistryPath: string;
    routingPolicyPath: string;
    capabilityGraphPath: string;
    skillCount: number;
    agentCount: number;
    routingPolicyCount: number;
    warnings: string[];
}

export interface KnowledgeIntegrationEvaluationResult {
    query: string;
    route: 'project-meta' | 'policy-docs' | 'rag-evidence' | 'unknown';
    ownIndexHits: number;
    existingRagHits: number;
    selectedSurface: string;
    passed: boolean;
    citations: string[];
    warnings: string[];
}

export interface KnowledgeIntegrationEvaluation {
    ok: boolean;
    status: KnowledgeIntegrationStageStatus;
    projectId: string;
    evaluatedAt: string;
    tracePath: string;
    resultPath: string;
    ownIndex: {
        path: string;
        exists: boolean;
        chunkCount: number;
    };
    existingRag: {
        detected: boolean;
        available: boolean;
        role: KnowledgeExistingRagRole;
        candidates: string[];
        message: string;
    };
    passedSurfaces: string[];
    blockedSurfaces: string[];
    results: KnowledgeIntegrationEvaluationResult[];
    warnings: string[];
}

export interface KnowledgeIntegrationActivateResult {
    ok: boolean;
    status: KnowledgeIntegrationStageStatus;
    activatedSurfaces: string[];
    blockedReasons: string[];
    config: WorkflowKnowledgeConfig;
}

export interface KnowledgeIntegrationStatus {
    strategy: KnowledgeIntegrationStrategy;
    sourceOwnership: KnowledgeSourceOwnership;
    derivedOwnership: KnowledgeDerivedOwnership;
    existingRagRole: KnowledgeExistingRagRole;
    activationMode: KnowledgeActivationMode;
    projectId: string;
    importedRoot: string;
    manifest?: {
        path: string;
        exists: boolean;
        recordCount: number;
        importedAt?: string;
        staleCount: number;
        staleRecords: Array<{ sourcePath: string; staleReason: string }>;
    };
    compiled?: {
        path: string;
        exists: boolean;
        skillCount: number;
        agentCount: number;
        routingPolicyCount: number;
        warnings: string[];
    };
    evaluation?: {
        path: string;
        exists: boolean;
        ok?: boolean;
        evaluatedAt?: string;
        passedSurfaces: string[];
        blockedSurfaces: string[];
        tracePath?: string;
    };
    activation?: {
        status: KnowledgeIntegrationStageStatus;
        activatedSurfaces: string[];
        lastActivatedAt?: string;
    };
    warnings: string[];
}

export interface KnowledgeStatus {
    config: WorkflowKnowledgeConfig;
    detection: KnowledgeDetectionResult;
    index?: {
        path: string;
        exists: boolean;
        generatedAt?: string;
        chunkCount?: number;
    };
    vault?: {
        path: string;
        manifestExists: boolean;
        llmsExists: boolean;
        obsidianExists: boolean;
    };
    integration?: KnowledgeIntegrationStatus;
}

export interface RagRecommendationCitation {
    title: string;
    url?: string;
    source: 'official-docs' | 'benchmark' | 'local-detection' | 'project-analysis';
    note: string;
    checkedAt?: string;
    reachable?: boolean;
    retrievedTitle?: string;
}

export interface RagRecommendationServiceProbe {
    reachable: boolean;
    url: string;
    validated: boolean;
    endpoint?: string;
    message: string;
    version?: string;
    portConflict?: boolean;
    conflictSummary?: string;
    actionability?: RagRecommendationActionability;
    runtimeState?: RagRecommendationRuntimeState;
}

export interface RagRecommendationCapabilities {
    canEmbed: boolean;
    canPullModels: boolean;
    canListModels: boolean;
    supportsBatch: boolean;
    supportsDimensions: boolean;
}

export interface RagRecommendationRuntimeState {
    installed: boolean;
    running: boolean;
    reachable: boolean;
    validated: boolean;
    portConflict: boolean;
    blockedReason?: string;
}

export interface RagEmbeddingEndpoint {
    id: string;
    kind: RagEmbeddingEndpointKind;
    baseUrl: string;
    models: string[];
    message: string;
    capabilities: RagRecommendationCapabilities;
    runtimeState: RagRecommendationRuntimeState;
    version?: string;
}

export interface RagRecommendationPortProbe {
    host: string;
    port: number;
    url: string;
    open: boolean;
    protocol?: string;
    processName?: string;
    pid?: number;
    title?: string;
    summary?: string;
}

export interface RagRecommendationNextAction {
    action: RagRecommendationAction;
    label: string;
    requiresConfirm: boolean;
    enabled: boolean;
    disabledReason?: string;
    model?: string;
}

export interface RagRecommendationEnvironment {
    docker: {
        installed: boolean;
        running: boolean;
        engineRunning?: boolean;
        desktopInstalled?: boolean;
        version?: string;
        message: string;
    };
    ollama: {
        running: boolean;
        baseUrl: string;
        models: string[];
        message: string;
        apiCompatible?: boolean;
        native?: boolean;
        canPullModels?: boolean;
        version?: string;
    };
    qdrant: RagRecommendationServiceProbe;
    chroma: RagRecommendationServiceProbe;
    vectorDbs?: {
        qdrant: RagRecommendationServiceProbe;
        chroma: RagRecommendationServiceProbe;
    };
    embeddingEndpoints?: RagEmbeddingEndpoint[];
    ports?: RagRecommendationPortProbe[];
    apiKeys: string[];
}

export interface RagProviderCatalogEntry {
    id: string;
    title: string;
    kind: 'vector-db' | 'embedding-provider' | 'embedding-model' | 'benchmark';
    defaultCandidate: boolean;
    officialUrl: string;
    refreshedAt?: string;
    reachable?: boolean;
    retrievedTitle?: string;
    note: string;
}

export interface RagProviderCatalog {
    refreshedAt: string;
    entries: RagProviderCatalogEntry[];
    warnings: string[];
}

export interface RagRecommendationProjectProfile {
    cwd: string;
    repoFileCount: number;
    repoSizeBytes: number;
    codeFileCount: number;
    docFileCount: number;
    codeFileRatio: number;
    koreanCharRatio: number;
    hasPython: boolean;
    hasPackageJson: boolean;
    existingRagKinds: string[];
}

export type RagRecommendationScoreLabel = 'excellent' | 'recommended' | 'conditional' | 'needs-prep' | 'low-priority';

export interface RagProviderRecommendation {
    profileId: string;
    title: string;
    rank: number;
    score: number;
    scoreLabel?: RagRecommendationScoreLabel;
    readinessAdjustedScore?: number;
    readinessAdjustedScoreLabel?: RagRecommendationScoreLabel;
    vectorDb: KnowledgeVectorDbProvider | string;
    embeddingProvider: KnowledgeEmbeddingProvider | string;
    embeddingModel: string;
    reranker?: string;
    privacy: RagRecommendationPrivacy;
    cost: RagRecommendationCost;
    installEffort: RagRecommendationInstallEffort;
    externalData: boolean;
    currentDefault: boolean;
    readiness?: RagRecommendationReadiness;
    actionability?: RagRecommendationActionability;
    blockingReasons?: string[];
    nextActions?: RagRecommendationNextAction[];
    requiredInstall: string[];
    why: string[];
    risks: string[];
    titleKo?: string;
    summaryKo?: string;
    fitForThisComputerKo?: string[];
    scoreExplanationKo?: string[];
    whyKo?: string[];
    risksKo?: string[];
    blockingReasonsKo?: string[];
    nextStepKo?: string;
    citations: RagRecommendationCitation[];
    configPatch: {
        mode?: KnowledgeMode;
        preferred?: 'existing-first' | 'local-first';
        fallback?: KnowledgeFallback;
        embedding?: KnowledgeEmbeddingConfig;
        vectorDb?: KnowledgeVectorDbConfig;
    };
}

export interface RagProviderRecommendationResult {
    generatedAt: string;
    cachePath: string;
    currentDefault: {
        mode: KnowledgeMode;
        preferred: 'existing-first' | 'local-first';
        fallback: KnowledgeFallback;
    };
    environment: RagRecommendationEnvironment;
    project: RagRecommendationProjectProfile;
    recommendations: RagProviderRecommendation[];
    warnings: string[];
    citations: RagRecommendationCitation[];
    providerCatalog?: RagProviderCatalog;
}

export type RagRecommendationAction =
    | 'health'
    | 'prepare-local-and-apply'
    | 'install-docker-desktop'
    | 'start-docker-engine'
    | 'install-native-ollama'
    | 'start-native-ollama'
    | 'start-qdrant'
    | 'start-chroma'
    | 'pull-ollama-model'
    | 'validate-embedding-endpoint'
    | 'validate-vector-db'
    | 'prepare-qdrant'
    | 'prepare-chroma';

export interface RagRecommendationActionResult {
    ok: boolean;
    action: RagRecommendationAction;
    status?: RagRecommendationActionStatus;
    message: string;
    command?: string;
    output?: string;
    blockingReasons?: string[];
    suggestedActions?: string[];
    environment?: RagRecommendationEnvironment;
    serviceUrl?: string;
    configUpdated?: boolean;
    steps?: RagRecommendationActionResult[];
}
