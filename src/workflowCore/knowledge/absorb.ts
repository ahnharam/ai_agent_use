import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
    KnowledgeAbsorbResult,
    KnowledgeChunk,
    KnowledgeCompileResult,
    KnowledgeExistingRagRole,
    KnowledgeIndex,
    KnowledgeIntegrationActivateResult,
    KnowledgeIntegrationEvaluation,
    KnowledgeIntegrationEvaluationResult,
    KnowledgeIntegrationStageStatus,
    KnowledgeIntegrationStatus,
    KnowledgeSnapshotRecord,
    ProjectAgentCapability,
    ProjectCapabilityGraph,
    ProjectRoutingPolicy,
    ProjectSkillCapability,
    WorkflowKnowledgeConfig,
} from './types';
import { detectKnowledgeSources } from './sourceRegistry';
import {
    ensureDir,
    hashFile,
    knowledgeVaultDir,
    localIndexPath,
    matchesAny,
    normalizeRel,
    readJsonFile,
    readKnowledgeConfig,
    readTextFile,
    relativePath,
    safeName,
    saveKnowledgeConfig,
    sha256,
    snippet,
    tokenize,
    walkFiles,
    writeJsonFile,
} from './utils';

const ABSORB_INCLUDE = [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    'README.md',
    'llms.txt',
    'llms-full.txt',
    '.codex/workflow-docs.json',
    '.codex/agents/*.toml',
    'skills/*/SKILL.md',
    'skills/**/SKILL.md',
    'docs/ai-start.md',
    'docs/guides/*.md',
    'docs/references/docs-orchestrator-context-pack.md',
    'docs/plan/active/*rag*.md',
    'docs/plan/active/*knowledge*.md',
    'scripts/docs_orchestrator_cli.py',
    'scripts/docs_orchestrator/cli.py',
    'scripts/docs_orchestrator/config.py',
    'scripts/docs_orchestrator/retrieval.py',
    'scripts/docs_orchestrator/adapter.py',
    'scripts/docs_orchestrator/knowledge.py',
    'scripts/docs_orchestrator/qdrant_index.py',
    'scripts/docs_orchestrator/vector_profiles.py',
    'scripts/docs_orchestrator/embeddings.py',
    'scripts/docs_orchestrator/skill_usage.py',
    'scripts/docs_orchestrator/eval/*.json',
];

interface KnowledgeAbsorbManifest {
    version: 1;
    projectId: string;
    cwd: string;
    importedAt: string;
    strategy: string;
    sourceOwnership: string;
    derivedOwnership: string;
    existingRagRole: KnowledgeExistingRagRole;
    records: KnowledgeSnapshotRecord[];
    skipped: Array<{ sourcePath: string; reason: string }>;
    warnings: string[];
}

interface ExistingRagProbe {
    detected: boolean;
    available: boolean;
    candidates: string[];
    message: string;
}

export function projectKnowledgeImportId(cwd: string): string {
    const base = safeName(path.basename(path.resolve(cwd))) || 'project';
    return `${base}-${sha256(path.resolve(cwd).toLowerCase()).slice(0, 8)}`;
}

export function importedKnowledgeRoot(cwd: string, config = readKnowledgeConfig(cwd)): string {
    return path.join(knowledgeVaultDir(cwd, config), 'imported', projectKnowledgeImportId(cwd));
}

export function importedKnowledgeManifestPath(cwd: string, config = readKnowledgeConfig(cwd)): string {
    return path.join(importedKnowledgeRoot(cwd, config), 'manifest.json');
}

export function importedKnowledgeNormalizedRoot(cwd: string, config = readKnowledgeConfig(cwd)): string {
    return path.join(importedKnowledgeRoot(cwd, config), 'normalized');
}

export function importedKnowledgeCompiledRoot(cwd: string, config = readKnowledgeConfig(cwd)): string {
    return path.join(importedKnowledgeRoot(cwd, config), 'compiled');
}

export function importedKnowledgeCapabilityGraphPath(cwd: string, config = readKnowledgeConfig(cwd)): string {
    return path.join(importedKnowledgeCompiledRoot(cwd, config), 'capability-graph.json');
}

export function importedKnowledgeEvaluationPath(cwd: string, config = readKnowledgeConfig(cwd)): string {
    return path.join(importedKnowledgeCompiledRoot(cwd, config), 'integration-evaluation.json');
}

