export function workflowAppHtml(authToken = ''): string {
    return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codex Workflow App</title>
  <style>
    :root{color-scheme:dark;--bg:#0b0d10;--panel:#12161b;--line:#26303a;--text:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--ok:#3fb950;--warn:#d29922;--bad:#f85149}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:13px/1.45 system-ui,Segoe UI,Arial,sans-serif}
    header{height:54px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid var(--line);background:#0d1117}
    h1{font-size:16px;margin:0} button,input,textarea,select{font:inherit} button{background:#1f6feb;border:0;color:white;border-radius:6px;padding:7px 10px;cursor:pointer} button.secondary{background:#21262d;color:var(--text);border:1px solid var(--line)} button.danger{background:#da3633}
    main{display:grid;grid-template-columns:360px 1fr;min-height:calc(100vh - 54px)}
    aside{border-right:1px solid var(--line);padding:12px;overflow:auto}.content{padding:14px;overflow:auto}
    .newrun{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:12px}
    .newrun input,.newrun textarea{width:100%;background:#0d1117;border:1px solid var(--line);border-radius:6px;color:var(--text);padding:8px;margin:5px 0}.newrun textarea{height:90px;resize:vertical}
    .run{border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px;background:var(--panel);cursor:pointer}.run.active{border-color:var(--accent)} .run .id{font-size:11px;color:var(--muted);word-break:break-all}.status{display:inline-block;border-radius:999px;padding:2px 7px;font-size:11px;background:#30363d;color:var(--text)}.status.running{background:#1f6feb}.status.completed{background:#238636}.status.failed,.status.blocked,.status.cancelled{background:#da3633}.status.queued,.status.pendingCommitApproval,.status.pendingPushApproval{background:#9e6a03}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;min-height:90px}.card h2{font-size:13px;margin:0 0 8px}
    .timeline{display:flex;flex-direction:column;gap:7px}.stage{display:grid;grid-template-columns:150px 110px 1fr;gap:8px;border-bottom:1px solid #1d252d;padding:6px 0}.muted{color:var(--muted)} pre{white-space:pre-wrap;word-break:break-word;background:#0d1117;border:1px solid var(--line);border-radius:8px;padding:10px;max-height:360px;overflow:auto}.approval{border:1px solid var(--warn);border-radius:8px;padding:10px;margin:8px 0;background:#16130b}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  </style>
</head>
<body>
<header><h1>Codex Workflow App</h1><div class="row"><span id="health" class="muted">connecting...</span><button class="secondary" onclick="refresh()">Refresh</button></div></header>
<main>
  <aside>
    <div class="newrun">
      <div class="muted">New Workflow Run</div>
      <input id="cwd" placeholder="cwd, e.g. D:\\\\Github\\\\ai_agent\\\\haram_project" />
      <textarea id="prompt" placeholder="Codex Desktop request or direct workflow task"></textarea>
      <div class="row">
        <select id="mode"><option>fresh</option><option>resume</option><option>compact</option><option>fork</option><option>reset</option></select>
        <select id="runtime"><option>auto</option><option>app-server</option><option>sdk</option></select>
        <select id="runKind"><option>multiAgent</option><option>readOnly</option><option>automation</option><option>approvalRequired</option><option>contextControl</option><option>codeChange</option></select>
        <button onclick="startRun()">Start</button>
      </div>
    </div>
    <div id="runs"></div>
  </aside>
  <section class="content">
    <div id="detail" class="muted">Select a run.</div>
  </section>
</main>
<script>
const TOKEN=${JSON.stringify(authToken)};
let runs=[], selected=null;
async function api(path, opts){
  const headers={'content-type':'application/json'};
  if(TOKEN) headers['x-codex-workflow-token']=TOKEN;
  const r=await fetch(path,{headers,...(opts||{})});
  if(!r.ok) throw new Error(await r.text());
  return r.status===204?null:r.json();
}
function badge(s){return '<span class="status '+String(s||'')+'">'+(s||'unknown')+'</span>'}
function esc(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function runtimeLabel(r){return (r.selectedRuntime||r.runtime||'auto')+' / '+(r.runKind||'multiAgent')}
async function refresh(){
  try{
    const h=await api('/api/health');
    const rs=h.runtimeSupport||{};
    document.getElementById('health').textContent='port '+h.port+' · active '+h.activeRuns+' · queued '+h.queuedRuns+' · runtime '+(rs.defaultRuntime||'auto')+' · sdk '+(h.sdkAvailable?'ok':'no');
    runs=await api('/api/runs');
    renderRuns();
    if(selected) await loadRun(selected.id);
  }catch(e){document.getElementById('health').textContent=e.message}
}
function renderRuns(){
  const root=document.getElementById('runs');
  root.innerHTML=runs.map(r=>'<div class="run '+(selected&&selected.id===r.id?'active':'')+'" onclick="loadRun(\\''+r.id.replace(/'/g,'')+'\\')"><div>'+badge(r.status)+' <b>'+esc((r.prompt||r.userPrompt||'').slice(0,70))+'</b></div><div class="id">'+esc(r.id)+'</div><div class="muted">'+esc(runtimeLabel(r))+'</div><div class="muted">'+esc(r.cwd)+'</div></div>').join('')||'<div class="muted">No runs</div>'
}
async function loadRun(id){
  selected=await api('/api/runs/'+encodeURIComponent(id));
  selected.events=await api('/api/runs/'+encodeURIComponent(id)+'/events?limit=80');
  renderRuns();
  renderDetail(selected);
}
function renderDetail(r){
  const pending=(r.approvalRequests||[]).filter(a=>a.status==='pending');
  const agents=Object.values(r.agents||{});
  const requests=r.agentRequests||[];
  document.getElementById('detail').innerHTML=
  '<div class="grid"><div class="card"><h2>Run</h2><div>'+badge(r.status)+' <span class="status">'+esc(runtimeLabel(r))+'</span></div><div class="muted">'+esc(r.id)+'</div><p>'+esc(r.prompt||r.userPrompt)+'</p><div class="muted">source '+esc(r.source||'')+' · mcp '+esc(r.mcpSource||'')+'</div><div class="row"><button class="secondary" onclick="resumeRun()">Resume</button><button class="danger" onclick="cancelRun()">Cancel</button></div></div>'
  +'<div class="card"><h2>Git</h2><pre>'+esc(JSON.stringify(r.git||{},null,2))+'</pre></div></div>'
  +'<div class="card"><h2>Worktree</h2><div class="row"><button class="secondary" onclick="mergeBack()">Merge Back</button><button class="secondary" onclick="cleanupWorktree()">Cleanup Worktree</button></div></div>'
  +'<div class="card"><h2>Approvals</h2>'+(pending.map(a=>'<div class="approval"><b>'+esc(a.type)+'</b><p>'+esc(a.summary)+'</p><div class="muted">hash '+esc(a.validationHash||'')+'</div><pre>'+esc(a.diff||'')+'</pre><div class="row"><button onclick="approve(\\''+a.id+'\\')">Approve</button><button class="danger" onclick="reject(\\''+a.id+'\\')">Reject</button></div></div>').join('')||'<div class="muted">No pending approvals</div>')+'</div>'
  +'<div class="grid">'+agents.map(a=>'<div class="card"><h2>'+esc(a.role)+'</h2><div>'+badge(a.status)+'</div><div class="muted">'+esc(a.threadId||'no thread')+'</div><pre>'+esc(a.lastSummary||a.lastError||'')+'</pre><div class="row"><button class="secondary" onclick="compactAgent(\\''+a.role+'\\')">Compact</button><button class="secondary" onclick="resetAgent(\\''+a.role+'\\')">Reset</button></div></div>').join('')+'</div>'
  +'<div class="card"><h2>Agent Requests</h2><div class="timeline">'+(requests.map(q=>'<div class="stage"><b>'+esc(q.fromRole+' -> '+q.toRole)+'</b>'+badge(q.status)+'<span>'+esc(q.question)+'\\n'+esc(q.answerSummary||'')+'</span></div>').join('')||'<div class="muted">No agent requests</div>')+'</div></div>'
  +'<div class="card"><h2>Timeline</h2><div class="timeline">'+(r.stages||[]).map(s=>'<div class="stage"><b>'+esc(s.id)+'</b>'+badge(s.status)+'<span>'+esc(s.outputSummary||s.error||s.inputSummary||'')+'</span></div>').join('')+'</div></div>'
  +'<div class="card"><h2>Events</h2><pre>'+esc((r.events||[]).map(e=>e.at+' '+e.type+' '+JSON.stringify(e.payload||{})).join('\\n'))+'</pre></div>'
  +'<div class="card"><h2>Artifacts</h2><pre>'+esc(JSON.stringify(r.artifacts||{},null,2))+'</pre></div>'
}
async function startRun(){
  const cwd=document.getElementById('cwd').value.trim();
  const prompt=document.getElementById('prompt').value.trim();
  const contextMode=document.getElementById('mode').value;
  const runtime=document.getElementById('runtime').value;
  const runKind=document.getElementById('runKind').value;
  await api('/api/runs',{method:'POST',body:JSON.stringify({cwd,prompt,contextMode,runtime,runKind,source:'workflow-app'})});
  document.getElementById('prompt').value='';
  await refresh();
}
async function resumeRun(){await api('/api/runs/'+encodeURIComponent(selected.id)+'/resume',{method:'POST',body:'{}'}); await refresh()}
async function cancelRun(){await api('/api/runs/'+encodeURIComponent(selected.id)+'/cancel',{method:'POST',body:'{}'}); await refresh()}
async function approve(id){await api('/api/approvals/'+encodeURIComponent(id)+'/approve',{method:'POST',body:'{}'}); await refresh()}
async function reject(id){await api('/api/approvals/'+encodeURIComponent(id)+'/reject',{method:'POST',body:'{}'}); await refresh()}
async function compactAgent(role){await api('/api/runs/'+encodeURIComponent(selected.id)+'/agents/'+encodeURIComponent(role)+'/compact',{method:'POST',body:'{}'}); await refresh()}
async function resetAgent(role){await api('/api/runs/'+encodeURIComponent(selected.id)+'/agents/'+encodeURIComponent(role)+'/reset',{method:'POST',body:'{}'}); await refresh()}
async function mergeBack(){await api('/api/runs/'+encodeURIComponent(selected.id)+'/worktree/merge-back',{method:'POST',body:'{}'}); await refresh()}
async function cleanupWorktree(){await api('/api/runs/'+encodeURIComponent(selected.id)+'/worktree/cleanup',{method:'POST',body:'{}'}); await refresh()}
try{const ws=new WebSocket('ws://'+location.host+'/ws?token='+encodeURIComponent(TOKEN)); ws.onmessage=()=>refresh();}catch{}
refresh();
</script>
</body>
</html>`;
}
