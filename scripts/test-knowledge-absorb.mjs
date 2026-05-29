import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';

const repoRoot = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-knowledge-test-'));
const outFile = path.join(outDir, 'absorb.test.cjs');

esbuild.buildSync({
  entryPoints: [path.join(repoRoot, 'src', 'workflowCore', 'knowledge', 'absorb.test.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outFile,
  external: ['vscode', '@openai/codex-sdk', '@modelcontextprotocol/sdk'],
});

const require = createRequire(import.meta.url);
require(outFile);