export function absorbProjectKnowledge(cwd: string, config = readKnowledgeConfig(cwd)): KnowledgeAbsorbResult {
    const root = importedKnowledgeRoot(cwd, config);
    const rawRoot = path.join(root, 'raw');
    const importedAt = new Date().toISOString();
    const records: KnowledgeSnapshotRecord[] = [];
    const skipped: Array<{ sourcePath: string; reason: string }> = [];
    const warnings: string[] = [];
    ensureDir(rawRoot);

    for (const { rel, abs } of scanAbsorbCandidates(cwd, config)) {
        const normalized = normalizeRel(rel);
        const snapshotPath = path.join(rawRoot, normalized);
        try {
            const stat = fs.statSync(abs);
            ensureDir(path.dirname(snapshotPath));
            fs.copyFileSync(abs, snapshotPath);
            records.push({
                id: `${recordKindForPath(normalized)}:${safeName(normalized)}`,
                sourcePath: normalized,
                snapshotPath: normalizeRel(path.relative(root, snapshotPath)),
                sourceHash: hashFile(abs),
                sourceModifiedAt: stat.mtime.toISOString(),
                importedAt,
                size: stat.size,
                recordKind: recordKindForPath(normalized),
                status: 'completed',
                warnings: [],
            });
        } catch (e: any) {
            skipped.push({ sourcePath: normalized, reason: e?.message || String(e) });
        }
    }

    if (records.length === 0) warnings.push('No project knowledge files matched the absorb include rules.');

    const manifest: KnowledgeAbsorbManifest = {
        version: 1,
        projectId: projectKnowledgeImportId(cwd),
        cwd: path.resolve(cwd),
        importedAt,
        strategy: config.integration?.strategy || 'absorb-copy-own-index',
        sourceOwnership: config.integration?.sourceOwnership || 'project',
        derivedOwnership: config.integration?.derivedOwnership || 'workflow',
        existingRagRole: config.integration?.existingRagRole || 'baseline-and-fallback',
        records: records.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)),
        skipped,
        warnings,
    };
    writeJsonFile(importedKnowledgeManifestPath(cwd, config), manifest);
    return {
        ok: skipped.length === 0,
        projectId: manifest.projectId,
        importedRoot: root,
        manifestPath: importedKnowledgeManifestPath(cwd, config),
        importedAt,
        recordCount: records.length,
        copiedCount: records.length,
        skippedCount: skipped.length,
        records: manifest.records,
        warnings: [...warnings, ...skipped.map(item => `${item.sourcePath}: ${item.reason}`)],
    };
}

