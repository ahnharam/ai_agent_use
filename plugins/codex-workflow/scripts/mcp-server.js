#!/usr/bin/env node
'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORT = Number(process.env.CODEX_WORKFLOW_PORT || 48731);
const HOST = process.env.CODEX_WORKFLOW_HOST || '127.0.0.1';
const AUTH_TOKEN = process.env.CODEX_WORKFLOW_AUTH_TOKEN || loadOrCreateAuthToken();
const BASE_URL = `http://${HOST}:${PORT}`;
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(PLUGIN_ROOT, '..', '..');
const CLI_PATH = path.join(PROJECT_ROOT, 'out', 'workflow-app', 'cli.js');

const tools = [
  {
    name: 'start_workflow',
    description: 'Create a Codex Workflow App run for a repository task.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repository/workspace directory.' },
        prompt: { type: 'string', description: 'Task prompt to execute.' },
        contextMode: { type: 'string', enum: ['fresh', 'resume', 'compact', 'fork', 'reset'], default: 'fresh' },
        priority: { type: 'number', default: 0 },
        runtime: { type: 'string', enum: ['auto', 'app-server', 'sdk'], default: 'auto' },
        mode: { type: 'string', enum: ['fresh', 'resume', 'compact', 'fork', 'reset'], description: 'Alias for contextMode.' },
        approvalPolicy: { type: 'string', enum: ['never', 'on-request', 'on-failure', 'untrusted'], default: 'never' },
        runKind: { type: 'string', enum: ['automation', 'readOnly', 'approvalRequired', 'multiAgent', 'contextControl', 'codeChange', 'gitOperation'], default: 'multiAgent' }
      },
      required: ['cwd', 'prompt']
    }
  },
  {
    name: 'list_workflows',
    description: 'List known Codex Workflow App runs.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional status filter.' },
        runtime: { type: 'string', enum: ['auto', 'app-server', 'sdk'], description: 'Optional runtime filter.' }
      }
    }
  },
  {
    name: 'get_workflow_status',
    description: 'Get one workflow run status.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' }
      },
      required: ['runId']
    }
  },
  {
    name: 'open_workflow_app',
    description: 'Open the local Codex Workflow App UI.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' }
      }
    }
  },
  {
    name: 'cancel_workflow',
    description: 'Cancel a workflow run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' }
      },
      required: ['runId']
    }
  }
];

let buffer = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  readMessages();
});

function readMessages() {
  while (true) {
    const sep = buffer.indexOf('\r\n\r\n');
    if (sep < 0) return;
    const header = buffer.slice(0, sep).toString('utf8');
    const match = header.match(/content-length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(sep + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = sep + 4;
    if (buffer.length < start + length) return;
    const body = buffer.slice(start, start + length).toString('utf8');
    buffer = buffer.slice(start + length);
    try {
      const msg = JSON.parse(body);
      void handleMessage(msg);
    } catch (err) {
      log(`Invalid MCP message: ${err.message}`);
    }
  }
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'initialize') {
    return send({
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'codex-workflow', version: '0.1.0' }
      }
    });
  }
  if (msg.method === 'tools/list') {
    return send({ id: msg.id, result: { tools } });
  }
  if (msg.method === 'tools/call') {
    try {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      const result = await callTool(name, args);
      return send({
        id: msg.id,
        result: { content: [{ type: 'text', text: result }] }
      });
    } catch (err) {
      return send({
        id: msg.id,
        result: {
          isError: true,
          content: [{ type: 'text', text: err.message || String(err) }]
        }
      });
    }
  }
  if (msg.id !== undefined) {
    send({ id: msg.id, error: { code: -32601, message: `Unknown method: ${msg.method}` } });
  }
}

