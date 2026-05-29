import * as path from 'path';
import { KnowledgeVaultExportResult } from './types';
import { detectKnowledgeSources, scanKnowledgeDocuments } from './sourceRegistry';
import {
    ensureDir,
    knowledgeVaultDir,
    readKnowledgeConfig,
    readTextFile,
    safeName,
    snippet,
    writeJsonFile,
    writeTextFile,
} from './utils';

export function exportKnowledgeVault(cwd: string): KnowledgeVaultExportResult {
    const config = readKnowledgeConfig(cwd);
    const vaultDir = knowledgeVaultDir(cwd, config);
    const obsidianDir = path.join(vaultDir, 'obsidian');
    const mkdocsDir = path.join(vaultDir, 'mkdocs');
    ensureDir(vaultDir);
    ensureDir(obsidianDir);
    ensureDir(path.join(obsidianDir, '.obsidian'));
    ensureDir(mkdocsDir);

    const detection = detectKnowledgeSources(cwd, config);
    const docs = scanKnowledgeDocuments(cwd, config);
    const manifest = {
        version: 1,
        generatedAt: new Date().toISOString(),
        cwd,
        sourceOfTruthPolicy: 'repo docs, second brain, and existing RAG sources remain authoritative; this vault is derived.',
        sources: detection.sources,
        documents: docs.map(doc => ({
            sourceId: doc.sourceId,
            sourceType: doc.sourceType,
            path: doc.path,
            title: doc.title,
            hash: doc.hash,
            modifiedAt: doc.modifiedAt,
            trustLevel: doc.trustLevel,
            size: doc.size,
        })),
    };

    const manifestPath = path.join(vaultDir, 'manifest.json');
    const llmsPath = path.join(vaultDir, 'llms.txt');
    const llmsFullPath = path.join(vaultDir, 'llms-full.txt');
    writeJsonFile(manifestPath, manifest);
    writeTextFile(llmsPath, renderLlmsTxt(docs));
    writeTextFile(llmsFullPath, renderLlmsFull(docs));
    writeObsidianSettings(obsidianDir);
    writeTextFile(path.join(obsidianDir, 'Index.md'), renderObsidianIndex(docs));

    for (const doc of docs) {
        const noteName = `${safeName(doc.path)}.md`;
        const content = safeReadDoc(doc.absolutePath, 40000);
        writeTextFile(path.join(obsidianDir, noteName), [
            '---',
            `source_path: "${doc.path.replace(/"/g, '\\"')}"`,
            `source_hash: "${doc.hash}"`,
            `source_type: "${doc.sourceType}"`,
            `trust_level: "${doc.trustLevel}"`,
            `modified_at: "${doc.modifiedAt}"`,
            'tags:',
            '  - workflow-knowledge',
            `  - source/${doc.sourceType}`,
            '---',
            '',
            `# ${doc.title}`,
            '',
            `Source: \`${doc.path}\``,
            '',
            content,
        ].join('\n'));
    }

    writeTextFile(path.join(mkdocsDir, 'mkdocs.yml'), [
        'site_name: Workflow Knowledge Vault',
        'docs_dir: docs',
        'nav:',
        '  - Home: index.md',
        '  - LLMs: llms.md',
    ].join('\n') + '\n');
    ensureDir(path.join(mkdocsDir, 'docs'));
    writeTextFile(path.join(mkdocsDir, 'docs', 'index.md'), renderLlmsTxt(docs));
    writeTextFile(path.join(mkdocsDir, 'docs', 'llms.md'), renderLlmsFull(docs));

    return {
        vaultDir,
        manifestPath,
        llmsPath,
        llmsFullPath,
        obsidianDir,
        mkdocsDir,
        documentCount: docs.length,
        sourceCount: detection.sources.length,
    };
}

function writeObsidianSettings(obsidianDir: string): void {
    const obsidianConfigDir = path.join(obsidianDir, '.obsidian');
    writeJsonFile(path.join(obsidianConfigDir, 'app.json'), {
        alwaysUpdateLinks: true,
        newFileLocation: 'current',
        promptDelete: false,
    });
    writeJsonFile(path.join(obsidianConfigDir, 'core-plugins.json'), []);
    writeJsonFile(path.join(obsidianConfigDir, 'graph.json'), {
        'collapse-filter': true,
        search: '',
        showTags: true,
        showAttachments: false,
        hideUnresolved: false,
        showOrphans: true,
    });
}

function renderLlmsTxt(docs: Array<{ path: string; title: string; trustLevel: string; hash: string }>): string {
    const lines = [
        '# Workflow Knowledge',
        '',
        'This file is the first-read LLM index for the project knowledge layer.',
        'Use linked source documents as evidence. Generated vault/index files are derived artifacts, not source of truth.',
        '',
        '## Core Documents',
        ...docs.slice(0, 80).map(doc => `- [${doc.title}](${doc.path}) - trust=${doc.trustLevel}, hash=${doc.hash.slice(0, 12)}`),
        '',
        '## Optional',
        '- Use Obsidian vault notes for human graph browsing.',
        '- Use RAG retrieval for task-specific context with citations.',
    ];
    return lines.join('\n').trim() + '\n';
}

function renderLlmsFull(docs: Array<{ path: string; title: string; absolutePath: string; hash: string }>): string {
    const lines = [
        '# Workflow Knowledge Full Context',
        '',
        'Derived full-context companion to llms.txt. Each section includes a bounded excerpt.',
    ];
    for (const doc of docs) {
        lines.push('', `## ${doc.title}`, '', `Source: ${doc.path}`, `Hash: ${doc.hash}`, '', '```', safeReadDoc(doc.absolutePath, 12000), '```');
    }
    return lines.join('\n').trim() + '\n';
}

function renderObsidianIndex(docs: Array<{ path: string; title: string }>): string {
    return [
        '---',
        'tags:',
        '  - workflow-knowledge',
        '---',
        '',
        '# Workflow Knowledge Vault',
        '',
        'Generated from repository knowledge sources. Source files remain authoritative.',
        '',
        '## Notes',
        ...docs.map(doc => `- [[${safeName(doc.path)}|${doc.title}]] - \`${doc.path}\``),
    ].join('\n').trim() + '\n';
}

function safeReadDoc(abs: string, max: number): string {
    try {
        const text = readTextFile(abs);
        return text.length > max ? `${text.slice(0, max)}\n\n...[truncated]` : text;
    } catch {
        return '';
    }
}