export function compileProjectCapabilities(cwd: string, config = readKnowledgeConfig(cwd)): KnowledgeCompileResult {
    let manifest = readAbsorbManifest(cwd, config);
    const warnings: string[] = [];
    if (!manifest) {
        const absorbed = absorbProjectKnowledge(cwd, config);
        manifest = readAbsorbManifest(cwd, config);
        warnings.push('Absorb manifest was missing, so project knowledge was absorbed before compile.');
        warnings.push(...absorbed.warnings);
    }
    if (!manifest) throw new Error('Project knowledge absorb manifest could not be created.');

    const root = importedKnowledgeRoot(cwd, config);
    const normalizedRoot = importedKnowledgeNormalizedRoot(cwd, config);
    const compiledRoot = importedKnowledgeCompiledRoot(cwd, config);
    const skills: ProjectSkillCapability[] = [];
    const agents: ProjectAgentCapability[] = [];
    const routingPolicies: ProjectRoutingPolicy[] = [];

    for (const record of manifest.records) {
        const snapshot = path.join(root, record.snapshotPath);
        let text = '';
        try {
            text = readTextFile(snapshot);
        } catch (e: any) {
            warnings.push(`Could not read snapshot ${record.sourcePath}: ${e?.message || e}`);
            continue;
        }
        if (record.recordKind === 'skill') {
            skills.push(parseSkillCapability(record, text));
        } else if (record.recordKind === 'agent') {
            agents.push(parseAgentCapability(record, text));
        } else if (record.recordKind === 'routing' || record.recordKind === 'policy' || record.sourcePath === '.codex/workflow-docs.json') {
            routingPolicies.push(parseRoutingPolicy(record, text));
        }
    }

    const graph: ProjectCapabilityGraph = {
        version: 1,
        projectId: manifest.projectId,
        generatedAt: new Date().toISOString(),
        sourceManifestPath: importedKnowledgeManifestPath(cwd, config),
        skills,
        agents,
        routingPolicies,
        edges: buildCapabilityEdges(skills, agents, routingPolicies),
        warnings: collectCapabilityWarnings(skills, agents, routingPolicies, warnings),
    };

    const skillRegistryPath = path.join(normalizedRoot, 'skill-registry.json');
    const agentRegistryPath = path.join(normalizedRoot, 'agent-registry.json');
    const routingPolicyPath = path.join(normalizedRoot, 'routing-policy.json');
    const capabilityGraphPath = importedKnowledgeCapabilityGraphPath(cwd, config);
    writeJsonFile(skillRegistryPath, { version: 1, generatedAt: graph.generatedAt, skills });
    writeJsonFile(agentRegistryPath, { version: 1, generatedAt: graph.generatedAt, agents });
    writeJsonFile(routingPolicyPath, { version: 1, generatedAt: graph.generatedAt, routingPolicies });
    writeJsonFile(capabilityGraphPath, graph);

    const status: KnowledgeIntegrationStageStatus = graph.warnings.length ? 'partial' : 'completed';
    return {
        ok: true,
        status,
        projectId: manifest.projectId,
        compiledRoot,
        skillRegistryPath,
        agentRegistryPath,
        routingPolicyPath,
        capabilityGraphPath,
        skillCount: skills.length,
        agentCount: agents.length,
        routingPolicyCount: routingPolicies.length,
        warnings: graph.warnings,
    };
}

export function readCompiledCapabilityGraph(cwd: string, config = readKnowledgeConfig(cwd)): ProjectCapabilityGraph | null {
    return readJsonFile<ProjectCapabilityGraph>(importedKnowledgeCapabilityGraphPath(cwd, config));
}

export function compiledCapabilityChunks(cwd: string, config = readKnowledgeConfig(cwd)): KnowledgeChunk[] {
    const graph = readCompiledCapabilityGraph(cwd, config);
    if (!graph) return [];
    const chunks: KnowledgeChunk[] = [];
    for (const skill of graph.skills) {
        const text = [
            `Capability Type: Codex Skill`,
            `Name: ${skill.name}`,
            `Description: ${skill.description}`,
            `Triggers: ${skill.triggers.join(', ')}`,
            `Required Docs: ${skill.requiredDocs.join(', ')}`,
            `Validation: ${skill.validationHints.join('; ')}`,
        ].join('\n');
        chunks.push(capabilityChunk(`skill:${skill.id}`, skill.sourcePath, skill.sourceHash, skill.name, text));
    }
    for (const agent of graph.agents) {
        const text = [
            `Capability Type: Codex Workflow Agent`,
            `Role: ${agent.role}`,
            `Description: ${agent.description}`,
            `Write Scope: ${agent.writeScope.join(', ')}`,
            `Triggers: ${agent.triggers.join(', ')}`,
            `Required Docs: ${agent.requiredDocs.join(', ')}`,
            `Validation: ${agent.validationHints.join('; ')}`,
        ].join('\n');
        chunks.push(capabilityChunk(`agent:${agent.id}`, agent.sourcePath, agent.sourceHash, agent.role, text));
    }
    for (const policy of graph.routingPolicies) {
        const text = [
            `Capability Type: Project Routing Policy`,
            `Source: ${policy.sourcePath}`,
            `Intents: ${policy.intents.join(', ')}`,
            `Preferred Capabilities: ${policy.preferredCapabilities.join(', ')}`,
            policy.notes.join('\n'),
        ].join('\n');
        chunks.push(capabilityChunk(`routing:${policy.id}`, policy.sourcePath, policy.sourceHash, path.basename(policy.sourcePath), text));
    }
    return chunks;
}