async function callTool(name, args) {
  await ensureWorkflowApp();
  if (name === 'start_workflow') {
    const data = await request('POST', '/api/runs', {
      cwd: args.cwd,
      prompt: args.prompt,
      contextMode: args.contextMode || args.mode || 'fresh',
      priority: args.priority || 0,
      runtime: args.runtime || 'auto',
      runKind: args.runKind || 'multiAgent',
      approvalPolicy: args.approvalPolicy || 'never',
      source: 'codex-desktop',
      mcpSource: 'codex-workflow-mcp'
    });
    const run = data.run || {};
    return [
      'Workflow run created.',
      `Run ID: ${data.runId}`,
      `Monitor: ${data.url}`,
      `Status: ${run.status || 'unknown'}`,
      `Runtime: ${run.selectedRuntime || run.runtime || args.runtime || 'auto'}`,
      `Pending approvals: ${(run.approvalRequests || []).filter(a => a.status === 'pending').length}`
    ].join('\n');
  }
  if (name === 'list_workflows') {
    const qs = args.status ? `?status=${encodeURIComponent(args.status)}` : '';
    const runs = await request('GET', `/api/runs${qs}`);
    const filtered = args.runtime ? runs.filter(r => r.runtime === args.runtime || r.selectedRuntime === args.runtime) : runs;
    return filtered.length ? filtered.map(formatRun).join('\n') : 'No workflow runs found.';
  }
  if (name === 'get_workflow_status') {
    const run = await request('GET', `/api/runs/${encodeURIComponent(args.runId)}`);
    return JSON.stringify(slimRun(run), null, 2);
  }
  if (name === 'open_workflow_app') {
    const url = `${BASE_URL}/${args.runId ? `#${encodeURIComponent(args.runId)}` : ''}`;
    openUrl(url);
    return `Workflow App opened: ${url}`;
  }
  if (name === 'cancel_workflow') {
    await request('POST', `/api/runs/${encodeURIComponent(args.runId)}/cancel`, {});
    return `Workflow run cancelled: ${args.runId}`;
  }
  throw new Error(`Unknown tool: ${name}`);
}

function formatRun(run) {
  const prompt = String(run.prompt || run.userPrompt || '').replace(/\s+/g, ' ').slice(0, 90);
  return `${run.id} | ${run.status} | ${run.cwd} | ${prompt}`;
}

function slimRun(run) {
  return {
    id: run.id,
    status: run.status,
    cwd: run.cwd,
    prompt: run.prompt || run.userPrompt,
    stages: run.stages,
    agents: run.agents,
    approvals: run.approvalRequests,
    agentRequests: run.agentRequests,
    runtime: run.runtime,
    selectedRuntime: run.selectedRuntime,
    runtimeVersion: run.runtimeVersion,
    runKind: run.runKind,
    pendingApprovals: (run.approvalRequests || []).filter(a => a.status === 'pending').length,
    git: run.git,
    artifacts: run.artifacts
  };
}

async function ensureWorkflowApp() {
  try {
    const health = await request('GET', '/api/health', null, 700);
    if (health && health.runtimeSupport) return;
    throw new Error('Workflow App backend is running an older build; restart it so MCP can use runtime-aware APIs.');
  } catch {
    // start below
  }
  if (!require('fs').existsSync(CLI_PATH)) {
    throw new Error(`Workflow App backend is not built. Run npm run compile in ${PROJECT_ROOT}`);
  }
  const child = spawn(process.execPath, [CLI_PATH], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, CODEX_WORKFLOW_PORT: String(PORT), CODEX_WORKFLOW_AUTH_TOKEN: AUTH_TOKEN }
  });
  child.unref();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(300);
    try {
      const health = await request('GET', '/api/health', null, 700);
      if (health && health.runtimeSupport) return;
    } catch {
      // keep polling
    }
  }
  throw new Error('Workflow App backend did not become ready.');
}

function request(method, route, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      host: HOST,
      port: PORT,
      path: route,
      method,
      timeout: timeoutMs,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        'x-codex-workflow-token': AUTH_TOKEN
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(text || `HTTP ${res.statusCode}`));
        try { resolve(text ? JSON.parse(text) : null); }
        catch { resolve(text); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function openUrl(url) {
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(message) {
  process.stderr.write(`[codex-workflow] ${message}\n`);
}

function loadOrCreateAuthToken() {
  const p = path.join(os.homedir(), '.codex-workflow', 'token');
  try {
    if (fs.existsSync(p)) {
      const existing = fs.readFileSync(p, 'utf8').trim();
      if (existing) return existing;
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const token = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(p, token, 'utf8');
    return token;
  } catch {
    return crypto.randomBytes(24).toString('hex');
  }
}
