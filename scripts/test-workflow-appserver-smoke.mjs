import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const HOST = process.env.CODEX_WORKFLOW_HOST || '127.0.0.1';
const PORT = Number(process.env.CODEX_WORKFLOW_PORT || 48731);
const CWD = process.env.CODEX_WORKFLOW_PROJECT_ROOT || process.cwd();
const WALL_TIMEOUT_MS = Number(process.env.WORKFLOW_SMOKE_WALL_TIMEOUT_MS || 15 * 60 * 1000);
const IDLE_TIMEOUT_MS = Number(process.env.WORKFLOW_SMOKE_IDLE_TIMEOUT_MS || 4 * 60 * 1000);
const POLL_MS = Number(process.env.WORKFLOW_SMOKE_POLL_MS || 5000);

const token = process.env.CODEX_WORKFLOW_AUTH_TOKEN || readToken();
if (!token) throw new Error('Missing CODEX_WORKFLOW_AUTH_TOKEN and ~/.codex-workflow/token.');

const created = await requestJson('POST', '/api/runs', {
  cwd: CWD,
  runKind: 'readOnly',
  runtime: 'app-server',
  source: 'workflow-appserver-smoke',
  prompt: '읽기 전용 app-server smoke test입니다. 파일을 수정하지 말고 Knowledge Routing Trace와 Workflow App 검증 근거를 한국어 한 문단으로 요약해줘.',
});

const runId = created.runId;
const startedAt = Date.now();
let lastProgressAt = Date.now();
let lastSignature = '';
let run = created.run;

while (Date.now() - startedAt < WALL_TIMEOUT_MS) {
  await sleep(POLL_MS);
  run = await requestJson('GET', `/api/runs/${encodeURIComponent(runId)}`);
  const events = await requestJson('GET', `/api/runs/${encodeURIComponent(runId)}/events?limit=500`);
  const signature = progressSignature(run, events);
  if (signature !== lastSignature) {
    lastSignature = signature;
    lastProgressAt = Date.now();
  }
  if (isTerminal(run.status)) break;
  if (Date.now() - lastProgressAt > IDLE_TIMEOUT_MS) {
    await cancel(runId, 'idle-timeout');
    run = await requestJson('GET', `/api/runs/${encodeURIComponent(runId)}`);
    break;
  }
}

if (!isTerminal(run.status)) {
  await cancel(runId, 'wall-timeout');
  run = await requestJson('GET', `/api/runs/${encodeURIComponent(runId)}`);
}

const routingTrace = path.join(CWD, '.ai-agent', 'runs', `${runId}.knowledge-routing.trace.json`);
const ragTrace = path.join(CWD, '.ai-agent', 'runs', `${runId}.rag.trace.jsonl`);
const result = {
  runId,
  status: run.status,
  selectedRuntime: run.selectedRuntime,
  executionProfile: run.artifacts?.knowledgeRouting?.executionProfile,
  selectedWorkers: run.artifacts?.knowledgeRouting?.selectedWorkers || [],
  coordinatorRole: run.artifacts?.knowledgeRouting?.coordinatorRole,
  cancelSource: run.artifacts?.cancelSource,
  cancelReason: run.artifacts?.cancelReason,
  routingTraceExists: fs.existsSync(routingTrace),
  ragTraceExists: fs.existsSync(ragTrace),
};

console.log(JSON.stringify(result, null, 2));
if (run.status !== 'completed') process.exitCode = 1;
if (!result.routingTraceExists || !result.ragTraceExists) process.exitCode = 1;

function progressSignature(value, events) {
  const stageSig = (value.stages || []).map(stage => [
    stage.id,
    stage.status,
    stage.startedAt || '',
    stage.finishedAt || '',
    stage.outputSummary || '',
    stage.error || '',
  ].join(':')).join('|');
  const traceSig = [
    fileMtimeMs(path.join(CWD, '.ai-agent', 'runs', `${value.id}.knowledge-routing.trace.json`)),
    fileMtimeMs(path.join(CWD, '.ai-agent', 'runs', `${value.id}.rag.trace.jsonl`)),
  ].join('|');
  return [value.status, events.length, stageSig, traceSig].join('\n');
}

function isTerminal(status) {
  return ['completed', 'failed', 'blocked', 'cancelled'].includes(status);
}

async function cancel(id, reason) {
  await requestJson('POST', `/api/runs/${encodeURIComponent(id)}/cancel`, {
    source: 'smoke-watchdog',
    reason,
  });
}

function fileMtimeMs(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

function readToken() {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.codex-workflow', 'token'), 'utf-8').trim();
  } catch {
    return '';
  }
}

function requestJson(method, route, body) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf-8');
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST,
      port: PORT,
      path: route,
      method,
      timeout: 30000,
      headers: {
        'x-codex-workflow-token': token,
        ...(payload ? { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length } : {}),
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if ((res.statusCode || 500) >= 400) reject(new Error(`${method} ${route} failed ${res.statusCode}: ${text}`));
        else resolve(text ? JSON.parse(text) : {});
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${method} ${route} timed out`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