export function evaluateKnowledgeIntegration(cwd: string, config = readKnowledgeConfig(cwd)): KnowledgeIntegrationEvaluation {
    const compiled = readCompiledCapabilityGraph(cwd, config) || compileProjectCapabilities(cwd, config) && readCompiledCapabilityGraph(cwd, config);
    if (!compiled) throw new Error('Capability graph is missing after compile.');

    const index = readJsonFile<KnowledgeIndex>(localIndexPath(cwd, config));
    const existingRag = probeExistingRagBaseline(cwd, config);
    const queries = [
        { query: 'Codex 스킬 SKILL.md skills-router subagent 라우팅', route: 'project-meta' as const, surface: 'capability-routing' },
        { query: 'AGENTS.md 프로젝트 규칙 문서 정책', route: 'policy-docs' as const, surface: 'project-policy' },
        { query: 'docs_orchestrator ask-docs vector-status doctor 기존 RAG', route: 'rag-evidence' as const, surface: 'existing-rag-baseline' },
    ];
    const chunkText = (index?.chunks || []).map(chunk => `${chunk.sourceId} ${chunk.sourcePath} ${chunk.title} ${chunk.contextualText}`).join('\n').toLowerCase();
    const results: KnowledgeIntegrationEvaluationResult[] = queries.map(item => {
        const tokens = tokenize(item.query);
        const ownHits = tokens.filter(token => chunkText.includes(token.toLowerCase())).length;
        const citations = (index?.chunks || [])
            .filter(chunk => tokens.some(token => chunk.tokens.includes(token) || chunk.contextualText.toLowerCase().includes(token.toLowerCase())))
            .slice(0, 5)
            .map(chunk => `${chunk.sourcePath}#${chunk.chunkId}`);
        const existingHits = existingRag.available && /ask-docs|docs_orchestrator|vector-status|doctor/i.test(item.query) ? 1 : 0;
        return {
            query: item.query,
            route: item.route,
            ownIndexHits: ownHits,
            existingRagHits: existingHits,
            selectedSurface: item.surface,
            passed: item.surface === 'existing-rag-baseline' ? existingRag.detected : ownHits > 0,
            citations,
            warnings: citations.length ? [] : [`No own-index citation was found for ${item.query}.`],
        };
    });
    const passedSurfaces = results.filter(result => result.passed).map(result => result.selectedSurface);
    const blockedSurfaces = results.filter(result => !result.passed).map(result => result.selectedSurface);
    const tracePath = path.join(cwd, '.ai-agent', 'runs', 'knowledge-integration-eval.trace.jsonl');
    ensureDir(path.dirname(tracePath));
    fs.appendFileSync(tracePath, `${JSON.stringify({ at: new Date().toISOString(), results, existingRag })}\n`, 'utf-8');

    const evaluation: KnowledgeIntegrationEvaluation = {
        ok: blockedSurfaces.length === 0 || passedSurfaces.includes('capability-routing'),
        status: blockedSurfaces.length ? 'partial' : 'completed',
        projectId: compiled.projectId,
        evaluatedAt: new Date().toISOString(),
        tracePath,
        resultPath: importedKnowledgeEvaluationPath(cwd, config),
        ownIndex: {
            path: localIndexPath(cwd, config),
            exists: !!index,
            chunkCount: index?.chunkCount || 0,
        },
        existingRag: {
            detected: existingRag.detected,
            available: existingRag.available,
            role: config.integration?.existingRagRole || 'baseline-and-fallback',
            candidates: existingRag.candidates,
            message: existingRag.message,
        },
        passedSurfaces,
        blockedSurfaces,
        results,
        warnings: [
            ...(index ? [] : ['Own local knowledge index is missing. Run /knowledge/index/build before activation.']),
            ...results.flatMap(result => result.warnings),
            ...(existingRag.detected && !existingRag.available ? [existingRag.message] : []),
        ],
    };
    writeJsonFile(evaluation.resultPath, evaluation);
    return evaluation;
}

