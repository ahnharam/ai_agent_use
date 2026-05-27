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
    .profile-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.profile{border:1px solid var(--line);border-radius:8px;padding:10px;background:#0d1117;min-height:128px}.profile.active{border-color:var(--accent);box-shadow:0 0 0 1px rgba(88,166,255,.25) inset}.profile-head{display:flex;gap:10px;align-items:center;margin-bottom:6px}.avatar{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;background:#21262d;color:#fff;font-weight:700}.profile b{font-size:13px}.profile p{margin:6px 0 0;color:var(--muted)}.agent-tags{display:flex;gap:6px;flex-wrap:wrap}.agent-tag{border:1px solid var(--line);background:#0d1117;border-radius:999px;padding:4px 8px;color:var(--text)}
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
        <select id="runKind"><option>multiAgent</option><option>gitOperation</option><option>readOnly</option><option>automation</option><option>approvalRequired</option><option>contextControl</option><option>codeChange</option></select>
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
const AGENT_PROFILES=[
  {role:'docs-agent',initial:'D',title:'문서/규칙 분석',summary:'README, 규칙 문서, 컨벤션, 기존 설계 맥락을 읽고 작업 기준을 요약합니다.'},
  {role:'web-researcher',initial:'R',title:'웹 리서치',summary:'최신 정보, 공식 문서, 외부 근거가 필요한 작업에서 웹/검색 기반 조사 결과를 제공합니다.'},
  {role:'git-manager',initial:'G',title:'Git 작업 관리',summary:'브랜치, worktree, 변경 파일, commit, push 승인 흐름과 충돌 상태를 관리합니다.'},
  {role:'designer',initial:'U',title:'디자인/UX',summary:'화면 구조, 시각 계층, 상호작용 상태, 사용자 문구와 디자인 완성도를 담당합니다.'},
  {role:'frontend-coder',initial:'F',title:'프론트엔드 구현',summary:'UI, webview, 클라이언트 상태, CSS, 접근성, 브라우저 동작을 구현합니다.'},
  {role:'backend-coder',initial:'B',title:'백엔드/코어 구현',summary:'워크플로우 엔진, API, 저장소, 런타임, 승인, 큐, Git 정책 같은 코어 로직을 구현합니다.'},
  {role:'qa-agent',initial:'Q',title:'검증/QA',summary:'빌드, 테스트, 동작 확인을 수행하고 실패하면 수정 루프로 되돌립니다.'},
  {role:'doc-writer',initial:'W',title:'작업 요약',summary:'완료된 변경, 검증 결과, 남은 위험을 릴리스 노트 형태로 정리합니다.'},
  {role:'sdk-runtime',initial:'S',title:'SDK 자동 실행',summary:'단순 read-only 분석이나 자동화 run을 빠르게 처리하는 경량 실행 경로입니다.'}
];
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
function promptText(r){return String((r&&r.prompt)||((r&&r.userPrompt)||''))}
function needsResearch(r){return /(latest|current|up-to-date|look up|search|browse|official docs|web에서|웹에서|검색|찾아봐|찾아서|조사|최신|공식\\s*문서|리서치해|research this)/i.test(promptText(r))}
function implementationRolesForRun(r){
  const text=(promptText(r)+'\\n'+JSON.stringify((r&&r.artifacts)||{})).toLowerCase();
  const wantsDesigner=/(designer|design|ux|ui|layout|visual|style|css|figma|wireframe|화면|디자인|스타일|레이아웃|프로필|버튼|카드)/i.test(text);
  const wantsFrontend=wantsDesigner||/(frontend|front-end|front end|webview|html|css|client|react|vue|svelte|browser|electron|sidebar|프론트|웹뷰|브라우저|화면)/i.test(text);
  const wantsBackend=/(backend|back-end|server|api|store|engine|workflow|agent|mcp|sdk|git|database|db|auth|queue|approval|runtime|orchestrat|백엔드|서버|에이전트|워크플로|승인|깃|저장|상태)/i.test(text);
  const roles=[];
  if(wantsDesigner) roles.push('designer');
  if(wantsFrontend) roles.push('frontend-coder');
  if(wantsBackend||roles.length===0) roles.push('backend-coder');
  return roles;
}
function rolesForRun(r){
  const kind=r.runKind||'multiAgent';
  const assigned=(r.artifacts&&Array.isArray(r.artifacts.assignedRoles))?r.artifacts.assignedRoles:[];
  if(assigned.length) return assigned;
  if(kind==='gitOperation') return ['git-manager'];
  if(kind==='readOnly') return (r.selectedRuntime==='sdk'||r.runtime==='sdk')?['sdk-runtime']:(needsResearch(r)?['docs-agent','web-researcher']:['docs-agent']);
  if(kind==='automation') return ['sdk-runtime'];
  const stageRoles=(r.stages||[]).map(s=>s.role).filter(Boolean);
  const base=['docs-agent'].concat(needsResearch(r)?['web-researcher']:[],['git-manager'],implementationRolesForRun(r),['qa-agent','doc-writer']);
  return Array.from(new Set([...stageRoles,...base])).filter(role=>role!=='sdk');
}
function runActionButtons(r){
  const canResume=['idle','failed','blocked','cancelled'].includes(r.status);
  const canCancel=['queued','running','pendingCommitApproval','pendingPushApproval'].includes(r.status);
  const buttons=[];
  if(canResume) buttons.push('<button class="secondary" onclick="resumeRun()">Resume</button>');
  if(canCancel) buttons.push('<button class="danger" onclick="cancelRun()">Cancel</button>');
  return buttons.length?'<div class="row">'+buttons.join('')+'</div>':'<div class="muted">No run actions available</div>';
}
function renderProfiles(activeRoles){
  const active=new Set(activeRoles||[]);
  const profiles=AGENT_PROFILES.filter(a=>active.size===0||a.role!=='sdk-runtime'||active.has(a.role));
  return '<div class="profile-grid">'+profiles.map(a=>'<div class="profile '+(active.has(a.role)?'active':'')+'"><div class="profile-head"><div class="avatar">'+esc(a.initial)+'</div><div><b>'+esc(a.role)+'</b><div class="muted">'+esc(a.title)+'</div></div></div><p>'+esc(a.summary)+'</p></div>').join('')+'</div>';
}
function renderHome(){
  const activeRuns=runs.filter(r=>['running','queued','pendingCommitApproval','pendingPushApproval'].includes(r.status));
  document.getElementById('detail').innerHTML=
    '<div class="card"><h2>Agent Profiles</h2>'+renderProfiles([])+'</div>'
    +'<div class="card"><h2>Active Workflow Agents</h2>'+(activeRuns.length?'<div class="timeline">'+activeRuns.map(r=>'<div class="stage"><b>'+esc((r.prompt||r.userPrompt||'').slice(0,48))+'</b>'+badge(r.status)+'<span class="agent-tags">'+rolesForRun(r).map(role=>'<span class="agent-tag">'+esc(role)+'</span>').join('')+'</span></div>').join('')+'</div>':'<div class="muted">현재 실행 또는 승인 대기 중인 작업이 없습니다.</div>')+'</div>'
    +'<div class="card"><h2>Run Kind Agent Map</h2><div class="timeline">'
    +'<div class="stage"><b>multiAgent</b><span></span><span>docs-agent, web-researcher(필요 시), git-manager, designer/frontend-coder/backend-coder, qa-agent, doc-writer</span></div>'
    +'<div class="stage"><b>gitOperation</b><span></span><span>git-manager</span></div>'
    +'<div class="stage"><b>readOnly</b><span></span><span>docs-agent, web-researcher(필요 시) 또는 sdk-runtime</span></div>'
    +'<div class="stage"><b>automation</b><span></span><span>sdk-runtime</span></div>'
    +'</div></div>';
}
async function refresh(){
  try{
    const h=await api('/api/health');
    const rs=h.runtimeSupport||{};
    document.getElementById('health').textContent='port '+h.port+' · active '+h.activeRuns+' · queued '+h.queuedRuns+' · runtime '+(rs.defaultRuntime||'auto')+' · sdk '+(h.sdkAvailable?'ok':'no');
    runs=await api('/api/runs');
    renderRuns();
    const hashId=decodeURIComponent((location.hash||'').replace(/^#/,''));
    if(hashId&&runs.some(r=>r.id===hashId)&&(!selected||selected.id!==hashId)){await loadRun(hashId);return}
    if(selected) await loadRun(selected.id);
    else renderHome();
  }catch(e){document.getElementById('health').textContent=e.message}
}
function renderRuns(){
  const root=document.getElementById('runs');
  root.innerHTML=runs.map(r=>'<div class="run '+(selected&&selected.id===r.id?'active':'')+'" onclick="loadRun(\\''+r.id.replace(/'/g,'')+'\\')"><div>'+badge(r.status)+' <b>'+esc((r.prompt||r.userPrompt||'').slice(0,70))+'</b></div><div class="id">'+esc(r.id)+'</div><div class="muted">'+esc(runtimeLabel(r))+'</div><div class="muted">'+esc(r.cwd)+'</div></div>').join('')||'<div class="muted">No runs</div>'
}
async function loadRun(id){
  if(location.hash!==('#'+encodeURIComponent(id))) location.hash=encodeURIComponent(id);
  selected=await api('/api/runs/'+encodeURIComponent(id));
  selected.events=await api('/api/runs/'+encodeURIComponent(id)+'/events?limit=80');
  renderRuns();
  renderDetail(selected);
}
function renderDetail(r){
  const approvals=r.approvalRequests||[];
  const pending=approvals.filter(a=>a.status==='pending');
  const agents=Object.values(r.agents||{});
  const requests=r.agentRequests||[];
  const activeRoles=rolesForRun(r);
  document.getElementById('detail').innerHTML=
  '<div class="grid"><div class="card"><h2>Run</h2><div>'+badge(r.status)+' <span class="status">'+esc(runtimeLabel(r))+'</span></div><div class="muted">'+esc(r.id)+'</div><p>'+esc(r.prompt||r.userPrompt)+'</p><div class="muted">source '+esc(r.source||'')+' · mcp '+esc(r.mcpSource||'')+'</div>'+runActionButtons(r)+'</div>'
  +'<div class="card"><h2>Git</h2><pre>'+esc(JSON.stringify(r.git||{},null,2))+'</pre></div></div>'
  +'<div class="card"><h2>Agents Assigned To This Run</h2>'+renderProfiles(activeRoles)+'</div>'
  +'<div class="card"><h2>Worktree</h2><div class="row"><button class="secondary" onclick="mergeBack()">Merge Back</button><button class="secondary" onclick="cleanupWorktree()">Cleanup Worktree</button></div></div>'
  +'<div class="card"><h2>Approvals</h2>'+(pending.map(a=>'<div class="approval"><b>'+esc(a.type)+'</b> '+badge(a.status)+'<p>'+esc(a.summary)+'</p><div class="muted">hash '+esc(a.validationHash||'')+'</div><pre>'+esc(a.diff||'')+'</pre><div class="row"><button onclick="approve(\\''+a.id+'\\')">Approve</button><button class="danger" onclick="reject(\\''+a.id+'\\')">Reject</button></div></div>').join('')||'<div class="muted">No pending approvals</div>')+(approvals.length?'<h2>Approval History</h2><div class="timeline">'+approvals.map(a=>'<div class="stage"><b>'+esc(a.type)+'</b>'+badge(a.status)+'<span>'+esc(a.summary)+'\\n'+esc(a.resolutionReason||'')+'</span></div>').join('')+'</div>':'')+'</div>'
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
window.addEventListener('hashchange',()=>{const id=decodeURIComponent((location.hash||'').replace(/^#/,'')); if(id) loadRun(id); else {selected=null; renderRuns(); renderHome();}});
refresh();
</script>
</body>
</html>`;
}
