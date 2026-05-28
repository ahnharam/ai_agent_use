export function workflowAppHtml(): string {
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
    h1{font-size:16px;margin:0} h2{font-size:13px;margin:0 0 8px} button,input,textarea,select{font:inherit}
    button{background:#1f6feb;border:0;color:white;border-radius:6px;padding:7px 10px;cursor:pointer} button.secondary{background:#21262d;color:var(--text);border:1px solid var(--line)} button.danger{background:#da3633} button:disabled{opacity:.5;cursor:not-allowed}
    main{display:grid;grid-template-columns:360px 1fr;min-height:calc(100vh - 54px)} aside{border-right:1px solid var(--line);padding:12px;overflow:auto}.content{padding:14px;overflow:auto}
    .newrun{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:12px}.newrun input,.newrun textarea{width:100%;background:#0d1117;border:1px solid var(--line);border-radius:6px;color:var(--text);padding:8px;margin:5px 0}.newrun textarea{height:90px;resize:vertical}
    .run{border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px;background:var(--panel);cursor:pointer}.run.active{border-color:var(--accent)}.run .id{font-size:11px;color:var(--muted);word-break:break-all}
    .status{display:inline-block;border-radius:999px;padding:2px 7px;font-size:11px;background:#30363d;color:var(--text)}.status.running{background:#1f6feb}.status.completed,.status.ok{background:#238636}.status.failed,.status.blocked,.status.cancelled,.status.fail{background:#da3633}.status.queued,.status.pendingCommitApproval,.status.pendingPushApproval,.status.warn,.status.unknown{background:#9e6a03}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;min-height:90px;margin-bottom:10px}
    .timeline{display:flex;flex-direction:column;gap:7px}.stage{display:grid;grid-template-columns:150px 110px 1fr;gap:8px;border-bottom:1px solid #1d252d;padding:6px 0}.muted{color:var(--muted)} pre{white-space:pre-wrap;word-break:break-word;background:#0d1117;border:1px solid var(--line);border-radius:8px;padding:10px;max-height:360px;overflow:auto}
    .approval{border:1px solid var(--warn);border-radius:8px;padding:10px;margin:8px 0;background:#16130b}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .lang-toggle{display:flex;gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#0d1117}.lang-toggle button{border:0;border-radius:0;padding:6px 9px;min-width:64px;background:#21262d;color:var(--muted)}.lang-toggle button+button{border-left:1px solid var(--line)}.lang-toggle button.active{background:#1f6feb;color:#fff}
    .profile-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.profile{border:1px solid var(--line);border-radius:8px;padding:10px;background:#0d1117;min-height:128px}.profile.active{border-color:var(--accent);box-shadow:0 0 0 1px rgba(88,166,255,.25) inset}.profile-head{display:flex;gap:10px;align-items:center;margin-bottom:6px}.avatar{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;background:#21262d;color:#fff;font-weight:700}.profile p{margin:6px 0 0;color:var(--muted)}.agent-tags{display:flex;gap:6px;flex-wrap:wrap}.agent-tag{border:1px solid var(--line);background:#0d1117;border-radius:999px;padding:4px 8px;color:var(--text)}
    .diagnostics{display:flex;flex-direction:column;gap:8px}.diag{display:grid;grid-template-columns:210px 90px 1fr;gap:10px;align-items:start;border:1px solid var(--line);border-radius:8px;padding:10px;background:#0d1117}.diag.ok{border-color:rgba(63,185,80,.45)}.diag.warn,.diag.unknown{border-color:rgba(210,153,34,.55)}.diag.fail{border-color:rgba(248,81,73,.55)}.diag .fix{margin-top:4px;color:var(--warn)}
    .docs-editor{width:100%;min-height:320px;background:#0d1117;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:10px;font-family:Consolas,monospace}.doc-table{display:grid;grid-template-columns:minmax(180px,2fr) 110px 90px 90px minmax(180px,1.4fr);gap:8px;align-items:start}.doc-row{display:contents}.doc-row>*{border-bottom:1px solid #1d252d;padding:6px 0}.doc-actions{margin:8px 0 12px}
  </style>
</head>
<body>
<header><h1 id="appTitle">Codex Workflow App</h1><div class="row"><span id="health" class="muted">connecting...</span><button id="docsButton" class="secondary" onclick="showDocs()">문서 설정</button><button id="diagnosticsButton" class="secondary" onclick="showDiagnostics()">Diagnostics</button><button id="refreshButton" class="secondary" onclick="refresh()">Refresh</button><div class="lang-toggle" role="group" aria-label="Language"><button id="langKo" class="secondary lang-choice" type="button" onclick="setLanguage('ko')">한국어</button><button id="langEn" class="secondary lang-choice" type="button" onclick="setLanguage('en')">English</button></div></div></header>
<main>
  <aside>
    <div class="newrun">
      <div id="newRunLabel" class="muted">New Workflow Run</div>
      <input id="cwd" placeholder="cwd, e.g. D:\\\\Github\\\\ai_agent\\\\haram_project" />
      <textarea id="prompt" placeholder="Codex Desktop request or direct workflow task"></textarea>
      <div class="row">
        <select id="mode"><option value="fresh">fresh</option><option value="resume">resume</option><option value="compact">compact</option><option value="fork">fork</option><option value="reset">reset</option></select>
        <select id="runtime"><option value="auto">auto</option><option value="app-server">app-server</option><option value="sdk">sdk</option></select>
        <select id="runKind"><option value="multiAgent">multiAgent</option><option value="gitOperation">gitOperation</option><option value="readOnly">readOnly</option><option value="automation">automation</option><option value="approvalRequired">approvalRequired</option><option value="contextControl">contextControl</option><option value="codeChange">codeChange</option></select>
        <button id="startButton" onclick="startRun()">Start</button>
      </div>
    </div>
    <div id="runs"></div>
  </aside>
  <section class="content">
    <div id="detail" class="muted">Select a run.</div>
  </section>
</main>
<script>
let runs=[], selected=null, view='home';
let docsState={cwd:'',profile:null,cache:null,recommendation:null,error:''};
const LANGUAGE_KEY='codexWorkflowLanguage';
let language=localStorage.getItem(LANGUAGE_KEY)||'ko';
const I18N={
  ko:{
    appTitle:'Codex 워크플로우 앱',connecting:'연결 중...',diagnostics:'진단',refresh:'새로고침',newRun:'새 워크플로우 실행',cwdPlaceholder:'cwd 예: D:\\\\Github\\\\ai_agent\\\\haram_project',promptPlaceholder:'Codex Desktop 요청 또는 직접 실행할 워크플로우 작업',start:'시작',selectRun:'실행 항목을 선택하세요.',
    noRunActions:'사용 가능한 실행 작업이 없습니다',resume:'재개',cancel:'취소',noContextActions:'사용 가능한 컨텍스트 작업이 없습니다',compact:'압축',reset:'초기화',mergeBack:'원본에 병합',cleanupWorktree:'워크트리 정리',
    agentProfiles:'에이전트 프로필',activeWorkflowAgents:'현재 작업에 투입된 에이전트',noActiveRuns:'실행 중, 대기 중, 승인 대기 중인 작업이 없습니다.',runKindAgentMap:'작업 종류별 에이전트 구성',run:'작업',taskDetails:'작업 내용',git:'Git',assignedAgents:'이 작업에 투입된 에이전트',worktree:'워크트리',approvals:'승인 요청',noPendingApprovals:'대기 중인 승인 요청이 없습니다',approvalHistory:'승인 이력',approve:'승인',reject:'거절',agentRequests:'에이전트 간 요청',noAgentRequests:'에이전트 간 요청이 없습니다',timeline:'타임라인',events:'이벤트',artifacts:'산출물',generated:'생성 시각',source:'출처',mcp:'MCP',noThread:'thread 없음',
    healthPort:'포트',healthActive:'실행',healthWaiting:'승인대기',healthQueued:'큐',healthRuntime:'런타임',healthSdk:'SDK',sdkOk:'정상',sdkNo:'없음',
    mapMulti:'docs-agent, 필요 시 web-researcher, git-manager, designer/frontend-coder/backend-coder, qa-agent, doc-writer',
    mapGit:'git-manager',
    mapReadOnly:'docs-agent, 필요 시 web-researcher 또는 sdk-runtime',
    mapAutomation:'sdk-runtime',
    noRuns:'실행 기록이 없습니다',noArtifacts:'표시할 산출물이 없습니다',rawArtifacts:'원본 산출물 JSON',
    status:{running:'실행 중',completed:'완료',failed:'실패',blocked:'차단됨',cancelled:'취소됨',queued:'대기 중',pendingCommitApproval:'커밋 승인 대기',pendingPushApproval:'푸시 승인 대기',pending:'대기 중',approved:'승인됨',rejected:'거절됨',idle:'대기',ok:'정상',warn:'경고',fail:'실패',unknown:'알 수 없음'},
    stageLabels:{docs:'문서/규칙 확인','web-research':'웹 리서치','git-plan':'Git 계획','design':'디자인','frontend-code':'프론트엔드 구현','backend-code':'백엔드 구현',qa:'QA 검증',docs2:'문서 정리','git-inspect':'Git 상태 점검','sdk-run':'SDK 실행'},
    eventLabels:{'run.created':'작업 생성','runtime.selected':'런타임 선택','run.started':'작업 시작','workflow.state':'상태 변경','workflow.log':'로그','gitOperation.started':'Git 작업 시작','gitOperation.inspected':'Git 상태 점검 완료','git.push.started':'푸시 시작','git.push.completed':'푸시 완료','git.push.failed':'푸시 실패','approval.commit.blocked':'커밋 승인 차단','approval.push.blocked':'푸시 승인 차단','agentRequest.created':'에이전트 요청 생성','agentRequest.answered':'에이전트 요청 답변','agentRequest.failed':'에이전트 요청 실패','codex.event':'Codex 이벤트'},
    artifactLabels:{docsSummary:'문서/규칙 요약',webResearchSummary:'웹 리서치 요약',gitPlan:'Git 계획',coderSummary:'코딩 요약',designerSummary:'디자인 요약',frontendSummary:'프론트엔드 요약',backendSummary:'백엔드 요약',qaSummary:'QA 요약',qaEvidence:'QA 근거',docSummary:'문서 정리 요약',finalSummary:'최종 요약',lastDiff:'마지막 diff',assignedRoles:'투입 에이전트'},
    diagnosticsLabels:{
      node:'Node.js',npm:'npm',git:'Git','codex-executable':'Codex 실행 파일','codex-app-server':'Codex app-server','codex-sdk':'Codex SDK','build-output':'빌드 산출물','marketplace-file':'마켓플레이스 파일','local-token':'로컬 토큰','git-credential':'Git 인증 힌트','codex-marketplace-registration':'Codex 마켓플레이스 등록','codex-plugin-activation':'Codex 플러그인 활성화'
    },
    diagnosticsRemediation:{
      node:'Node.js 20.19 이상을 설치한 뒤 다시 실행하세요.',npm:'npm을 사용할 수 있도록 Node.js 설치를 확인하세요.',git:'Git을 설치하고 PATH에 추가하세요.','codex-executable':'설정 파일 또는 setup 스크립트에서 실행 가능한 codex.exe 경로를 지정하세요.','codex-app-server':'Codex를 업데이트하거나 실행 파일 경로를 다시 확인하세요.','codex-sdk':'npm ci 후 다시 빌드하세요.','build-output':'npm run compile을 실행하세요.','marketplace-file':'setup 스크립트로 로컬 마켓플레이스를 등록하세요.','local-token':'앱을 한 번 실행해 토큰 파일을 생성하세요.','git-credential':'GitHub push는 Codex 로그인과 별개로 로컬 git credential이 필요합니다.','codex-marketplace-registration':'codex plugin marketplace add "<repo 경로>"를 실행하세요.','codex-plugin-activation':'Codex Desktop을 재시작한 뒤 Plugins 화면에서 Codex Workflow를 설치/활성화하세요.'
    }
  },
  en:{
    appTitle:'Codex Workflow App',connecting:'connecting...',diagnostics:'Diagnostics',refresh:'Refresh',newRun:'New Workflow Run',cwdPlaceholder:'cwd, e.g. D:\\\\Github\\\\ai_agent\\\\haram_project',promptPlaceholder:'Codex Desktop request or direct workflow task',start:'Start',selectRun:'Select a run.',
    noRunActions:'No run actions available',resume:'Resume',cancel:'Cancel',noContextActions:'No context actions available',compact:'Compact',reset:'Reset',mergeBack:'Merge Back',cleanupWorktree:'Cleanup Worktree',
    agentProfiles:'Agent Profiles',activeWorkflowAgents:'Active Workflow Agents',noActiveRuns:'No running, queued, or approval-waiting runs.',runKindAgentMap:'Run Kind Agent Map',run:'Run',taskDetails:'Task Details',git:'Git',assignedAgents:'Agents Assigned To This Run',worktree:'Worktree',approvals:'Approvals',noPendingApprovals:'No pending approvals',approvalHistory:'Approval History',approve:'Approve',reject:'Reject',agentRequests:'Agent Requests',noAgentRequests:'No agent requests',timeline:'Timeline',events:'Events',artifacts:'Artifacts',generated:'Generated',source:'source',mcp:'mcp',noThread:'no thread',
    healthPort:'port',healthActive:'active',healthWaiting:'waiting',healthQueued:'queued',healthRuntime:'runtime',healthSdk:'sdk',sdkOk:'ok',sdkNo:'no',
    mapMulti:'docs-agent, optional web-researcher, git-manager, designer/frontend-coder/backend-coder, qa-agent, doc-writer',
    mapGit:'git-manager',
    mapReadOnly:'docs-agent, optional web-researcher, or sdk-runtime',
    mapAutomation:'sdk-runtime',
    noRuns:'No runs',noArtifacts:'No artifacts',rawArtifacts:'Raw Artifacts JSON',
    status:{running:'running',completed:'completed',failed:'failed',blocked:'blocked',cancelled:'cancelled',queued:'queued',pendingCommitApproval:'pending commit approval',pendingPushApproval:'pending push approval',pending:'pending',approved:'approved',rejected:'rejected',idle:'idle',ok:'ok',warn:'warn',fail:'fail',unknown:'unknown'},
    stageLabels:{},eventLabels:{},artifactLabels:{},
    diagnosticsLabels:{},
    diagnosticsRemediation:{}
  }
};
const AGENT_PROFILES=[
  {role:'docs-agent',initial:'D',title:{ko:'문서와 규칙',en:'Docs and rules'},summary:{ko:'저장소 규칙, README, 패키지 메타데이터, 컨벤션을 읽고 작업 제약과 구현 기준을 정리합니다.',en:'Reads repository rules, README files, package metadata, and conventions. Returns task constraints and implementation guidance.'}},
  {role:'web-researcher',initial:'R',title:{ko:'웹 리서치',en:'Web research'},summary:{ko:'최신 외부 정보나 공식 문서 확인이 필요할 때 읽기 전용으로 조사하고 가능한 경우 출처 링크를 남깁니다.',en:'Checks current external information and official docs when the task needs fresh facts. It stays read-only and cites source links when available.'}},
  {role:'git-manager',initial:'G',title:{ko:'Git 작업',en:'Git operations'},summary:{ko:'브랜치, 워크트리, 커밋, 푸시, 충돌 안전성을 계획합니다. 푸시와 병합은 항상 앱 승인 후 진행합니다.',en:'Plans branch, worktree, commit, push, and conflict safety. Push and merge actions always wait for app approval.'}},
  {role:'designer',initial:'U',title:{ko:'UI/UX 디자인',en:'UI and UX'},summary:{ko:'레이아웃, 시각 계층, 상호작용 상태, 접근성, 사용자에게 보이는 문구를 담당합니다.',en:'Owns layout, visual hierarchy, interaction states, accessibility, and user-facing copy for product surfaces.'}},
  {role:'frontend-coder',initial:'F',title:{ko:'프론트엔드 코딩',en:'Frontend coding'},summary:{ko:'브라우저, 웹뷰, Electron, 클라이언트 상태, CSS, 화면 동작을 구현합니다.',en:'Implements browser, webview, Electron, client state, CSS, and visible UI behavior.'}},
  {role:'backend-coder',initial:'B',title:{ko:'백엔드 코딩',en:'Backend coding'},summary:{ko:'오케스트레이션, API, 저장소, 런타임 어댑터, 큐, 인증, 승인, Git 정책 로직을 구현합니다.',en:'Implements orchestration, APIs, persistence, runtime adapters, queues, auth, approvals, and git policy logic.'}},
  {role:'qa-agent',initial:'Q',title:{ko:'QA 검증',en:'QA verification'},summary:{ko:'필요한 빌드와 동작 검증을 실행하고 근거를 남기며, 실패 시 수정 루프로 돌려보냅니다.',en:'Runs the relevant build and behavior checks, reports evidence, and sends failed work back through repair loops.'}},
  {role:'doc-writer',initial:'W',title:{ko:'작업 요약',en:'Work summary'},summary:{ko:'작업 완료 후 릴리즈 노트, 검증 내용, 남은 위험을 간결하게 정리합니다.',en:'Writes concise release notes, verification notes, and remaining risk after the run is complete.'}},
  {role:'sdk-runtime',initial:'S',title:{ko:'SDK 런타임',en:'SDK runtime'},summary:{ko:'백엔드가 SDK 경로를 선택한 가벼운 읽기 전용 또는 자동화 작업을 처리합니다.',en:'Handles lightweight read-only or automation runs when the backend selected the SDK path.'}}
];
function tx(key){return (I18N[language]&&I18N[language][key])||I18N.en[key]||key}
function localText(value){return value&&typeof value==='object'?(value[language]||value.en||''):value}
function setSelectLabels(id, options){
  const el=document.getElementById(id);
  if(!el) return;
  const current=el.value;
  el.innerHTML=options.map(o=>'<option value="'+esc(o.value)+'">'+esc(o.label)+'</option>').join('');
  el.value=current||options[0].value;
}
function modeLabel(value){
  if(language==='en') return value;
  return ({fresh:'fresh - 새 컨텍스트',resume:'resume - 이어서',compact:'compact - 압축 후 이어서',fork:'fork - 분기',reset:'reset - 초기화'}[value]||value);
}
function runKindLabel(value){
  if(language==='en') return value;
  return ({multiAgent:'multiAgent - 멀티 에이전트',gitOperation:'gitOperation - Git 작업',readOnly:'readOnly - 읽기 전용',automation:'automation - 자동화',approvalRequired:'approvalRequired - 승인 필요',contextControl:'contextControl - 컨텍스트 제어',codeChange:'codeChange - 코드 변경'}[value]||value);
}
function renderShellText(){
  document.documentElement.lang=language;
  document.title=tx('appTitle');
  document.getElementById('appTitle').textContent=tx('appTitle');
  document.getElementById('docsButton').textContent=language==='ko'?'문서 설정':'Documents';
  document.getElementById('diagnosticsButton').textContent=tx('diagnostics');
  document.getElementById('refreshButton').textContent=tx('refresh');
  document.getElementById('newRunLabel').textContent=tx('newRun');
  document.getElementById('cwd').placeholder=tx('cwdPlaceholder');
  document.getElementById('prompt').placeholder=tx('promptPlaceholder');
  document.getElementById('startButton').textContent=tx('start');
  const health=document.getElementById('health');
  if(health&&['connecting...','연결 중...'].includes(health.textContent||'')) health.textContent=tx('connecting');
  const detail=document.getElementById('detail');
  if(detail&&['Select a run.','실행 항목을 선택하세요.'].includes(detail.textContent||'')) detail.textContent=tx('selectRun');
  document.getElementById('langKo').classList.toggle('active',language==='ko');
  document.getElementById('langEn').classList.toggle('active',language==='en');
  setSelectLabels('mode',['fresh','resume','compact','fork','reset'].map(v=>({value:v,label:modeLabel(v)})));
  setSelectLabels('runtime',['auto','app-server','sdk'].map(v=>({value:v,label:v})));
  setSelectLabels('runKind',['multiAgent','gitOperation','readOnly','automation','approvalRequired','contextControl','codeChange'].map(v=>({value:v,label:runKindLabel(v)})));
}
function setLanguage(next){
  language=next==='en'?'en':'ko';
  localStorage.setItem(LANGUAGE_KEY,language);
  renderShellText();
  renderRuns();
  if(selected) renderDetail(selected);
  else if(view==='diagnostics') void showDiagnostics(false);
  else if(view==='docs') void showDocs(false);
  else renderHome();
}
async function api(path, opts){
  const headers={'content-type':'application/json'};
  const r=await fetch(path,{headers,credentials:'same-origin',...(opts||{})});
  if(!r.ok) throw new Error(await r.text());
  return r.status===204?null:r.json();
}
function statusText(s){
  const key=String(s||'unknown');
  return (I18N[language].status&&I18N[language].status[key])||key;
}
function badge(s){return '<span class="status '+String(s||'')+'">'+esc(statusText(s))+'</span>'}
function diagBadge(s){return '<span class="status '+String(s||'')+'">'+esc(statusText(s))+'</span>'}
function esc(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function localizedStage(id){
  if(language==='ko') return I18N.ko.stageLabels[id]||id;
  return id;
}
function localizedEventType(type){
  if(language==='ko') return I18N.ko.eventLabels[type]||type;
  return type;
}
function localizedArtifactLabel(key){
  if(language==='ko') return I18N.ko.artifactLabels[key]||key;
  return key;
}
function localizedText(value){
  const text=String(value||'');
  if(language!=='ko'||!text) return text;
  return text
    .replace(/^Use Workflow App gitOperation to commit and push (.+)\.?$/m,'Workflow App Git 작업으로 다음 변경을 커밋하고 푸시: $1')
    .replace(/Git operation inspected ([^.\\n]+)\./g,'Git 작업 점검 완료: $1')
    .replace(/^Branch: (.+)$/gm,'브랜치: $1')
    .replace(/^Tracking: none$/gm,'추적 브랜치: 없음')
    .replace(/^Tracking: (.+) \\(ahead (\\d+), behind (\\d+)\\)$/gm,'추적 브랜치: $1 (로컬 $2개 앞섬, 원격 $3개 앞섬)')
    .replace(/^Changed files: (\\d+)$/gm,'변경 파일: $1개')
    .replace(/^Conflict files: (\\d+)$/gm,'충돌 파일: $1개')
    .replace(/Commit approval is required before Workflow App can create a commit\\./g,'커밋 생성을 위해 Workflow App 승인이 필요합니다.')
    .replace(/Push approval is required before Workflow App can push\\./g,'푸시를 위해 Workflow App 승인이 필요합니다.')
    .replace(/No commit or push is required\\./g,'커밋이나 푸시가 필요하지 않습니다.')
    .replace(/No file changes to commit\\./g,'커밋할 파일 변경이 없습니다.')
    .replace(/Workflow cancelled by user\\./g,'사용자가 워크플로우를 취소했습니다.')
    .replace(/Push rejected by user\\. Commit was not pushed\\./g,'사용자가 푸시를 거절했습니다. 커밋은 푸시되지 않았습니다.')
    .replace(/Commit (\\d+) changed file\\(s\\) on ([^.\\n]+)\\./g,'$2 브랜치의 변경 파일 $1개를 커밋합니다.')
    .replace(/Push branch ([^.\\n]+) to origin\\./g,'$1 브랜치를 origin에 푸시합니다.')
    .replace(/Push (\\d+) commit\\(s\\) from ([^.\\n]+) to origin\\./g,'$2 브랜치의 커밋 $1개를 origin에 푸시합니다.')
    .replace(/Pushed origin\\/([^.\\s]+) at ([a-f0-9]+)\\./gi,'origin/$1에 $2 커밋까지 푸시 완료.')
    .replace(/Push started for origin\\/([^.\\n]+)\\./g,'origin/$1 푸시를 시작했습니다.')
    .replace(/Pushed origin\\/([^.\\n]+)\\./g,'origin/$1 푸시 완료.')
    .replace(/Git operation is waiting for commit approval\\./g,'Git 작업이 커밋 승인을 기다리고 있습니다.')
    .replace(/Git operation is waiting for push approval\\./g,'Git 작업이 푸시 승인을 기다리고 있습니다.')
    .replace(/Git operation completed with no pending work\\./g,'대기 중인 작업 없이 Git 작업이 완료되었습니다.')
    .replace(/Git operation blocked: cwd is not inside a git repository\\./g,'Git 작업 차단: cwd가 Git 저장소 안에 있지 않습니다.')
    .replace(/Git operation blocked because unresolved conflict files exist:/g,'Git 작업 차단: 해결되지 않은 충돌 파일이 있습니다:')
    .replace(/Commit blocked because unresolved conflict files exist:/g,'커밋 차단: 해결되지 않은 충돌 파일이 있습니다:')
    .replace(/Git diff changed after commit approval was requested\\. Start or refresh the gitOperation run and review the latest diff\\./g,'커밋 승인 요청 이후 Git diff가 변경되었습니다. gitOperation 작업을 새로 시작하거나 새로고침한 뒤 최신 diff를 다시 검토하세요.')
    .replace(/Commit hash changed after push approval was requested\\. Start or refresh the gitOperation run and review the latest commit\\./g,'푸시 승인 요청 이후 커밋 해시가 변경되었습니다. gitOperation 작업을 새로 시작하거나 새로고침한 뒤 최신 커밋을 다시 검토하세요.')
    .replace(/Push rejected because the remote branch changed or is ahead\\. Fetch\\/rebase or merge, then start a new gitOperation run\\./g,'원격 브랜치가 변경되었거나 앞서 있어서 푸시가 거절되었습니다. fetch/rebase 또는 merge 후 새 gitOperation 작업을 시작하세요.')
    .replace(/Workflow passed QA\\. Commit approval is required\\./g,'QA를 통과했습니다. 커밋 승인이 필요합니다.')
    .replace(/Workflow completed with no git commit required\\./g,'Git 커밋 없이 워크플로우가 완료되었습니다.')
    .replace(/Read-only request completed; coding\\/git stages skipped\\./g,'읽기 전용 요청이 완료되어 코딩/Git 단계는 생략되었습니다.')
    .replace(/QA failed after (\\d+) repair attempt\\(s\\)\\./g,'수정 시도 $1회 후에도 QA가 실패했습니다.')
    .replace(/Codex login is required\\. Run Codex login in the Codex app\\/CLI, then resume this workflow\\./g,'Codex 로그인이 필요합니다. Codex 앱/CLI에서 로그인한 뒤 이 워크플로우를 재개하세요.')
    .replace(/Codex Workflow blocked\\./g,'Codex 워크플로우가 차단되었습니다.')
    .replace(/Codex Workflow cancelled\\./g,'Codex 워크플로우가 취소되었습니다.')
    .replace(/Codex Workflow started\\./g,'Codex 워크플로우가 시작되었습니다.')
    .replace(/Commit created\\. Push approval is required\\./g,'커밋이 생성되었습니다. 푸시 승인이 필요합니다.')
    .replace(/Commit created\\./g,'커밋이 생성되었습니다.')
    .replace(/No changes to commit\\./g,'커밋할 변경 사항이 없습니다.')
    .replace(/commit approval rejected by user\\./g,'사용자가 커밋 승인을 거절했습니다.')
    .replace(/push approval rejected by user\\./g,'사용자가 푸시 승인을 거절했습니다.')
    .replace(/merge-back approval rejected by user\\./g,'사용자가 원본 병합 승인을 거절했습니다.');
}
function localizedPayload(payload){
  const value=payload||{};
  if(language!=='ko') return JSON.stringify(value);
  const parts=[];
  if(value.message) parts.push(localizedText(value.message));
  if(value.status) parts.push('상태 '+statusText(value.status));
  if(value.runtime) parts.push('런타임 '+value.runtime);
  if(value.selectedRuntime) parts.push('선택 런타임 '+value.selectedRuntime);
  if(value.runKind) parts.push('작업 종류 '+value.runKind);
  if(value.branch) parts.push('브랜치 '+value.branch);
  if(value.remote) parts.push('원격 '+value.remote);
  if(value.commitHash) parts.push('커밋 '+value.commitHash);
  if(typeof value.changedFiles==='number') parts.push('변경 파일 '+value.changedFiles+'개');
  if(typeof value.conflictFiles==='number') parts.push('충돌 파일 '+value.conflictFiles+'개');
  if(typeof value.ahead==='number'||typeof value.behind==='number') parts.push('ahead '+(value.ahead||0)+', behind '+(value.behind||0));
  if(value.method) parts.push(value.method);
  if(value.error) parts.push(localizedText(value.error));
  return parts.length?parts.join(' | '):JSON.stringify(value);
}
function eventLine(e){
  return (e.at||'')+' '+localizedEventType(e.type||'')+' '+localizedPayload(e.payload);
}
function artifactValue(value){
  if(Array.isArray(value)) return value.join(', ');
  if(value&&typeof value==='object') return JSON.stringify(value,null,2);
  return localizedText(value);
}
function renderArtifacts(r){
  const artifacts=r.artifacts||{};
  const keys=Object.keys(artifacts).filter(k=>artifacts[k]!==undefined&&artifacts[k]!==null&&String(artifacts[k]).trim()!=='');
  if(language==='en') return '<div class="card"><h2>'+esc(tx('artifacts'))+'</h2><pre>'+esc(JSON.stringify(artifacts,null,2))+'</pre></div>';
  if(!keys.length) return '<div class="card"><h2>'+esc(tx('artifacts'))+'</h2><div class="muted">'+esc(tx('noArtifacts'))+'</div></div>';
  return '<div class="card"><h2>'+esc(tx('artifacts'))+'</h2><div class="timeline">'+keys.map(k=>'<div class="stage"><b>'+esc(localizedArtifactLabel(k))+'</b><span></span><span>'+esc(artifactValue(artifacts[k]))+'</span></div>').join('')+'</div></div>';
}
function runtimeLabel(r){return (r.selectedRuntime||r.runtime||'auto')+' / '+(r.runKind||'multiAgent')}
function rolesForRun(r){
  if(Array.isArray(r.assignedRolesPreview)&&r.assignedRolesPreview.length) return r.assignedRolesPreview;
  const assigned=(r.artifacts&&Array.isArray(r.artifacts.assignedRoles))?r.artifacts.assignedRoles:[];
  if(assigned.length) return assigned;
  if((r.runKind||'multiAgent')==='gitOperation') return ['git-manager'];
  if((r.runKind||'multiAgent')==='automation') return ['sdk-runtime'];
  if((r.runKind||'multiAgent')==='readOnly') return (r.selectedRuntime==='sdk'||r.runtime==='sdk')?['sdk-runtime']:['docs-agent'];
  const stageRoles=(r.stages||[]).map(s=>s.role).filter(Boolean);
  return Array.from(new Set([...stageRoles,'docs-agent','git-manager','backend-coder','qa-agent','doc-writer'])).filter(role=>role!=='sdk');
}
function runActionButtons(r){
  const canResume=['idle','failed','blocked','cancelled'].includes(r.status);
  const canCancel=['queued','running','pendingCommitApproval','pendingPushApproval'].includes(r.status);
  const buttons=[];
  if(canResume) buttons.push('<button class="secondary" onclick="resumeRun()">'+esc(tx('resume'))+'</button>');
  if(canCancel) buttons.push('<button class="danger" onclick="cancelRun()">'+esc(tx('cancel'))+'</button>');
  return buttons.length?'<div class="row">'+buttons.join('')+'</div>':'<div class="muted">'+esc(tx('noRunActions'))+'</div>';
}
function renderProfiles(activeRoles){
  const active=new Set(activeRoles||[]);
  const profiles=AGENT_PROFILES.filter(a=>active.size===0||a.role!=='sdk-runtime'||active.has(a.role));
  return '<div class="profile-grid">'+profiles.map(a=>'<div class="profile '+(active.has(a.role)?'active':'')+'"><div class="profile-head"><div class="avatar">'+esc(a.initial)+'</div><div><b>'+esc(a.role)+'</b><div class="muted">'+esc(localText(a.title))+'</div></div></div><p>'+esc(localText(a.summary))+'</p></div>').join('')+'</div>';
}
function worktreeControls(r){
  const git=r.git||{};
  if(!git.worktreePath) return '';
  const buttons=[];
  if(git.mergeStatus!=='merged'&&git.mergeStatus!=='cleaned') buttons.push('<button class="secondary" onclick="mergeBack()">'+esc(tx('mergeBack'))+'</button>');
  if(['completed','failed','blocked','cancelled'].includes(r.status)&&git.mergeStatus!=='cleaned') buttons.push('<button class="secondary" onclick="cleanupWorktree()">'+esc(tx('cleanupWorktree'))+'</button>');
  return buttons.length?'<div class="card"><h2>'+esc(tx('worktree'))+'</h2><div class="muted">'+esc(git.worktreePath)+'</div><div class="row">'+buttons.join('')+'</div></div>':'';
}
function renderGitCard(r){
  const git=r.git||{};
  const activeLocks=Array.isArray(git.activeLocks)?git.activeLocks.length:0;
  const staleLocks=Array.isArray(git.staleLocks)?git.staleLocks.length:0;
  const route=[
    git.branch?(gitRouteLabel('branch')+': '+git.branch):'',
    git.branchType||git.branchScope?(gitRouteLabel('typeScope')+': '+(git.branchType||'')+'/'+(git.branchScope||'')):'',
    git.routingPreference?(gitRouteLabel('routingPreference')+': '+localizedGitValue(git.routingPreference)):'',
    git.routingDecision?(gitRouteLabel('routing')+': '+localizedGitValue(git.routingDecision)):'',
    git.laneVerdict?(gitRouteLabel('laneVerdict')+': '+localizedGitValue(git.laneVerdict)):'',
    git.diffStability?(gitRouteLabel('diffStability')+': '+localizedGitValue(git.diffStability)):'',
    git.routingLock?(gitRouteLabel('routingLock')+': '+localizedGitValue(git.routingLock.active?'active':'idle')):'',
    (activeLocks||staleLocks)?(gitRouteLabel('writerLocks')+': active '+activeLocks+', stale '+staleLocks):gitRouteLabel('writerLocks')+': active 0, stale 0',
    git.preflightSummary?(gitRouteLabel('preflight')+': '+git.preflightSummary):'',
    Array.isArray(git.preflightWarnings)&&git.preflightWarnings.length?(gitRouteLabel('warnings')+': '+git.preflightWarnings.join('\\n- ')):'',
    git.worktreePath?(gitRouteLabel('worktree')+': '+git.worktreePath):'',
    git.reuseCandidate?(gitRouteLabel('reuse')+': '+JSON.stringify(git.reuseCandidate)):'',
    git.routingBlockedReason?(gitRouteLabel('blocked')+': '+git.routingBlockedReason):'',
  ].filter(Boolean).join('\\n');
  return '<div class="card"><h2>'+esc(tx('git'))+'</h2>'+(route?'<pre>'+esc(route)+'</pre>':'')+'<pre>'+esc(JSON.stringify(git,null,2))+'</pre></div>';
}
function gitRouteLabel(key){
  if(language==='en') return ({
    branch:'branch',typeScope:'type/scope',routingPreference:'routing preference',routing:'routing',laneVerdict:'lane verdict',diffStability:'diff stability',routingLock:'routing lock',writerLocks:'writer locks',preflight:'preflight',warnings:'warnings',worktree:'worktree',reuse:'reuse',blocked:'blocked'
  })[key]||key;
  return ({
    branch:'브랜치',typeScope:'타입/스코프',routingPreference:'라우팅 선호',routing:'라우팅 결정',laneVerdict:'작업 범위 판정',diffStability:'diff 안정성',routingLock:'Git 라우팅 lock',writerLocks:'writer lock',preflight:'사전 점검',warnings:'경고',worktree:'워크트리',reuse:'재사용 후보',blocked:'차단 사유'
  })[key]||key;
}
function localizedGitValue(value){
  if(language==='en') return value;
  if(language==='ko') return ({
    clean:'깨끗함',
    'same-lane':'같은 작업 범위',
    unrelated:'다른 작업 범위',
    unknown:'판정 불가',
    stable:'안정적',
    changed:'검사 중 변경됨',
    unavailable:'확인 불가',
    'force-worktree':'워크트리 강제',
    auto:'자동',
    active:'활성',
    idle:'비활성',
    'current-branch':'현재 트리 브랜치',
    'new-worktree':'새 워크트리',
    'reuse-branch':'기존 브랜치 재사용',
    'reuse-worktree':'기존 워크트리 재사용',
    blocked:'차단'
  })[value]||value;
  return ({
    clean:'깨끗함',
    'same-lane':'같은 작업 범위',
    unrelated:'다른 작업 범위',
    unknown:'판정 불가',
    stable:'안정적',
    changed:'검사 중 변경됨',
    unavailable:'확인 불가'
  })[value]||value;
}
function agentContextButtons(a){
  if(!a.threadId) return '<div class="muted">'+esc(tx('noContextActions'))+'</div>';
  return '<div class="row"><button class="secondary" onclick="compactAgent(\\''+a.role+'\\')">'+esc(tx('compact'))+'</button><button class="secondary" onclick="resetAgent(\\''+a.role+'\\')">'+esc(tx('reset'))+'</button></div>';
}
function renderHome(){
  view='home';
  const activeRuns=runs.filter(r=>['running','queued','pendingCommitApproval','pendingPushApproval'].includes(r.status));
  document.getElementById('detail').innerHTML=
    '<div class="card"><h2>'+esc(tx('agentProfiles'))+'</h2>'+renderProfiles([])+'</div>'
    +'<div class="card"><h2>'+esc(tx('activeWorkflowAgents'))+'</h2>'+(activeRuns.length?'<div class="timeline">'+activeRuns.map(r=>'<div class="stage"><b>'+esc(localizedText(r.prompt||r.userPrompt||'').slice(0,48))+'</b>'+badge(r.status)+'<span class="agent-tags">'+rolesForRun(r).map(role=>'<span class="agent-tag">'+esc(role)+'</span>').join('')+'</span></div>').join('')+'</div>':'<div class="muted">'+esc(tx('noActiveRuns'))+'</div>')+'</div>'
    +'<div class="card"><h2>'+esc(tx('runKindAgentMap'))+'</h2><div class="timeline">'
    +'<div class="stage"><b>multiAgent</b><span></span><span>'+esc(tx('mapMulti'))+'</span></div>'
    +'<div class="stage"><b>gitOperation</b><span></span><span>'+esc(tx('mapGit'))+'</span></div>'
    +'<div class="stage"><b>readOnly</b><span></span><span>'+esc(tx('mapReadOnly'))+'</span></div>'
    +'<div class="stage"><b>automation</b><span></span><span>'+esc(tx('mapAutomation'))+'</span></div>'
    +'</div></div>';
}
async function refresh(){
  try{
    const h=await api('/api/health');
    const rs=h.runtimeSupport||{};
    document.getElementById('health').textContent=tx('healthPort')+' '+h.port+' | '+tx('healthActive')+' '+h.activeRuns+' | '+tx('healthWaiting')+' '+(h.waitingRuns||0)+' | '+tx('healthQueued')+' '+h.queuedRuns+' | '+tx('healthRuntime')+' '+(rs.defaultRuntime||'auto')+' | '+tx('healthSdk')+' '+(h.sdkAvailable?tx('sdkOk'):tx('sdkNo'));
    runs=await api('/api/runs');
    renderRuns();
    const hashId=decodeURIComponent((location.hash||'').replace(/^#/,''));
    if(hashId&&runs.some(r=>r.id===hashId)&&(!selected||selected.id!==hashId)){await loadRun(hashId);return}
    if(selected) await loadRun(selected.id);
    else if(view==='diagnostics') await showDiagnostics(false);
    else if(view==='docs') await showDocs(false);
    else renderHome();
  }catch(e){document.getElementById('health').textContent=e.message}
}
function renderRuns(){
  const root=document.getElementById('runs');
  root.innerHTML=runs.map(r=>'<div class="run '+(selected&&selected.id===r.id?'active':'')+'" onclick="loadRun(\\''+r.id.replace(/'/g,'')+'\\')"><div>'+badge(r.status)+' <b>'+esc(localizedText(r.prompt||r.userPrompt||'').slice(0,70))+'</b></div><div class="id">'+esc(r.id)+'</div><div class="muted">'+esc(runtimeLabel(r))+'</div><div class="muted">'+esc(r.cwd)+'</div></div>').join('')||'<div class="muted">'+esc(tx('noRuns'))+'</div>'
}
async function loadRun(id){
  view='run';
  if(location.hash!==('#'+encodeURIComponent(id))) location.hash=encodeURIComponent(id);
  selected=await api('/api/runs/'+encodeURIComponent(id));
  selected.events=await api('/api/runs/'+encodeURIComponent(id)+'/events?limit=80');
  renderRuns();
  renderDetail(selected);
}
async function showDiagnostics(updateRuns){
  view='diagnostics';
  selected=null;
  if(location.hash) history.replaceState(null,'',location.pathname+location.search);
  const diagnostics=await api('/api/diagnostics');
  if(updateRuns!==false){
    runs=await api('/api/runs');
    renderRuns();
  }
  renderDiagnostics(diagnostics);
}
function renderDiagnostics(diagnostics){
  const checks=diagnostics.checks||[];
  document.getElementById('detail').innerHTML=
    '<div class="card"><h2>'+esc(tx('diagnostics'))+'</h2><div class="muted">'+esc(tx('generated'))+' '+esc(diagnostics.generatedAt||'')+'</div><div class="diagnostics">'
    +checks.map(c=>'<div class="diag '+esc(c.status)+'"><b>'+esc(diagLabel(c))+'</b>'+diagBadge(c.status)+'<div><div>'+esc(diagDetail(c))+'</div>'+(diagRemediation(c)?'<div class="fix">'+esc(diagRemediation(c))+'</div>':'')+'</div></div>').join('')
    +'</div></div>';
}
function docsTx(key){
  const ko={
    title:'문서 설정',
    cwdMissing:'먼저 cwd를 입력하거나 실행 항목을 선택하세요.',
    profile:'프로젝트 문서 매핑',
    save:'저장',
    scan:'문서 스캔',
    recommend:'Codex 추천 매핑 생성',
    rebuild:'요약 캐시 재생성',
    refresh:'캐시 상태 새로고침',
    scanned:'문서 스캔 결과',
    cache:'요약 캐시 상태',
    recommendation:'추천 결과 원문',
    path:'경로',
    hash:'해시',
    status:'캐시',
    agents:'대상 에이전트',
    size:'크기',
    bundles:'에이전트 요약 번들',
    profileHash:'프로필 해시',
    updatedAt:'갱신 시각',
    reasons:'추천 이유',
    noDocs:'스캔된 문서가 없습니다.',
    noBundles:'생성된 에이전트 번들이 없습니다.',
    noReasons:'표시할 추천 이유가 없습니다.',
    saved:'저장했습니다.',
    branchRule:'코드 변경 run의 브랜치 형식은 codex/<type>/<scope> 입니다. worktree 경로는 slash를 dash로 바꿔 생성합니다.'
  };
  const en={
    title:'Document Settings',
    cwdMissing:'Enter cwd or select a run first.',
    profile:'Project Document Mapping',
    save:'Save',
    scan:'Scan Documents',
    recommend:'Generate Codex Mapping',
    rebuild:'Rebuild Summary Cache',
    refresh:'Refresh Cache Status',
    scanned:'Scanned Documents',
    cache:'Summary Cache State',
    recommendation:'Raw Recommendation',
    path:'Path',
    hash:'Hash',
    status:'Cache',
    agents:'Agents',
    size:'Size',
    bundles:'Agent Summary Bundles',
    profileHash:'Profile Hash',
    updatedAt:'Updated At',
    reasons:'Recommendation Reasons',
    noDocs:'No scanned documents.',
    noBundles:'No agent bundles generated.',
    noReasons:'No recommendation reasons to show.',
    saved:'Saved.',
    branchRule:'Code-changing runs use codex/<type>/<scope>; worktree paths replace slashes with dashes.'
  };
  return (language==='ko'?ko:en)[key]||key;
}
function currentDocsCwd(){
  const input=(document.getElementById('cwd')&&document.getElementById('cwd').value.trim())||'';
  return (selected&&selected.cwd)||input||(runs[0]&&runs[0].cwd)||'';
}
function docsApiPath(cwd, suffix){
  return '/api/projects/'+encodeURIComponent(cwd)+'/docs/'+suffix;
}
async function showDocs(updateRuns){
  view='docs';
  selected=null;
  if(location.hash) history.replaceState(null,'',location.pathname+location.search);
  if(updateRuns!==false){
    runs=await api('/api/runs');
    renderRuns();
  }
  const cwd=currentDocsCwd();
  if(!cwd){
    document.getElementById('detail').innerHTML='<div class="card"><h2>'+esc(docsTx('title'))+'</h2><div class="muted">'+esc(docsTx('cwdMissing'))+'</div></div>';
    return;
  }
  try{
    const profile=await api(docsApiPath(cwd,'profile'));
    const cache=await api(docsApiPath(cwd,'cache'));
    docsState={cwd,profile:profile.profile,cache,recommendation:null,error:''};
  }catch(e){
    docsState={cwd,profile:null,cache:null,recommendation:null,error:e.message};
  }
  renderDocs();
}
function renderDocs(){
  const cwd=docsState.cwd||currentDocsCwd();
  const profile=docsState.profile||{};
  const cache=docsState.cache||{};
  const scanned=cache.scanned||[];
  const bundles=cache.bundles||[];
  const profileJson=JSON.stringify(profile,null,2);
  document.getElementById('detail').innerHTML=
    '<div class="card"><h2>'+esc(docsTx('title'))+'</h2><div class="muted">'+esc(cwd)+'</div><div class="muted">'+esc(docsTx('branchRule'))+'</div>'+(docsState.error?'<div class="fix">'+esc(docsState.error)+'</div>':'')+'</div>'
    +'<div class="card"><h2>'+esc(docsTx('profile'))+'</h2><textarea id="docsProfileEditor" class="docs-editor">'+esc(profileJson)+'</textarea><div class="row doc-actions"><button onclick="saveDocsProfile()">'+esc(docsTx('save'))+'</button><button class="secondary" onclick="scanDocs()">'+esc(docsTx('scan'))+'</button><button class="secondary" onclick="recommendDocs()">'+esc(docsTx('recommend'))+'</button><button class="secondary" onclick="rebuildDocsCache()">'+esc(docsTx('rebuild'))+'</button><button class="secondary" onclick="refreshDocsCache()">'+esc(docsTx('refresh'))+'</button></div></div>'
    +'<div class="card"><h2>'+esc(docsTx('scanned'))+'</h2>'+renderScannedDocs(scanned)+'</div>'
    +'<div class="card"><h2>'+esc(docsTx('bundles'))+'</h2>'+renderDocBundles(bundles)+'</div>'
    +(docsState.recommendation?'<div class="card"><h2>'+esc(docsTx('reasons'))+'</h2>'+renderRecommendationReasons(docsState.recommendationReasons||[])+'</div><div class="card"><h2>'+esc(docsTx('recommendation'))+'</h2><pre>'+esc(docsState.recommendation)+'</pre></div>':'');
}
function renderScannedDocs(scanned){
  if(!scanned.length) return '<div class="muted">'+esc(docsTx('noDocs'))+'</div>';
  return '<div class="doc-table"><b>'+esc(docsTx('path'))+'</b><b>'+esc(docsTx('hash'))+'</b><b>'+esc(docsTx('status'))+'</b><b>'+esc(docsTx('size'))+'</b><b>'+esc(docsTx('agents'))+'</b>'
    +scanned.map(d=>'<div class="doc-row"><span>'+esc(d.path)+'</span><span>'+esc(String(d.hash||'').slice(0,12))+'</span><span>'+badge(d.cacheStatus)+'</span><span>'+esc(String(d.size||0))+'</span><span>'+esc((d.relevantAgents||[]).join(', '))+'</span></div>').join('')
    +'</div>';
}
function renderDocBundles(bundles){
  if(!bundles.length) return '<div class="muted">'+esc(docsTx('noBundles'))+'</div>';
  return '<div class="timeline">'+bundles.map(b=>'<div class="stage"><b>'+esc(b.role)+'</b><span>'+esc(String(b.profileHash||'').slice(0,12)+' | '+(b.sourceDocs||[]).length+' docs')+'</span><span>'+esc((b.updatedAt||'')+'\\n'+(b.summaryKo||'').slice(0,600))+'</span></div>').join('')+'</div>';
}
function renderRecommendationReasons(reasons){
  if(!reasons.length) return '<div class="muted">'+esc(docsTx('noReasons'))+'</div>';
  return '<div class="timeline">'+reasons.map(r=>'<div class="stage"><b>'+esc(r.path||'')+'</b><span>'+esc((r.agents||[]).join(', '))+'</span><span>'+esc(r.reasonKo||r.reason||'')+'</span></div>').join('')+'</div>';
}
async function saveDocsProfile(){
  const profile=JSON.parse(document.getElementById('docsProfileEditor').value);
  const result=await api(docsApiPath(docsState.cwd,'profile'),{method:'POST',body:JSON.stringify({profile})});
  docsState.profile=result.profile;
  docsState.error=docsTx('saved');
  await refreshDocsCache();
}
async function scanDocs(){
  const profile=JSON.parse(document.getElementById('docsProfileEditor').value);
  const result=await api(docsApiPath(docsState.cwd,'scan'),{method:'POST',body:JSON.stringify({profile})});
  docsState.profile=result.profile;
  docsState.cache={...(docsState.cache||{}),profile:result.profile,scanned:result.scanned};
  docsState.recommendation=null;
  renderDocs();
}
async function recommendDocs(){
  const result=await api(docsApiPath(docsState.cwd,'recommend'),{method:'POST',body:'{}'});
  docsState.profile=result.profile;
  docsState.recommendation=result.raw||JSON.stringify(result,null,2);
  docsState.recommendationReasons=result.reasons||[];
  docsState.error=result.error||'';
  renderDocs();
}
async function rebuildDocsCache(){
  docsState.cache=await api(docsApiPath(docsState.cwd,'cache/rebuild'),{method:'POST',body:'{}'});
  renderDocs();
}
async function refreshDocsCache(){
  docsState.cache=await api(docsApiPath(docsState.cwd,'cache'));
  docsState.profile=docsState.cache.profile||docsState.profile;
  renderDocs();
}
function diagLabel(c){
  if(language==='ko'&&c.id==='workflow-writer-locks') return '워크플로우 writer lock';
  if(language==='ko'&&c.id==='git-routing-mutex') return 'Git 라우팅 mutex';
  if(language==='ko') return I18N.ko.diagnosticsLabels[c.id]||c.label||c.id;
  return c.label||c.id;
}
function diagRemediation(c){
  if(language==='ko'&&c.id==='workflow-writer-locks') return '브랜치 또는 worktree 작업 전에 active/stale lock 상태를 확인하세요.';
  if(language==='ko'&&c.id==='git-routing-mutex') return '45초 이상 활성 상태가 유지되면 stale로 보고 라우팅 작업을 다시 시도하세요.';
  if(language==='ko') return I18N.ko.diagnosticsRemediation[c.id]||c.remediation||'';
  return c.remediation||'';
}
function diagDetail(c){
  if(language==='en') return c.detail||'';
  const detail=String(c.detail||'');
  if(c.id==='workflow-writer-locks'){
    return detail.replace('accessible. active=',' 접근 가능. 실행 중 lock=').replace(', stale=', ', 오래된 lock=');
  }
  if(c.id==='git-routing-mutex'){
    return detail
      .replace('No active git-routing mutex.','활성 Git 라우팅 mutex가 없습니다.')
      .replace('status=','상태=')
      .replace(', owner=', ', 소유자=')
      .replace(', updatedAt=', ', 갱신=')
      .replace(', reason=', ', 사유=');
  }
  const translations={
    'Token file exists. Value is hidden.':'토큰 파일이 있습니다. 값은 숨겨져 있습니다.',
    'Current request is not authenticated; read-only diagnostics are public.':'현재 요청은 인증되지 않았습니다. 읽기 전용 진단은 공개 상태입니다.',
    'Current request is authenticated.':'현재 요청은 인증되었습니다.',
    'haram-ai-agent-local is registered in Codex config.':'haram-ai-agent-local이 Codex 설정에 등록되어 있습니다.',
    'codex-workflow@haram-ai-agent-local is not enabled in Codex config.':'codex-workflow@haram-ai-agent-local이 Codex 설정에서 활성화되어 있지 않습니다.'
  };
  return translations[detail]||detail;
}
function renderDetail(r){
  const approvals=r.approvalRequests||[];
  const pending=approvals.filter(a=>a.status==='pending');
  const agents=Object.values(r.agents||{});
  const requests=r.agentRequests||[];
  const activeRoles=rolesForRun(r);
  document.getElementById('detail').innerHTML=
  '<div class="grid"><div class="card"><h2>'+esc(tx('run'))+'</h2><div>'+badge(r.status)+' <span class="status">'+esc(runtimeLabel(r))+'</span></div><div class="muted">'+esc(r.id)+'</div><h2>'+esc(tx('taskDetails'))+'</h2><p>'+esc(localizedText(r.prompt||r.userPrompt))+'</p><div class="muted">'+esc(tx('source'))+' '+esc(r.source||'')+' | '+esc(tx('mcp'))+' '+esc(r.mcpSource||'')+'</div>'+runActionButtons(r)+'</div>'
  +renderGitCard(r)+'</div>'
  +'<div class="card"><h2>'+esc(tx('assignedAgents'))+'</h2>'+renderProfiles(activeRoles)+'</div>'
  +worktreeControls(r)
  +'<div class="card"><h2>'+esc(tx('approvals'))+'</h2>'+(pending.map(a=>'<div class="approval"><b>'+esc(a.type)+'</b> '+badge(a.status)+'<p>'+esc(localizedText(a.summary))+'</p><div class="muted">hash '+esc(a.validationHash||'')+'</div><pre>'+esc(localizedText(a.diff||''))+'</pre><div class="row"><button onclick="approve(\\''+a.id+'\\')">'+esc(tx('approve'))+'</button><button class="danger" onclick="reject(\\''+a.id+'\\')">'+esc(tx('reject'))+'</button></div></div>').join('')||'<div class="muted">'+esc(tx('noPendingApprovals'))+'</div>')+(approvals.length?'<h2>'+esc(tx('approvalHistory'))+'</h2><div class="timeline">'+approvals.map(a=>'<div class="stage"><b>'+esc(a.type)+'</b>'+badge(a.status)+'<span>'+esc(localizedText(a.summary)+'\\n'+localizedText(a.resolutionReason||''))+'</span></div>').join('')+'</div>':'')+'</div>'
  +'<div class="grid">'+agents.map(a=>'<div class="card"><h2>'+esc(a.role)+'</h2><div>'+badge(a.status)+'</div><div class="muted">'+esc(a.threadId||tx('noThread'))+'</div><pre>'+esc(localizedText(a.lastSummary||a.lastError||''))+'</pre>'+agentContextButtons(a)+'</div>').join('')+'</div>'
  +'<div class="card"><h2>'+esc(tx('agentRequests'))+'</h2><div class="timeline">'+(requests.map(q=>'<div class="stage"><b>'+esc(q.fromRole+' -> '+q.toRole)+'</b>'+badge(q.status)+'<span>'+esc(localizedText(q.question)+'\\n'+localizedText(q.answerSummary||''))+'</span></div>').join('')||'<div class="muted">'+esc(tx('noAgentRequests'))+'</div>')+'</div></div>'
  +'<div class="card"><h2>'+esc(tx('timeline'))+'</h2><div class="timeline">'+(r.stages||[]).map(s=>'<div class="stage"><b>'+esc(localizedStage(s.id))+'</b>'+badge(s.status)+'<span>'+esc(localizedText(s.outputSummary||s.error||s.inputSummary||''))+'</span></div>').join('')+'</div></div>'
  +'<div class="card"><h2>'+esc(tx('events'))+'</h2><pre>'+esc((r.events||[]).map(eventLine).join('\\n'))+'</pre></div>'
  +renderArtifacts(r)
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
try{const ws=new WebSocket('ws://'+location.host+'/ws'); ws.onmessage=()=>refresh();}catch{}
window.addEventListener('hashchange',()=>{const id=decodeURIComponent((location.hash||'').replace(/^#/,'')); if(id) loadRun(id); else {selected=null; renderRuns(); renderHome();}});
renderShellText();
refresh();
</script>
</body>
</html>`;
}