export function activateKnowledgeIntegration(cwd: string, config = readKnowledgeConfig(cwd)): KnowledgeIntegrationActivateResult {
    const evaluation = readJsonFile<KnowledgeIntegrationEvaluation>(importedKnowledgeEvaluationPath(cwd, config));
    const blockedReasons: string[] = [];
    if (!evaluation) blockedReasons.push('Knowledge integration evaluation is missing.');
    if (config.integration?.activationMode === 'eval-gated' && evaluation && !evaluation.passedSurfaces.includes('capability-routing')) {
        blockedReasons.push('Capability routing did not pass evaluation.');
    }
    if (evaluation && !evaluation.ownIndex.exists) blockedReasons.push('Own Workflow index is missing.');
    if (blockedReasons.length) {
        return {
            ok: false,
            status: 'blocked',
            activatedSurfaces: config.integration?.activatedSurfaces || [],
            blockedReasons,
            config,
        };
    }
    const now = new Date().toISOString();
    const next = saveKnowledgeConfig(cwd, {
        ...config,
        integration: {
            ...(config.integration || {
                strategy: 'absorb-copy-own-index',
                sourceOwnership: 'project',
                derivedOwnership: 'workflow',
                existingRagRole: 'baseline-and-fallback',
                activationMode: 'eval-gated',
            }),
            activatedSurfaces: evaluation?.passedSurfaces || [],
            lastActivatedAt: now,
            lastEvaluatedAt: evaluation?.evaluatedAt,
        },
    });
    return {
        ok: true,
        status: 'active',
        activatedSurfaces: next.integration?.activatedSurfaces || [],
        blockedReasons: [],
        config: next,
    };
}

export function readKnowledgeIntegrationStatus(cwd: string, config = readKnowledgeConfig(cwd)): KnowledgeIntegrationStatus {
    const manifest = readAbsorbManifest(cwd, config);
    const graph = readCompiledCapabilityGraph(cwd, config);
    const evaluation = readJsonFile<KnowledgeIntegrationEvaluation>(importedKnowledgeEvaluationPath(cwd, config));
    const staleRecords = manifest ? detectStaleRecords(cwd, manifest) : [];
    const integration = config.integration || {
        strategy: 'absorb-copy-own-index' as const,
        sourceOwnership: 'project' as const,
        derivedOwnership: 'workflow' as const,
        existingRagRole: 'baseline-and-fallback' as const,
        activationMode: 'eval-gated' as const,
        activatedSurfaces: [],
    };
    return {
        strategy: integration.strategy,
        sourceOwnership: integration.sourceOwnership,
        derivedOwnership: integration.derivedOwnership,
        existingRagRole: integration.existingRagRole,
        activationMode: integration.activationMode,
        projectId: projectKnowledgeImportId(cwd),
        importedRoot: importedKnowledgeRoot(cwd, config),
        manifest: {
            path: importedKnowledgeManifestPath(cwd, config),
            exists: !!manifest,
            recordCount: manifest?.records.length || 0,
            importedAt: manifest?.importedAt,
            staleCount: staleRecords.length,
            staleRecords: staleRecords.slice(0, 30),
        },
        compiled: {
            path: importedKnowledgeCapabilityGraphPath(cwd, config),
            exists: !!graph,
            skillCount: graph?.skills.length || 0,
            agentCount: graph?.agents.length || 0,
            routingPolicyCount: graph?.routingPolicies.length || 0,
            warnings: graph?.warnings || [],
        },
        evaluation: {
            path: importedKnowledgeEvaluationPath(cwd, config),
            exists: !!evaluation,
            ok: evaluation?.ok,
            evaluatedAt: evaluation?.evaluatedAt,
            passedSurfaces: evaluation?.passedSurfaces || [],
            blockedSurfaces: evaluation?.blockedSurfaces || [],
            tracePath: evaluation?.tracePath,
        },
        activation: {
            status: integration.activatedSurfaces?.length ? 'active' : 'not-started',
            activatedSurfaces: integration.activatedSurfaces || [],
            lastActivatedAt: integration.lastActivatedAt,
        },
        warnings: [
            ...(staleRecords.length ? [`${staleRecords.length} absorbed source records are stale.`] : []),
            ...(graph?.warnings || []),
            ...(evaluation?.warnings || []),
        ],
    };
}

function scanAbsorbCandidates(cwd: string, config: WorkflowKnowledgeConfig): Array<{ rel: string; abs: string }> {
    const include = Array.from(new Set([...(config.include || []), ...ABSORB_INCLUDE]));
    const exclude = Array.from(new Set(config.exclude || []));
    const candidates: Array<{ rel: string; abs: string }> = [];
    walkFiles(cwd, exclude, (rel, abs) => {
        const normalized = normalizeRel(rel);
        if (matchesAny(normalized, exclude)) return;
        if (!matchesAny(normalized, include)) return;
        candidates.push({ rel: normalized, abs });
    });
    return candidates.sort((a, b) => a.rel.localeCompare(b.rel));
}

