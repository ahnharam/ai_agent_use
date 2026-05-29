import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    absorbProjectKnowledge,
    activateKnowledgeIntegration,
    compileProjectCapabilities,
    evaluateKnowledgeIntegration,
    readKnowledgeIntegrationStatus,
} from './absorb';
import { rebuildLocalKnowledgeIndex } from './indexer';
import { searchKnowledge } from './retriever';
import { detectKnowledgeSources } from './sourceRegistry';
import { hashFile, readKnowledgeConfig, writeJsonFile } from './utils';
import { buildKnowledgeRoutingDecision } from '../engine';

function mkdirp(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function write(file: string, text: string): void {
    mkdirp(path.dirname(file));
    fs.writeFileSync(file, text, 'utf-8');
}

function createFixture(): string {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-knowledge-absorb-'));
    writeJsonFile(path.join(cwd, '.codex', 'workflow-knowledge.json'), {
        version: 1,
        mode: 'own',
        preferred: 'local-first',
        fallback: 'local-hybrid',
        citationRequired: true,
        writeGeneratedVault: true,
        generatedVaultDir: '.ai-agent/knowledge-vault',
        include: ['README.md', 'AGENTS.md', '.codex/agents/*.toml', 'docs/**/*.md'],
        exclude: ['.git/**', 'node_modules/**', '.env', '.env.*', '**/*token*', '**/*credential*', '.ai-agent/knowledge-vault/**'],
        sources: [],
        embedding: { provider: 'none', model: 'none', externalData: false },
        vectorDb: { provider: 'local-hybrid', mode: 'local', collectionPrefix: 'codex_workflow' },
        integration: {
            strategy: 'absorb-copy-own-index',
            sourceOwnership: 'project',
            derivedOwnership: 'workflow',
            existingRagRole: 'baseline-and-fallback',
            activationMode: 'eval-gated',
            activatedSurfaces: [],
        },
    });
    write(path.join(cwd, 'README.md'), '# Fixture\n\nWorkflow fixture.');
    write(path.join(cwd, 'AGENTS.md'), '# Agent Rules\n\nUse docs/guides/skills-router.md before coding.');
    write(path.join(cwd, '.env'), 'OPENAI_API_KEY=must-not-be-copied\n');
    write(path.join(cwd, 'package.json'), '{"dependencies":{"langchain":"1.0.0"}}\n');
    write(path.join(cwd, 'skills', 'fixture-docs', 'SKILL.md'), [
        '---',
        'name: fixture-docs',
        'description: Use when routing Codex skills, SKILL.md entries, skills-router docs, or subagent policy.',
        '---',
        '# Fixture Docs Skill',
        '',
        'Read `docs/guides/skills-router.md` and validate with `npm run compile`.',
    ].join('\n'));
    write(path.join(cwd, '.codex', 'agents', 'docs-agent.toml'), [
        'name = "docs-agent"',
        'description = "Coordinates project docs, RAG evidence, Codex skills, and subagent routing."',
        'sandbox_mode = "read-only"',
        'developer_instructions = """',
        'Read `AGENTS.md` and `docs/guides/skills-router.md`.',
        'Validate by checking citations and stale sourceHash values.',
        '"""',
    ].join('\n'));
    write(path.join(cwd, '.codex', 'agents', 'partial-agent.toml'), [
        'name = "partial-agent"',
        'sandbox_mode = "read-only"',
    ].join('\n'));
    write(path.join(cwd, 'docs', 'guides', 'skills-router.md'), [
        '# Skills Router',
        '',
        'Route Codex 스킬, `SKILL.md`, and subagent questions to `fixture-docs` and `docs-agent`.',
        'Use `ask-docs` only as advisory baseline evidence.',
    ].join('\n'));
    write(path.join(cwd, 'docs', 'guides', 'codex-subagent-routing.md'), [
        '# Codex Subagent Routing',
        '',
        '`docs-agent` handles project meta knowledge before game or product RAG.',
    ].join('\n'));
    write(path.join(cwd, 'scripts', 'docs_orchestrator_cli.py'), 'import sys\nprint("docs orchestrator help")\nsys.exit(0)\n');
    return cwd;
}

function verifyRealProjectWorkflowSkills(): void {
    const projectRoot = process.cwd();
    const requiredSkills = [
        'skills/workflow-knowledge-runtime/SKILL.md',
        'skills/workflow-app-validation/SKILL.md',
        'skills/workflow-rag-provider-ops/SKILL.md',
        'skills/workflow-agent-routing/SKILL.md',
    ];
    for (const rel of requiredSkills) {
        assert.ok(fs.existsSync(path.join(projectRoot, rel)), `${rel} exists in the real project`);
    }

    const config = readKnowledgeConfig(projectRoot);
    const absorbed = absorbProjectKnowledge(projectRoot, config);
    const absorbedSkillPaths = new Set(absorbed.records.filter(record => record.recordKind === 'skill').map(record => record.sourcePath));
    for (const rel of requiredSkills) {
        assert.ok(absorbedSkillPaths.has(rel), `${rel} was absorbed as recordKind=skill`);
    }

    const compiled = compileProjectCapabilities(projectRoot, config);
    assert.ok(compiled.skillCount >= 4, `real project skillCount >= 4, got ${compiled.skillCount}`);
    assert.ok(compiled.agentCount >= 13, `real project agentCount >= 13, got ${compiled.agentCount}`);

    const index = rebuildLocalKnowledgeIndex(projectRoot, config);
    const capabilitySkillPaths = new Set(
        index.chunks
            .filter(chunk => chunk.sourceId.startsWith('capability:skill:'))
            .map(chunk => chunk.sourcePath),
    );
    for (const rel of requiredSkills) {
        assert.ok(capabilitySkillPaths.has(rel), `${rel} was indexed as project-capability`);
    }

    for (const query of ['Workflow App 검증', 'Qdrant Ollama 준비', 'agent routing', 'absorb compile activate']) {
        const result = searchKnowledge(projectRoot, query, { sourceTypes: ['project-capability'], limit: 5 }, config);
        assert.ok(result.hits.length > 0, `${query} returns project-capability hits`);
    }

    const evaluation = evaluateKnowledgeIntegration(projectRoot, config);
    assert.ok(evaluation.passedSurfaces.includes('capability-routing'), 'real project capability-routing passed evaluation');

    const status = readKnowledgeIntegrationStatus(projectRoot, config);
    assert.equal(status.manifest.staleCount, 0, 'real project absorb snapshot is not stale immediately after absorb');
    assert.ok(status.compiled.skillCount >= 4, 'real project integration status reports skillCount >= 4');
}

async function verifyRoutingDecision(cwd: string): Promise<void> {
    const baseRun = {
        id: 'fixture-routing-general',
        cwd,
        runKind: 'multiAgent',
        userPrompt: 'Change Workflow App code and validate the result.',
        prompt: 'Change Workflow App code and validate the result.',
        artifacts: {},
    } as any;
    const general = await buildKnowledgeRoutingDecision(baseRun);
    assert.equal(general.executionProfile, 'standard', 'general routing uses standard profile');
    assert.ok(general.selectedWorkers.includes('knowledge-source-agent'), 'general routing selects knowledge-source-agent');
    assert.ok(general.selectedWorkers.includes('rag-retriever-agent'), 'general routing selects rag-retriever-agent');
    assert.ok(!general.selectedWorkers.includes('docs-agent'), 'docs-agent remains coordinator, not selected worker');
    assert.equal(general.coordinatorRole, 'docs-agent', 'docs-agent is coordinator');
    assert.ok(!general.selectedWorkers.includes('knowledge-index-agent'), 'general routing does not rebuild index by default');
    assert.ok(general.selectedSkills.length > 0, 'general routing includes selected capability skills');
    assert.ok(general.citations.length > 0, 'general routing includes citations');
    assert.ok(!/[�]/.test(general.reasonsKo.join('\n')), 'routing reasons do not contain replacement characters');

    const smoke = await buildKnowledgeRoutingDecision({
        ...baseRun,
        id: 'fixture-routing-smoke',
        runKind: 'readOnly',
        userPrompt: '읽기 전용 routing trace smoke test입니다. 파일을 수정하지 말고 상태만 확인해줘.',
        prompt: '읽기 전용 routing trace smoke test입니다. 파일을 수정하지 말고 상태만 확인해줘.',
    } as any);
    assert.equal(smoke.executionProfile, 'fast-readonly', 'read-only smoke uses fast-readonly profile');
    assert.ok(smoke.selectedWorkers.includes('knowledge-source-agent'), 'smoke routing selects knowledge-source-agent');
    assert.ok(smoke.selectedWorkers.includes('rag-retriever-agent'), 'smoke routing selects rag-retriever-agent');
    assert.ok(!smoke.selectedWorkers.includes('knowledge-auditor-agent'), 'smoke routing does not select auditor');
    assert.ok(!smoke.selectedWorkers.includes('docs-agent'), 'smoke routing keeps docs-agent as coordinator');

    const rag = await buildKnowledgeRoutingDecision({
        ...baseRun,
        id: 'fixture-routing-rag',
        userPrompt: 'Rebuild RAG vector index with citations and stale hash checks.',
        prompt: 'Rebuild RAG vector index with citations and stale hash checks.',
    } as any);
    assert.equal(rag.executionProfile, 'deep-audit', 'RAG rebuild routing uses deep-audit profile');
    assert.ok(rag.selectedWorkers.includes('knowledge-index-agent'), 'RAG routing selects knowledge-index-agent');
    assert.ok(rag.selectedWorkers.includes('knowledge-auditor-agent'), 'RAG routing selects knowledge-auditor-agent');

    const wiki = await buildKnowledgeRoutingDecision({
        ...baseRun,
        id: 'fixture-routing-wiki',
        userPrompt: 'Export Obsidian vault, llms.txt, and wiki documentation.',
        prompt: 'Export Obsidian vault, llms.txt, and wiki documentation.',
    } as any);
    assert.equal(wiki.executionProfile, 'deep-audit', 'wiki/vault export routing uses deep-audit profile');
    assert.ok(wiki.selectedWorkers.includes('wiki-export-agent'), 'wiki routing selects wiki-export-agent');
    assert.ok(wiki.selectedWorkers.includes('knowledge-auditor-agent'), 'wiki routing selects knowledge-auditor-agent');
}

function verifyLostarkPilotIfAvailable(): void {
    const lostarkRoot = 'D:\\Github\\lostark';
    if (!fs.existsSync(lostarkRoot)) return;

    const config = readKnowledgeConfig(lostarkRoot);
    const detection = detectKnowledgeSources(lostarkRoot, config);
    assert.ok(detection.existingRag.some(source => source.id === 'existing-rag-docs-orchestrator'), 'lostark docs_orchestrator is detected as existing RAG');

    const absorbed = absorbProjectKnowledge(lostarkRoot, config);
    const skillCount = absorbed.records.filter(record => record.recordKind === 'skill').length;
    assert.ok(skillCount >= 31, `lostark skillCount >= 31 after absorb, got ${skillCount}`);

    const compiled = compileProjectCapabilities(lostarkRoot, config);
    assert.ok(compiled.skillCount >= 31, `lostark compiled skillCount >= 31, got ${compiled.skillCount}`);

    const index = rebuildLocalKnowledgeIndex(lostarkRoot, config);
    assert.ok(index.chunks.some(chunk => chunk.sourceId.startsWith('capability:skill:')), 'lostark own index includes skill capability chunks');

    const pilotQueries = [
        'lostark skill routing',
        'docs orchestrator Qdrant BGE-M3 operations',
        'verification tier quick standard browser',
        'bug prevention checklist',
        'source driven research',
        'frontend design audit',
    ];
    for (const query of pilotQueries) {
        const result = searchKnowledge(lostarkRoot, query, { limit: 5 }, config);
        assert.ok(result.hits.length > 0, `lostark query returns hits: ${query}`);
        assert.ok(
            result.hits.some(hit => /^skills\//i.test(hit.sourcePath) || /^docs\//i.test(hit.sourcePath) || hit.sourcePath === 'AGENTS.md' || /^scripts\/docs_orchestrator/i.test(hit.sourcePath)),
            `lostark query returns repo capability/doc hits: ${query}`,
        );
    }

    const evaluation = evaluateKnowledgeIntegration(lostarkRoot, config);
    assert.ok(evaluation.existingRag.detected, 'lostark existing docs_orchestrator/RAG baseline was detected');
    assert.ok(evaluation.passedSurfaces.includes('capability-routing'), 'lostark capability-routing passed evaluation');

    const status = readKnowledgeIntegrationStatus(lostarkRoot, config);
    assert.equal(status.manifest.staleCount, 0, 'lostark absorb snapshot is not stale immediately after absorb');
    assert.ok(status.compiled.skillCount >= 31, 'lostark integration status reports skillCount >= 31');
}

async function main(): Promise<void> {
    const cwd = createFixture();
    const config = readKnowledgeConfig(cwd);
    const watchedFiles = [
        path.join(cwd, 'AGENTS.md'),
        path.join(cwd, 'skills', 'fixture-docs', 'SKILL.md'),
        path.join(cwd, '.codex', 'agents', 'docs-agent.toml'),
    ];
    const originalHashes = watchedFiles.map(file => hashFile(file));

    const absorbed = absorbProjectKnowledge(cwd, config);
    assert.ok(absorbed.recordCount >= 5, 'absorbed relevant docs, skills, agents, and routing files');
    assert.ok(absorbed.records.some(record => record.recordKind === 'skill'), 'SKILL.md was absorbed');
    assert.ok(absorbed.records.some(record => record.recordKind === 'agent'), '.codex agent was absorbed');
    assert.ok(!absorbed.records.some(record => record.sourcePath.includes('.env')), 'secret env file was excluded');

    const blockedActivation = activateKnowledgeIntegration(cwd, config);
    assert.equal(blockedActivation.ok, false, 'activation is blocked before evaluation');

    const compiled = compileProjectCapabilities(cwd, config);
    assert.ok(compiled.skillCount >= 1, 'skill registry compiled');
    assert.ok(compiled.agentCount >= 1, 'agent registry compiled');
    assert.ok(compiled.routingPolicyCount >= 1, 'routing policy compiled');
    assert.ok(compiled.warnings.some(warning => warning.includes('partial-agent')), 'partial parsing warning was preserved');

    const index = rebuildLocalKnowledgeIndex(cwd, config);
    assert.ok(index.chunks.some(chunk => chunk.sourceId.startsWith('capability:')), 'capability chunks were added to own index');

    const search = searchKnowledge(cwd, 'Codex 스킬 SKILL.md skills-router subagent 라우팅', { sourceTypes: ['project-capability'], limit: 3 }, config);
    assert.ok(search.hits.length > 0, 'project meta query routes to project-capability hits');
    assert.ok(/skills|\.codex|skills-router|codex-subagent-routing/i.test(search.hits[0].sourcePath), 'top hit is project meta knowledge');

    const evaluation = evaluateKnowledgeIntegration(cwd, config);
    assert.ok(evaluation.existingRag.detected, 'existing RAG baseline was detected');
    assert.ok(fs.existsSync(evaluation.tracePath), 'comparison trace was written');
    assert.ok(evaluation.passedSurfaces.includes('capability-routing'), 'capability-routing passed evaluation');

    const activated = activateKnowledgeIntegration(cwd, readKnowledgeConfig(cwd));
    assert.equal(activated.ok, true, 'activation succeeds after eval-gated pass');
    assert.ok(activated.activatedSurfaces.includes('capability-routing'), 'only passed surfaces are activated');

    const hashesAfter = watchedFiles.map(file => hashFile(file));
    assert.deepEqual(hashesAfter, originalHashes, 'source project files were not mutated');

    fs.appendFileSync(path.join(cwd, 'AGENTS.md'), '\nNew source rule.\n', 'utf-8');
    const status = readKnowledgeIntegrationStatus(cwd, readKnowledgeConfig(cwd));
    assert.ok((status.manifest?.staleCount || 0) > 0, 'sourceHash/sourceModifiedAt stale detection works');

    await verifyRoutingDecision(cwd);
    verifyRealProjectWorkflowSkills();
    verifyLostarkPilotIfAvailable();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
