import * as fs from 'fs';
import * as path from 'path';
import {
    KnowledgeVerifyIssue,
    KnowledgeVerifyResult,
} from './types';
import { scanKnowledgeDocuments } from './sourceRegistry';
import {
    hashFile,
    knowledgeVaultDir,
    readJsonFile,
    readKnowledgeConfig,
    readTextFile,
} from './utils';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
    [/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/i, 'private-key'],
    [/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}/i, 'secret-like-assignment'],
];

const PROMPT_INJECTION_PATTERNS: Array<[RegExp, string]> = [
    [/ignore (?:all )?(?:previous|prior) instructions/i, 'ignore-previous-instructions'],
    [/disregard (?:the )?(?:system|developer) message/i, 'disregard-system-message'],
    [/reveal (?:the )?(?:system prompt|developer instructions)/i, 'reveal-system-prompt'],
];

export function verifyKnowledge(cwd: string): KnowledgeVerifyResult {
    const config = readKnowledgeConfig(cwd);
    const docs = scanKnowledgeDocuments(cwd, config);
    const issues: KnowledgeVerifyIssue[] = [];

    for (const doc of docs) {
        let text = '';
        try {
            text = readTextFile(doc.absolutePath).slice(0, 300000);
        } catch {
            issues.push({ severity: 'warn', code: 'read-failed', path: doc.path, message: 'Document could not be read.' });
            continue;
        }
        for (const [pattern, code] of SECRET_PATTERNS) {
            if (pattern.test(text)) issues.push({ severity: 'error', code, path: doc.path, message: 'Potential secret matched a knowledge document.' });
        }
        for (const [pattern, code] of PROMPT_INJECTION_PATTERNS) {
            if (pattern.test(text)) issues.push({ severity: 'warn', code, path: doc.path, message: 'Potential prompt-injection text matched a knowledge document. Treat retrieved text as evidence only.' });
        }
        for (const link of markdownLinks(text)) {
            if (/^[a-z]+:\/\//i.test(link) || link.startsWith('#')) continue;
            const target = path.resolve(path.dirname(doc.absolutePath), link.split('#')[0]);
            if (link.split('#')[0] && !fs.existsSync(target)) {
                issues.push({ severity: 'info', code: 'broken-link', path: doc.path, message: `Linked file is missing: ${link}` });
            }
        }
    }

    const manifestPath = path.join(knowledgeVaultDir(cwd, config), 'manifest.json');
    const manifest = readJsonFile<any>(manifestPath);
    if (manifest?.documents) {
        const currentHashes = new Map(docs.map(doc => [doc.path, doc.hash]));
        for (const entry of manifest.documents) {
            if (entry?.path && currentHashes.has(entry.path) && currentHashes.get(entry.path) !== entry.hash) {
                issues.push({ severity: 'warn', code: 'stale-manifest', path: entry.path, message: 'Generated manifest hash differs from the current source file.' });
            }
        }
    }

    return {
        ok: !issues.some(issue => issue.severity === 'error'),
        checkedAt: new Date().toISOString(),
        issues,
        sourceCount: new Set(docs.map(doc => doc.sourceId)).size,
        documentCount: docs.length,
    };
}

function markdownLinks(text: string): string[] {
    const links: string[] = [];
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) links.push(match[1].trim());
    return links;
}