function readAbsorbManifest(cwd: string, config: WorkflowKnowledgeConfig): KnowledgeAbsorbManifest | null {
    return readJsonFile<KnowledgeAbsorbManifest>(importedKnowledgeManifestPath(cwd, config));
}

function detectStaleRecords(cwd: string, manifest: KnowledgeAbsorbManifest): Array<{ sourcePath: string; staleReason: string }> {
    const stale: Array<{ sourcePath: string; staleReason: string }> = [];
    for (const record of manifest.records) {
        const source = path.join(cwd, record.sourcePath);
        if (!fs.existsSync(source)) {
            stale.push({ sourcePath: record.sourcePath, staleReason: 'source file is missing' });
            continue;
        }
        try {
            const stat = fs.statSync(source);
            const currentHash = hashFile(source);
            if (currentHash !== record.sourceHash) {
                stale.push({ sourcePath: record.sourcePath, staleReason: 'sourceHash changed' });
            } else if (stat.mtime.toISOString() !== record.sourceModifiedAt) {
                stale.push({ sourcePath: record.sourcePath, staleReason: 'sourceModifiedAt changed' });
            }
        } catch (e: any) {
            stale.push({ sourcePath: record.sourcePath, staleReason: e?.message || String(e) });
        }
    }
    return stale;
}

function recordKindForPath(rel: string): KnowledgeSnapshotRecord['recordKind'] {
    const normalized = normalizeRel(rel);
    if (/\/SKILL\.md$/i.test(normalized) || /^skills\/[^/]+\/SKILL\.md$/i.test(normalized)) return 'skill';
    if (/^\.codex\/agents\/[^/]+\.toml$/i.test(normalized)) return 'agent';
    if (/^(AGENTS|CLAUDE|GEMINI)\.md$/i.test(normalized)) return 'policy';
    if (/skills-router|skills-index|codex-subagent-routing|workflow-docs/i.test(normalized)) return 'routing';
    if (/docs_orchestrator|rag|retrieval|vector/i.test(normalized)) return 'rag';
    if (/\.json$/i.test(normalized)) return 'config';
    return 'doc';
}

function parseSkillCapability(record: KnowledgeSnapshotRecord, text: string): ProjectSkillCapability {
    const frontmatter = parseFrontmatter(text);
    const name = frontmatter.name || path.basename(path.dirname(record.sourcePath)) || safeName(record.sourcePath);
    const description = frontmatter.description || firstNonEmptyLine(text) || '';
    const warnings: string[] = [];
    if (!description) warnings.push('Skill description was missing or empty.');
    return {
        id: safeName(name),
        name,
        description,
        sourcePath: record.sourcePath,
        sourceHash: record.sourceHash,
        triggers: uniqueStrings([
            name,
            ...extractUseWhenPhrases(description),
            ...extractBacktickTerms(text).filter(term => /codex|skill|docs|ask-docs|subagent|workflow|mcp|rag/i.test(term)),
        ]).slice(0, 30),
        requiredDocs: extractReferencedPaths(text),
        validationHints: extractValidationHints(text),
        warnings,
    };
}

function parseAgentCapability(record: KnowledgeSnapshotRecord, text: string): ProjectAgentCapability {
    const name = matchTomlString(text, 'name') || safeName(record.sourcePath);
    const description = matchTomlString(text, 'description') || '';
    const instructions = matchTomlBlock(text, 'developer_instructions') || text;
    const sandbox = matchTomlString(text, 'sandbox_mode') || '';
    const warnings: string[] = [];
    if (!description) warnings.push('Agent description was missing or empty.');
    return {
        id: safeName(name),
        role: name,
        description,
        sourcePath: record.sourcePath,
        sourceHash: record.sourceHash,
        writeScope: inferWriteScope(sandbox, instructions),
        triggers: uniqueStrings([
            name,
            ...extractUseWhenPhrases(description),
            ...extractBacktickTerms(instructions).filter(term => /agent|docs|rag|knowledge|frontend|backend|qa|git|workflow/i.test(term)),
        ]).slice(0, 30),
        requiredDocs: extractReferencedPaths(instructions),
        validationHints: extractValidationHints(instructions),
        warnings,
    };
}

function parseRoutingPolicy(record: KnowledgeSnapshotRecord, text: string): ProjectRoutingPolicy {
    const preferredCapabilities = extractBacktickTerms(text)
        .filter(term => /agent|skill|docs|rag|workflow|ask-docs|subagent/i.test(term))
        .slice(0, 60);
    return {
        id: safeName(record.sourcePath),
        sourcePath: record.sourcePath,
        sourceHash: record.sourceHash,
        intents: uniqueStrings([
            ...extractHeadings(text),
            ...extractUseWhenPhrases(text),
        ]).slice(0, 40),
        preferredCapabilities,
        notes: text.split(/\r?\n/).filter(line => /skill|agent|docs|rag|workflow|subagent|ask-docs|문서|스킬|라우팅/i.test(line)).slice(0, 40),
        warnings: preferredCapabilities.length ? [] : ['Routing policy did not explicitly mention skill/agent names.'],
    };
}

function buildCapabilityEdges(
    skills: ProjectSkillCapability[],
    agents: ProjectAgentCapability[],
    policies: ProjectRoutingPolicy[],
): ProjectCapabilityGraph['edges'] {
    const edges: ProjectCapabilityGraph['edges'] = [];
    for (const skill of skills) {
        for (const doc of skill.requiredDocs.slice(0, 20)) {
            edges.push({ from: `skill:${skill.id}`, to: doc, relation: 'requires-doc', reason: 'Skill references this document or script.' });
        }
    }
    for (const agent of agents) {
        for (const doc of agent.requiredDocs.slice(0, 20)) {
            edges.push({ from: `agent:${agent.id}`, to: doc, relation: 'requires-doc', reason: 'Agent instructions reference this document or script.' });
        }
    }
    const capabilityNames = [
        ...skills.map(skill => ({ id: `skill:${skill.id}`, haystack: `${skill.name} ${skill.sourcePath}`.toLowerCase() })),
        ...agents.map(agent => ({ id: `agent:${agent.id}`, haystack: `${agent.role} ${agent.sourcePath}`.toLowerCase() })),
    ];
    for (const policy of policies) {
        const policyText = `${policy.sourcePath} ${policy.intents.join(' ')} ${policy.preferredCapabilities.join(' ')} ${policy.notes.join(' ')}`.toLowerCase();
        for (const capability of capabilityNames) {
            if (policyText.includes(capability.haystack.split(/[\\/]/).pop() || '') || policyText.includes(capability.id.split(':')[1])) {
                edges.push({ from: `routing:${policy.id}`, to: capability.id, relation: 'routes-to', reason: 'Routing policy mentions this capability.' });
            }
        }
    }
    return edges;
}

function collectCapabilityWarnings(
    skills: ProjectSkillCapability[],
    agents: ProjectAgentCapability[],
    policies: ProjectRoutingPolicy[],
    warnings: string[],
): string[] {
    return uniqueStrings([
        ...warnings,
        ...skills.flatMap(skill => skill.warnings.map(warning => `${skill.sourcePath}: ${warning}`)),
        ...agents.flatMap(agent => agent.warnings.map(warning => `${agent.sourcePath}: ${warning}`)),
        ...policies.flatMap(policy => policy.warnings.map(warning => `${policy.sourcePath}: ${warning}`)),
        ...(skills.length ? [] : ['No SKILL.md files were compiled into the capability graph.']),
        ...(agents.length ? [] : ['No .codex/agents/*.toml files were compiled into the capability graph.']),
    ]);
}

function capabilityChunk(sourceId: string, sourcePath: string, sourceHash: string, title: string, text: string): KnowledgeChunk {
    const contextualText = [
        `Source: ${sourcePath}`,
        `Title: ${title}`,
        'Record Kind: project-capability',
        '',
        text,
    ].join('\n');
    return {
        sourceId: `capability:${sourceId}`,
        sourcePath,
        sourceHash,
        chunkId: sha256(`${sourceId}:${sourceHash}:${text}`).slice(0, 16),
        title,
        text,
        contextualText,
        modifiedAt: new Date().toISOString(),
        trustLevel: 'high',
        tokens: tokenize(`${sourceId} ${sourcePath} ${title} ${contextualText}`),
    };
}

function probeExistingRagBaseline(cwd: string, config: WorkflowKnowledgeConfig): ExistingRagProbe {
    const detection = detectKnowledgeSources(cwd, config);
    const candidates = detection.existingRag.map(source => `${source.id}:${source.detectedBy || source.type}`);
    const cli = path.join(cwd, 'scripts', 'docs_orchestrator_cli.py');
    if (fs.existsSync(cli)) candidates.push('docs_orchestrator_cli.py');
    if (!detection.existingRag.length && !fs.existsSync(cli)) {
        return { detected: false, available: false, candidates: [], message: 'No existing RAG baseline was detected.' };
    }
    if (!fs.existsSync(cli)) {
        return { detected: true, available: false, candidates, message: 'Existing RAG markers were detected, but no docs_orchestrator CLI baseline probe is available.' };
    }
    const runtimes = uniqueStrings([process.env.PYTHON || '', 'python', 'py']).filter(Boolean);
    for (const runtime of runtimes) {
        const args = runtime === 'py' ? ['-3', cli, '--help'] : [cli, '--help'];
        const result = spawnSync(runtime, args, {
            cwd,
            encoding: 'utf-8',
            timeout: 8000,
            windowsHide: true,
        });
        if (result.status === 0) {
            return {
                detected: true,
                available: true,
                candidates,
                message: `Existing docs_orchestrator CLI is reachable through ${runtime}; it will be used as baseline/fallback evidence only.`,
            };
        }
    }
    return {
        detected: true,
        available: false,
        candidates,
        message: 'Existing docs_orchestrator CLI was detected but no Python runtime probe succeeded.',
    };
}

function parseFrontmatter(text: string): Record<string, string> {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    if (lines[0]?.trim() !== '---') return {};
    const out: Record<string, string> = {};
    let currentKey = '';
    for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim() === '---') break;
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (match) {
            currentKey = match[1];
            out[currentKey] = match[2].trim().replace(/^["']|["']$/g, '');
        } else if (currentKey && /^\s+/.test(line)) {
            out[currentKey] = `${out[currentKey]}\n${line.trim()}`.trim();
        }
    }
    return out;
}

function matchTomlString(text: string, key: string): string {
    const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, 'm'));
    return match?.[1]?.trim() || '';
}

function matchTomlBlock(text: string, key: string): string {
    const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"""([\\s\\S]*?)"""`, 'm'));
    return match?.[1]?.trim() || '';
}

function extractUseWhenPhrases(text: string): string[] {
    return String(text || '')
        .split(/[.;\n]/)
        .map(line => line.trim())
        .filter(line => /use when|when to use|사용|필요|라우팅|trigger|intent/i.test(line))
        .slice(0, 20);
}

function extractBacktickTerms(text: string): string[] {
    return Array.from(String(text || '').matchAll(/`([^`\n]{2,120})`/g)).map(match => match[1].trim());
}

function extractReferencedPaths(text: string): string[] {
    const refs = Array.from(String(text || '').matchAll(/(?:`|^|\s)((?:docs|skills|scripts|src|\.codex|backend|frontend)\/[A-Za-z0-9_.@/ -]+?)(?:`|\s|,|\)|$)/g))
        .map(match => normalizeRel(match[1].trim().replace(/[.。]$/, '')))
        .filter(value => value.length > 2);
    return uniqueStrings(refs).slice(0, 60);
}

function extractValidationHints(text: string): string[] {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => line.trim().replace(/^[-*]\s*/, ''))
        .filter(line => /test|validate|verify|lint|compile|pytest|unittest|npm|검증|테스트|빌드|확인/i.test(line))
        .slice(0, 30);
}

function extractHeadings(text: string): string[] {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => line.match(/^#{1,4}\s+(.+)$/)?.[1]?.trim() || '')
        .filter(Boolean)
        .slice(0, 30);
}

function firstNonEmptyLine(text: string): string {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
}

function inferWriteScope(sandbox: string, text: string): string[] {
    const scope = new Set<string>();
    if (/read-only/i.test(sandbox)) scope.add('read-only');
    if (/frontend|ui|css|react|vue/i.test(text)) scope.add('frontend');
    if (/backend|api|server|database|db/i.test(text)) scope.add('backend');
    if (/docs|documentation|wiki|vault|llms/i.test(text)) scope.add('docs');
    if (/git|commit|push|branch/i.test(text)) scope.add('git');
    if (!scope.size) scope.add(sandbox || 'unspecified');
    return Array.from(scope);
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)));
}
