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
    .rag-help{border:1px solid rgba(88,166,255,.35);background:#0d1722;border-radius:8px;padding:10px;margin:8px 0 10px;color:var(--text)}.rag-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin:8px 0 10px}.rag-summary-card{border:1px solid var(--line);background:#0d1117;border-radius:8px;padding:10px}.rag-summary-card b{display:block;margin-bottom:4px}.rag-card{border:1px solid var(--line);background:#0d1117;border-radius:8px;padding:12px;margin:10px 0}.rag-card.ready{border-color:rgba(63,185,80,.45)}.rag-card.blocked{border-color:rgba(248,81,73,.45)}.rag-card.install-required{border-color:rgba(210,153,34,.45)}.rag-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}.rag-title{font-weight:700;font-size:14px}.rag-score{font-weight:700;color:var(--accent);white-space:nowrap}.rag-summary{margin:6px 0;color:var(--text)}.rag-sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;margin-top:10px}.rag-section{border:1px solid #1d252d;border-radius:8px;padding:9px;background:#10151b}.rag-section h3{font-size:12px;margin:0 0 6px;color:var(--muted)}.rag-list{margin:0;padding-left:17px}.rag-list li{margin:3px 0}.rag-meta{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.rag-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}.rag-disabled{color:var(--muted);font-size:12px}.rag-details{margin-top:10px}.rag-details summary{cursor:pointer;color:var(--muted)}
  </style>
</head>
<body>
<header><h1 id="appTitle">Codex Workflow App</h1><div class="row"><span id="health" class="muted">connecting...</span><button id="docsButton" class="secondary" onclick="showDocs()">문서 설정</button><button id="updateButton" class="secondary" onclick="showUpdate()">업데이트</button><button id="diagnosticsButton" class="secondary" onclick="showDiagnostics()">Diagnostics</button><button id="refreshButton" class="secondary" onclick="refresh()">Refresh</button><div class="lang-toggle" role="group" aria-label="Language"><button id="langKo" class="secondary lang-choice" type="button" onclick="setLanguage('ko')">한국어</button><button id="langEn" class="secondary lang-choice" type="button" onclick="setLanguage('en')">English</button></div></div></header>
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
let runs=[], selected=null, view='home', updateStatus=null;
let docsState={cwd:'',profile:null,cache:null,knowledge:null,verification:null,recommendation:null,ragRecommendations:null,ragAction:null,pendingRagAction:null,knowledgeAction:null,pendingKnowledgeAction:null,error:''};
const LANGUAGE_KEY='codexWorkflowLanguage';
const KNOWLEDGE_TARGET_CWD_KEY='codexWorkflowKnowledgeTargetCwd';
let language=localStorage.getItem(LANGUAGE_KEY)||'ko';
const I18N={
  ko:{
    appTitle:'Codex 워크플로우 앱',connecting:'연결 중...',diagnostics:'진단',refresh:'새로고침',newRun:'새 워크플로우 실행',cwdPlaceholder:'cwd 예: D:\\\\Github\\\\ai_agent\\\\haram_project',promptPlaceholder:'Codex Desktop 요청 또는 직접 실행할 워크플로우 작업',start:'시작',selectRun:'실행 항목을 선택하세요.',
    noRunActions:'사용 가능한 실행 작업이 없습니다',resume:'재개',cancel:'취소',noContextActions:'사용 가능한 컨텍스트 작업이 없습니다',compact:'압축',reset:'초기화',mergeBack:'원본에 병합',cleanupWorktree:'워크트리 정리',
    agentProfiles:'에이전트 프로필',activeWorkflowAgents:'현재 작업에 투입된 에이전트',noActiveRuns:'실행 중, 대기 중, 승인 대기 중인 작업이 없습니다.',runKindAgentMap:'작업 종류별 에이전트 구성',run:'작업',taskDetails:'작업 내용',git:'Git',assignedAgents:'이 작업에 투입된 에이전트',worktree:'워크트리',approvals:'승인 요청',noPendingApprovals:'대기 중인 승인 요청이 없습니다',approvalHistory:'승인 이력',approve:'승인',reject:'거절',agentRequests:'에이전트 간 요청',noAgentRequests:'에이전트 간 요청이 없습니다',timeline:'타임라인',events:'이벤트',artifacts:'산출물',generated:'생성 시각',source:'출처',mcp:'MCP',noThread:'thread 없음',
    healthPort:'포트',healthActive:'실행',healthWaiting:'승인대기',healthQueued:'큐',healthRuntime:'런타임',healthSdk:'SDK',sdkOk:'정상',sdkNo:'없음',
    mapMulti:'knowledge-source-agent, rag-retriever-agent, docs-agent, 필요 시 web-researcher, git-manager, designer/frontend-coder/backend-coder, qa-agent, doc-writer',
    mapGit:'git-manager',
    mapReadOnly:'knowledge-source-agent, rag-retriever-agent, docs-agent, 필요 시 web-researcher 또는 sdk-runtime',
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
    mapMulti:'knowledge-source-agent, rag-retriever-agent, docs-agent, optional web-researcher, git-manager, designer/frontend-coder/backend-coder, qa-agent, doc-writer',
    mapGit:'git-manager',
    mapReadOnly:'knowledge-source-agent, rag-retriever-agent, docs-agent, optional web-researcher, or sdk-runtime',
    mapAutomation:'sdk-runtime',
    noRuns:'No runs',noArtifacts:'No artifacts',rawArtifacts:'Raw Artifacts JSON',
    status:{running:'running',completed:'completed',failed:'failed',blocked:'blocked',cancelled:'cancelled',queued:'queued',pendingCommitApproval:'pending commit approval',pendingPushApproval:'pending push approval',pending:'pending',approved:'approved',rejected:'rejected',idle:'idle',ok:'ok',warn:'warn',fail:'fail',unknown:'unknown'},
    stageLabels:{},eventLabels:{},artifactLabels:{},
    diagnosticsLabels:{},
    diagnosticsRemediation:{}
  }
};
const AGENT_PROFILES=[
  {role:'knowledge-source-agent',initial:'K',title:{ko:'지식 소스',en:'Knowledge sources'},summary:{ko:'repo 문서, llms.txt, Obsidian vault, Second Brain 포인터, 기존 RAG 후보를 감지합니다.',en:'Detects repo docs, llms.txt, Obsidian vaults, Second Brain pointers, and existing RAG candidates.'}},
  {role:'knowledge-index-agent',initial:'I',title:{ko:'지식 인덱스',en:'Knowledge index'},summary:{ko:'로컬 fallback RAG 인덱스 상태, chunking, source hash, 재구축 필요 여부를 점검합니다.',en:'Inspects local fallback RAG index state, chunking, source hashes, and rebuild needs.'}},
  {role:'rag-retriever-agent',initial:'V',title:{ko:'RAG 검색',en:'RAG retrieval'},summary:{ko:'검색 query를 계획하고 citation을 확인한 뒤 작업별 근거를 요약합니다.',en:'Plans retrieval queries, checks citations, and summarizes task-specific evidence.'}},
  {role:'knowledge-auditor-agent',initial:'A',title:{ko:'지식 감사',en:'Knowledge audit'},summary:{ko:'citation, stale/conflicting 문서, secret 노출, prompt injection 위험을 점검합니다.',en:'Checks citations, stale/conflicting docs, secret exposure, and prompt-injection risks.'}},
  {role:'wiki-export-agent',initial:'X',title:{ko:'Wiki 내보내기',en:'Wiki export'},summary:{ko:'생성된 llms.txt, llms-full.txt, Obsidian vault, 선택적 MkDocs export 준비 상태를 검토합니다.',en:'Reviews generated llms.txt, llms-full.txt, Obsidian vault, and optional MkDocs export readiness.'}},
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
  document.getElementById('updateButton').textContent=language==='ko'?'업데이트':'Update';
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
function jsArg(s){return String(s||'').replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'").replace(/\\r?\\n/g,'\\\\n')}
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
    .replace(/merge-back approval rejected by user\\./g,'사용자가 원본 병합 승인을 거절했습니다.')
    .replace(/Action was not run\\. The request must include confirm=true because this can apply settings, start local services, or download local models\\./g,'설정 적용, 로컬 서비스 시작, 모델 다운로드가 포함될 수 있어 별도 확인이 필요합니다.')
    .replace(/Missing explicit confirmation for local preparation and settings apply\\./g,'로컬 준비와 설정 적용에 대한 명시적 확인이 없습니다.')
    .replace(/Docker Desktop is already installed\\./g,'Docker Desktop이 이미 설치되어 있습니다.')
    .replace(/Docker Desktop installation completed\\./g,'Docker Desktop 설치가 완료되었습니다.')
    .replace(/Docker Desktop installation did not complete automatically\\./g,'Docker Desktop 설치가 자동으로 완료되지 않았습니다.')
    .replace(/Docker Engine is already running\\./g,'Docker Engine이 이미 실행 중입니다.')
    .replace(/Docker Engine is running\\./g,'Docker Engine이 실행 중입니다.')
    .replace(/Docker Desktop was launched, but Docker Engine did not become ready before timeout\\./g,'Docker Desktop을 실행했지만 제한 시간 안에 Docker Engine이 준비되지 않았습니다.')
    .replace(/Docker Desktop is not installed, so Docker Engine cannot be started automatically\\./g,'Docker Desktop이 설치되어 있지 않아 Docker Engine을 자동 시작할 수 없습니다.')
    .replace(/winget is not available, so Docker Desktop cannot be installed automatically\\./g,'winget을 사용할 수 없어 Docker Desktop을 자동 설치할 수 없습니다.')
    .replace(/winget is not available, so native Ollama cannot be installed automatically\\./g,'winget을 사용할 수 없어 native Ollama를 자동 설치할 수 없습니다.')
    .replace(/Native Ollama installation completed at ([^.\\n]+)\\./g,'native Ollama 설치가 완료되었습니다: $1')
    .replace(/Native Ollama installation did not complete automatically\\./g,'native Ollama 설치가 자동으로 완료되지 않았습니다.')
    .replace(/Native Ollama executable was not found\\./g,'native Ollama 실행 파일을 찾을 수 없습니다.')
    .replace(/Native Ollama is already installed at ([^.\\n]+)\\./g,'native Ollama가 이미 설치되어 있습니다: $1')
    .replace(/Native Ollama is already running at (http:\\/\\/[^.\\n]+)\\./g,'native Ollama가 이미 실행 중입니다: $1')
    .replace(/Native Ollama is running at (http:\\/\\/[^.\\n]+)\\./g,'native Ollama가 실행 중입니다: $1')
    .replace(/Native Ollama did not become ready at (http:\\/\\/[^\\s]+) before timeout\\./g,'native Ollama가 제한 시간 안에 준비되지 않았습니다: $1')
    .replace(/No free port was found for native Ollama\\./g,'native Ollama에 사용할 빈 포트를 찾지 못했습니다.')
    .replace(/Install native Ollama before model pull can run\\./g,'모델을 받으려면 native Ollama 설치가 필요합니다.')
    .replace(/Continue with vector DB startup\\./g,'이어서 vector DB 시작을 진행하세요.')
    .replace(/Continue with model pull\\./g,'이어서 모델 다운로드를 진행하세요.')
    .replace(/Wait for Docker Desktop to finish starting, then rerun local preparation\\./g,'Docker Desktop 시작이 끝난 뒤 로컬 준비를 다시 실행하세요.')
    .replace(/Local preparation was not run because this recommendation requires manual external setup\\./g,'이 추천은 외부 수동 설정이 필요해 로컬 준비를 실행하지 않았습니다.')
    .replace(/Local preparation cannot be completed automatically for this recommendation\\./g,'이 추천은 로컬 준비를 자동으로 완료할 수 없습니다.')
    .replace(/Settings were applied, but local preparation stopped before completion\\./g,'설정은 적용됐지만 로컬 준비가 완료되기 전에 중단되었습니다.')
    .replace(/Settings were applied and local preparation ran, but validation still has blockers\\./g,'설정 적용과 로컬 준비는 실행됐지만 검증 차단 사유가 남아 있습니다.')
    .replace(/Local preparation, settings apply, and validation completed\\./g,'로컬 준비, 설정 적용, 검증이 완료되었습니다.')
    .replace(/OPENAI_API_KEY must be created and registered manually\\./g,'OPENAI_API_KEY는 외부에서 직접 발급해 등록해야 합니다.')
    .replace(/VOYAGE_API_KEY must be created and registered manually\\./g,'VOYAGE_API_KEY는 외부에서 직접 발급해 등록해야 합니다.')
    .replace(/This recommendation is waiting for a manually registered API key\\./g,'이 추천은 사용자가 직접 등록해야 하는 API 키를 기다리고 있습니다.')
    .replace(/OpenAI-compatible local embedding server setup is manual in v1\\./g,'OpenAI-compatible 로컬 embedding 서버 준비는 v1에서 수동 설정 대상입니다.')
    .replace(/Resolve the blocked local prerequisite, then refresh recommendations\\./g,'차단된 로컬 요구사항을 해결한 뒤 추천을 다시 갱신하세요.')
    .replace(/Use Settings Apply only if you intentionally want to save the config before the local runtime is ready\\./g,'로컬 런타임이 준비되기 전에 설정만 저장하려는 경우에만 설정 적용을 사용하세요.')
    .replace(/Use Settings Apply after manually registering the required API key or choose a local\\/free recommendation\\./g,'필요한 API 키를 직접 등록한 뒤 설정 적용을 사용하거나 로컬/무료 추천을 선택하세요.')
    .replace(/No existing RAG system was detected; local-hybrid fallback will be used\\./g,'기존 RAG가 감지되지 않아 local-hybrid fallback을 사용합니다.')
    .replace(/Docker Engine is installed but not running; start Docker Desktop before Qdrant can be started\\./g,'Docker는 설치되어 있지만 Docker Engine이 실행 중이 아닙니다. Qdrant를 시작하려면 Docker Desktop을 먼저 실행하세요.')
    .replace(/Docker Engine is not running\\./g,'Docker Engine이 실행 중이 아닙니다.')
    .replace(/Docker is not installed\\./g,'Docker가 설치되어 있지 않습니다.')
    .replace(/Qdrant service is not reachable yet\\./g,'Qdrant 서비스가 아직 연결 가능한 상태가 아닙니다.')
    .replace(/OpenAI-compatible local embedding endpoint is not reachable or validated\\./g,'OpenAI-compatible 로컬 embedding endpoint가 아직 연결/검증되지 않았습니다.')
    .replace(/No Ollama embedding endpoint accepted the fixed validation sample\\./g,'현재 Ollama 계열 endpoint가 embedding 검증 샘플을 처리하지 못했습니다.')
    .replace(/connect ECONNREFUSED 127\\.0\\.0\\.1:6333/g,'127.0.0.1:6333 연결이 거부되었습니다. Qdrant가 실행 중이 아닐 가능성이 큽니다.')
    .replace(/connect ECONNREFUSED 127\\.0\\.0\\.1:8000/g,'127.0.0.1:8000 연결이 거부되었습니다. Chroma가 실행 중이 아닐 가능성이 큽니다.')
    .replace(/Qdrant readiness endpoint returned HTTP (\\d+)\\./g,'Qdrant readiness endpoint가 HTTP $1 응답을 반환했습니다.')
    .replace(/Qdrant readiness endpoint is not reachable\\./g,'Qdrant readiness endpoint에 연결할 수 없습니다.')
    .replace(/Chroma heartbeat endpoint returned HTTP (\\d+)\\./g,'Chroma heartbeat endpoint가 HTTP $1 응답을 반환했습니다. 기본 포트가 다른 서비스일 수 있습니다.')
    .replace(/Embedding model ([^.\\n]+) is not exposed by the configured Ollama-compatible endpoint\\./g,'embedding 모델 $1이 현재 Ollama 호환 endpoint에 노출되어 있지 않습니다.')
    .replace(/Embedding model ([^.\\n]+) is not installed in native Ollama\\./g,'embedding 모델 $1이 native Ollama에 설치되어 있지 않습니다.')
    .replace(/Model pull requires native Ollama\\./g,'모델 pull은 native Ollama가 필요합니다.')
    .replace(/OPENAI_API_KEY is required for this external embedding provider\\./g,'외부 embedding provider를 사용하려면 OPENAI_API_KEY가 필요합니다.')
    .replace(/VOYAGE_API_KEY is required for this external embedding provider\\./g,'외부 embedding provider를 사용하려면 VOYAGE_API_KEY가 필요합니다.')
    .replace(/Port is occupied but http:\\/\\/127\\.0\\.0\\.1:8000\\/api\\/v2\\/heartbeat did not validate\\. Root HTTP 200 \\(([^)]+)\\)\\./g,'8000 포트가 Chroma가 아닌 서비스($1)에 점유되어 heartbeat 검증을 통과하지 못했습니다.')
    .replace(/Chroma default port 8000 is occupied by a non-Chroma service\\./g,'Chroma 기본 포트 8000이 Chroma가 아닌 서비스에 의해 사용 중입니다.')
    .replace(/Qdrant is not ready to start automatically\\./g,'Qdrant를 아직 자동 시작할 수 없습니다.')
    .replace(/Chroma is not ready to start automatically\\./g,'Chroma를 아직 자동 시작할 수 없습니다.')
    .replace(/Qdrant can be started with the managed Docker action\\. Port conflicts will use an alternate free port automatically\\./g,'Qdrant는 managed Docker 액션으로 시작할 수 있습니다. 포트 충돌이 있으면 자동으로 빈 대체 포트를 사용합니다.')
    .replace(/Chroma can be started with the managed Docker action\\. Port conflicts will use an alternate free port automatically\\./g,'Chroma는 managed Docker 액션으로 시작할 수 있습니다. 포트 충돌이 있으면 자동으로 빈 대체 포트를 사용합니다.')
    .replace(/Managed Qdrant can use alternate URL (http:\\/\\/127\\.0\\.0\\.1:\\d+) with host ports (\\d+)\\/(\\d+)\\./g,'managed Qdrant는 대체 URL $1을 사용할 수 있습니다. 호스트 포트는 $2/$3입니다.')
    .replace(/Managed Chroma can use alternate URL (http:\\/\\/127\\.0\\.0\\.1:\\d+)\\./g,'managed Chroma는 대체 URL $1을 사용할 수 있습니다.')
    .replace(/Ready to run docker container ([^\\s]+) on (http:\\/\\/127\\.0\\.0\\.1:\\d+)\\./g,'Docker 컨테이너 $1을 $2에서 실행할 준비가 되었습니다.')
    .replace(/Start Docker Desktop before starting a managed Chroma container\\./g,'managed Chroma 컨테이너를 시작하기 전에 Docker Desktop을 실행하세요.')
    .replace(/Start Docker Desktop, then rerun Start Qdrant\\./g,'Docker Desktop을 실행한 뒤 Qdrant 시작을 다시 실행하세요.');
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
  const keys=Object.keys(artifacts).filter(k=>k!=='knowledgeRouting'&&artifacts[k]!==undefined&&artifacts[k]!==null&&String(artifacts[k]).trim()!=='');
  if(language==='en'){
    const filtered={};
    keys.forEach(k=>{filtered[k]=artifacts[k];});
    return '<div class="card"><h2>'+esc(tx('artifacts'))+'</h2><pre>'+esc(JSON.stringify(filtered,null,2))+'</pre></div>';
  }
  if(!keys.length) return '<div class="card"><h2>'+esc(tx('artifacts'))+'</h2><div class="muted">'+esc(tx('noArtifacts'))+'</div></div>';
  return '<div class="card"><h2>'+esc(tx('artifacts'))+'</h2><div class="timeline">'+keys.map(k=>'<div class="stage"><b>'+esc(localizedArtifactLabel(k))+'</b><span></span><span>'+esc(artifactValue(artifacts[k]))+'</span></div>').join('')+'</div></div>';
}
function renderKnowledgeRoutingTrace(r){
  const routing=r.artifacts&&r.artifacts.knowledgeRouting;
  if(!routing) return '';
  const title=language==='ko'?'Knowledge Routing Trace':'Knowledge Routing Trace';
  const workersLabel=language==='ko'?'선택된 지식 worker':'Selected workers';
  const skillsLabel=language==='ko'?'선택된 skill':'Selected skills';
  const reasonsLabel=language==='ko'?'선택 근거':'Reasons';
  const citationsLabel=language==='ko'?'근거 citation':'Citations';
  const warningsLabel=language==='ko'?'주의':'Warnings';
  const detailsLabel=language==='ko'?'기술 상세':'Technical details';
  const profileLabel=language==='ko'?'실행 프로필':'Execution profile';
  const coordinatorLabel=language==='ko'?'coordinator':'Coordinator';
  const workers=(routing.selectedWorkers||[]).join(', ')||'none';
  const coordinator=routing.coordinatorRole||'docs-agent';
  const skills=(routing.selectedSkills||[]).map(s=>s.name+' - '+s.sourcePath+'#'+s.chunkId+' score='+s.score).join('\\n')||'none';
  const reasons=(routing.reasonsKo||[]).join('\\n')||'none';
  const citations=(routing.citations||[]).map(c=>c.sourcePath+'#'+c.chunkId+' score='+c.score+'\\n'+(c.snippet||'')).join('\\n\\n')||'none';
  const warnings=(routing.warnings||[]).join('\\n')||'none';
  return '<div class="card"><h2>'+esc(title)+'</h2><div class="timeline">'
    +'<div class="stage"><b>'+esc(profileLabel)+'</b><span>'+esc(routing.executionProfile||'standard')+'</span><span>'+esc(coordinatorLabel+': '+coordinator)+'</span></div>'
    +'<div class="stage"><b>'+esc(workersLabel)+'</b><span>'+esc(String((routing.selectedWorkers||[]).length))+'</span><span>'+esc(workers)+'</span></div>'
    +'<div class="stage"><b>'+esc(skillsLabel)+'</b><span>'+esc(String((routing.selectedSkills||[]).length))+'</span><span>'+esc(skills)+'</span></div>'
    +'<div class="stage"><b>'+esc(reasonsLabel)+'</b><span></span><span>'+esc(reasons)+'</span></div>'
    +'<div class="stage"><b>'+esc(citationsLabel)+'</b><span>'+esc(String((routing.citations||[]).length))+'</span><span>'+esc(citations)+'</span></div>'
    +(warnings&&warnings!=='none'?'<div class="stage"><b>'+esc(warningsLabel)+'</b><span></span><span>'+esc(warnings)+'</span></div>':'')
    +'</div><details class="rag-details"><summary>'+esc(detailsLabel)+'</summary><pre>'+esc(JSON.stringify(routing,null,2))+'</pre></details></div>';
}
function renderCancelInfo(r){
  const artifacts=r.artifacts||{};
  if(!artifacts.cancelRequestedAt&&!artifacts.cancelReason&&!artifacts.cancelSource) return '';
  const title=language==='ko'?'취소 정보':'Cancel Info';
  const sourceLabel=language==='ko'?'취소 주체':'Source';
  const reasonLabel=language==='ko'?'취소 사유':'Reason';
  const atLabel=language==='ko'?'요청 시각':'Requested at';
  return '<div class="card"><h2>'+esc(title)+'</h2><div class="timeline">'
    +'<div class="stage"><b>'+esc(sourceLabel)+'</b><span></span><span>'+esc(artifacts.cancelSource||'api')+'</span></div>'
    +'<div class="stage"><b>'+esc(reasonLabel)+'</b><span></span><span>'+esc(localizedText(artifacts.cancelReason||''))+'</span></div>'
    +'<div class="stage"><b>'+esc(atLabel)+'</b><span></span><span>'+esc(artifacts.cancelRequestedAt||'')+'</span></div>'
    +'</div></div>';
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
    updateStatus=h.update||updateStatus;
    const updateLabel=updateStatus?(' | '+(language==='ko'?'업데이트 ':'update ')+updateStatusText(updateStatus.status||'unknown')):'';
    document.getElementById('health').textContent=tx('healthPort')+' '+h.port+' | '+tx('healthActive')+' '+h.activeRuns+' | '+tx('healthWaiting')+' '+(h.waitingRuns||0)+' | '+tx('healthQueued')+' '+h.queuedRuns+' | '+tx('healthRuntime')+' '+(rs.defaultRuntime||'auto')+' | '+tx('healthSdk')+' '+(h.sdkAvailable?tx('sdkOk'):tx('sdkNo'))+updateLabel;
    runs=await api('/api/runs');
    renderRuns();
    const hashId=decodeURIComponent((location.hash||'').replace(/^#/,''));
    if(hashId&&runs.some(r=>r.id===hashId)&&(!selected||selected.id!==hashId)){await loadRun(hashId);return}
    if(selected) await loadRun(selected.id);
    else if(view==='diagnostics') await showDiagnostics(false);
    else if(view==='docs') await showDocs(false);
    else if(view==='update') await showUpdate(false);
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
function updateTx(key){
  const ko={
    title:'업데이트',
    summary:'Workflow App은 실행 중에도 원격 Git 업데이트를 감지합니다. 자동 적용은 작업이 없고 repo가 깨끗할 때만 진행됩니다.',
    status:'상태',
    mode:'자동 업데이트',
    current:'현재 commit',
    remote:'원격 commit',
    branch:'브랜치',
    upstream:'추적 브랜치',
    aheadBehind:'ahead / behind',
    lastChecked:'마지막 확인',
    lastApplied:'마지막 적용',
    blockers:'차단 사유',
    warnings:'경고',
    logs:'업데이트 로그',
    noBlockers:'차단 사유가 없습니다.',
    noLogs:'아직 업데이트 로그가 없습니다.',
    check:'업데이트 확인',
    apply:'지금 적용',
    restart:'앱 재시작',
    autoOn:'자동 업데이트 끄기',
    autoOff:'자동 업데이트 켜기',
    restartRequired:'Codex Desktop 플러그인 manifest가 바뀐 경우 Codex Desktop 재시작이 필요할 수 있습니다.',
    unavailable:'업데이트 확인 불가',
    upToDate:'최신 상태',
    available:'업데이트 가능',
    blocked:'차단됨',
    applying:'적용 중',
    completed:'완료',
    failed:'실패',
    unknown:'알 수 없음',
    restartRequiredStatus:'재시작 필요'
  };
  const en={
    title:'Update',
    summary:'Workflow App can detect remote Git updates while it is running. Automatic apply only runs when the app is idle and the repo is clean.',
    status:'Status',
    mode:'Auto update',
    current:'Current commit',
    remote:'Remote commit',
    branch:'Branch',
    upstream:'Upstream',
    aheadBehind:'ahead / behind',
    lastChecked:'Last checked',
    lastApplied:'Last applied',
    blockers:'Blockers',
    warnings:'Warnings',
    logs:'Update logs',
    noBlockers:'No blockers.',
    noLogs:'No update logs yet.',
    check:'Check updates',
    apply:'Apply now',
    restart:'Restart app',
    autoOn:'Disable auto update',
    autoOff:'Enable auto update',
    restartRequired:'Codex Desktop may need a restart when the plugin manifest changed.',
    unavailable:'Unavailable',
    upToDate:'Up to date',
    available:'Available',
    blocked:'Blocked',
    applying:'Applying',
    completed:'Completed',
    failed:'Failed',
    unknown:'Unknown',
    restartRequiredStatus:'Restart required'
  };
  return (language==='ko'?ko:en)[key]||key;
}
function updateStatusText(status){
  return ({
    unavailable:updateTx('unavailable'),
    upToDate:updateTx('upToDate'),
    available:updateTx('available'),
    blocked:updateTx('blocked'),
    applying:updateTx('applying'),
    completed:updateTx('completed'),
    failed:updateTx('failed'),
    restartRequired:updateTx('restartRequiredStatus'),
    unknown:updateTx('unknown')
  })[status]||status||updateTx('unknown');
}
function updateBadge(status){
  return '<span class="status '+esc(status||'unknown')+'">'+esc(updateStatusText(status))+'</span>';
}
async function showUpdate(updateRuns){
  view='update';
  selected=null;
  if(location.hash) history.replaceState(null,'',location.pathname+location.search);
  updateStatus=await api('/api/update/status');
  if(updateRuns!==false){
    runs=await api('/api/runs');
    renderRuns();
  }
  renderUpdate();
}
function renderUpdate(){
  const u=updateStatus||{};
  const blockers=u.blockers||[];
  const warnings=u.warnings||[];
  const logs=u.logs||[];
  const autoOn=u.autoUpdateMode==='autoWhenIdle';
  document.getElementById('detail').innerHTML=
    '<div class="card"><h2>'+esc(updateTx('title'))+'</h2><p class="muted">'+esc(updateTx('summary'))+'</p><div class="row">'+updateBadge(u.status)+' <span class="status">'+esc(u.autoUpdateMode||'autoWhenIdle')+'</span></div></div>'
    +'<div class="grid"><div class="card"><h2>'+esc(updateTx('status'))+'</h2><div class="timeline">'
    +'<div class="stage"><b>'+esc(updateTx('current'))+'</b><span></span><span>'+esc(shortCommit(u.currentCommit))+'</span></div>'
    +'<div class="stage"><b>'+esc(updateTx('remote'))+'</b><span></span><span>'+esc(shortCommit(u.remoteCommit))+'</span></div>'
    +'<div class="stage"><b>'+esc(updateTx('branch'))+'</b><span></span><span>'+esc(u.currentBranch||u.branch||'')+'</span></div>'
    +'<div class="stage"><b>'+esc(updateTx('upstream'))+'</b><span></span><span>'+esc(u.upstreamRef||'')+'</span></div>'
    +'<div class="stage"><b>'+esc(updateTx('aheadBehind'))+'</b><span></span><span>'+esc(String(u.ahead||0)+' / '+String(u.behind||0))+'</span></div>'
    +'<div class="stage"><b>'+esc(updateTx('lastChecked'))+'</b><span></span><span>'+esc(u.lastCheckedAt||'')+'</span></div>'
    +'<div class="stage"><b>'+esc(updateTx('lastApplied'))+'</b><span></span><span>'+esc(u.lastAppliedAt||'')+'</span></div>'
    +'</div><div class="row"><button onclick="checkUpdate()">'+esc(updateTx('check'))+'</button><button class="secondary" onclick="applyUpdateNow()" '+((u.status==='applying'||!u.updateAvailable)?'disabled':'')+'>'+esc(updateTx('apply'))+'</button><button class="secondary" onclick="restartWorkflowApp()">'+esc(updateTx('restart'))+'</button><button class="secondary" onclick="toggleAutoUpdate()">'+esc(autoOn?updateTx('autoOn'):updateTx('autoOff'))+'</button></div></div>'
    +'<div class="card"><h2>'+esc(updateTx('blockers'))+'</h2>'+(blockers.length?'<pre>'+esc(blockers.join('\\n'))+'</pre>':'<div class="muted">'+esc(updateTx('noBlockers'))+'</div>')+'<h2>'+esc(updateTx('warnings'))+'</h2>'+(warnings.length?'<pre>'+esc(warnings.join('\\n'))+'</pre>':'<div class="muted">-</div>')+'</div></div>'
    +'<div class="card"><h2>'+esc(updateTx('logs'))+'</h2>'+(logs.length?'<pre>'+esc(logs.join('\\n'))+'</pre>':'<div class="muted">'+esc(updateTx('noLogs'))+'</div>')+(u.restartRequired?'<div class="fix">'+esc(updateTx('restartRequired'))+'</div>':'')+(u.lastError?'<div class="fix">'+esc(u.lastError)+'</div>':'')+'</div>';
}
function shortCommit(value){return value?String(value).slice(0,12):''}
async function checkUpdate(){updateStatus=await api('/api/update/check',{method:'POST',body:'{}'}); renderUpdate()}
async function applyUpdateNow(){updateStatus=await api('/api/update/apply',{method:'POST',body:'{}'}); renderUpdate()}
async function restartWorkflowApp(){updateStatus=await api('/api/update/restart',{method:'POST',body:'{}'}); renderUpdate()}
async function toggleAutoUpdate(){
  const next=(updateStatus&&updateStatus.autoUpdateMode)==='autoWhenIdle'?'off':'autoWhenIdle';
  updateStatus=await api('/api/update/config',{method:'POST',body:JSON.stringify({autoUpdateMode:next})});
  renderUpdate();
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
  const knowledgeTarget=localStorage.getItem(KNOWLEDGE_TARGET_CWD_KEY)||'';
  if(knowledgeTarget) return knowledgeTarget;
  const input=(document.getElementById('cwd')&&document.getElementById('cwd').value.trim())||'';
  return (selected&&selected.cwd)||input||(runs[0]&&runs[0].cwd)||'';
}
function docsApiPath(cwd, suffix){
  return '/api/projects/'+encodeURIComponent(cwd)+'/docs/'+suffix;
}
function knowledgeApiPath(cwd, suffix){
  return '/api/projects/'+encodeURIComponent(cwd)+'/knowledge/'+suffix;
}
function ragApiPath(cwd, suffix){
  return '/api/projects/'+encodeURIComponent(cwd)+'/rag/'+suffix;
}
function knowledgeTx(key){
  const ko={
    title:'Knowledge/RAG',
    detectSources:'지식 소스 감지',
    exportVault:'Vault 내보내기',
    rebuildRag:'RAG 재구축',
    verifyKnowledge:'지식 검증',
    findBetterRag:'더 나은 RAG 조합 찾기',
    loadRecommendations:'추천 불러오기',
    openLlms:'llms.txt 열기',
    openObsidian:'Obsidian 열기',
    noStatus:'지식 상태를 아직 불러오지 않았습니다.',
    currentPolicy:'현재 정책',
    sources:'소스',
    existingRag:'기존 RAG',
    vault:'Vault',
    index:'인덱스',
    verification:'검증',
    issues:'이슈 있음',
    none:'없음',
    exists:'존재',
    chunks:'청크',
    generated:'생성',
    manifest:'manifest',
    obsidian:'obsidian',
    fallback:'fallback',
    embedding:'embedding',
    absorbProject:'프로젝트 지식 흡수',
    compileCapabilities:'Capability Graph 생성',
    buildOwnIndex:'Workflow 인덱스 구축',
    evaluateIntegration:'기존 RAG와 비교',
    activateIntegration:'평가 통과 영역 활성화',
    integration:'흡수/재정립 상태',
    ownership:'소유권',
    rawSnapshot:'원본 snapshot',
    compiledGraph:'Capability Graph',
    evaluation:'평가',
    activation:'활성화',
    stale:'stale',
    records:'레코드',
    skills:'스킬',
    agents:'에이전트',
    policies:'라우팅 정책',
    passed:'통과',
    blockedSurfaces:'차단 영역',
    trace:'trace',
    active:'활성화됨',
    notStarted:'미시작',
    completed:'완료',
    partial:'부분 완료',
    failed:'실패',
    blocked:'차단됨',
    running:'진행 중',
    noTrace:'trace 없음'
  };
  const en={
    title:'Knowledge/RAG',
    detectSources:'Detect Sources',
    exportVault:'Export Vault',
    rebuildRag:'Rebuild RAG',
    verifyKnowledge:'Verify Knowledge',
    findBetterRag:'Find Better RAG Setup',
    loadRecommendations:'Load Recommendations',
    openLlms:'Open llms.txt',
    openObsidian:'Open Obsidian',
    noStatus:'No knowledge status loaded.',
    currentPolicy:'Current Policy',
    sources:'Sources',
    existingRag:'Existing RAG',
    vault:'Vault',
    index:'Index',
    verification:'Verification',
    issues:'issues',
    none:'none',
    exists:'exists',
    chunks:'chunks',
    generated:'generated',
    manifest:'manifest',
    obsidian:'obsidian',
    fallback:'fallback',
    embedding:'embedding',
    absorbProject:'Absorb Project Knowledge',
    compileCapabilities:'Build Capability Graph',
    buildOwnIndex:'Build Workflow Index',
    evaluateIntegration:'Compare Existing RAG',
    activateIntegration:'Activate Passed Surfaces',
    integration:'Absorb/Compile Status',
    ownership:'ownership',
    rawSnapshot:'raw snapshot',
    compiledGraph:'capability graph',
    evaluation:'evaluation',
    activation:'activation',
    stale:'stale',
    records:'records',
    skills:'skills',
    agents:'agents',
    policies:'routing policies',
    passed:'passed',
    blockedSurfaces:'blocked surfaces',
    trace:'trace',
    active:'active',
    notStarted:'not-started',
    completed:'completed',
    partial:'partial',
    failed:'failed',
    blocked:'blocked',
    running:'running',
    noTrace:'no trace'
  };
  return (language==='ko'?ko:en)[key]||key;
}
function ragTx(key){
  const ko={
    title:'Provider 추천',
    noLoaded:'RAG 추천을 아직 불러오지 않았습니다.',
    rankHelp:'순위와 추천도는 설치/검증을 완료했을 때의 조합 가치를 기준으로 합니다. 사용량 과금/유료 API 후보는 비용 보정으로 후순위에 두며, 현재 PC에서 바로 실행 가능한지는 준비 상태와 현재 실행 가능 점수로 따로 표시합니다.',
    scoreMeaning:'추천도',
    currentScore:'현재 실행 가능 점수',
    scoreExcellent:'매우 추천',
    scoreRecommended:'추천',
    scoreConditional:'조건부 추천',
    scoreNeedsPrep:'준비 후 검토',
    scoreLowPriority:'낮은 우선순위',
    immediateCandidates:'지금 바로 사용 가능한 후보',
    setupCandidates:'설치/설정 후 후보',
    computerFit:'내 PC 적합성',
    scoreBasis:'점수 근거',
    nextAction:'다음 행동',
    technicalDetails:'상세 기술 정보',
    disabledActions:'현재 실행할 수 없는 작업',
    disabledBecause:'불가능한 이유',
    summary:'요약',
    setupSummary:'추천 조합 요약',
    basis:'근거',
    providerCatalog:'Provider 카탈로그',
    lastAction:'마지막 작업',
    warnings:'경고',
    readyNow:'지금 사용 가능',
    installFirst:'설치 또는 조치 필요',
    noCached:'저장된 추천이 없습니다. “더 나은 RAG 조합 찾기”를 실행하세요.',
    entries:'개 항목',
    noGenerated:'아직 생성되지 않음',
    projectUnavailable:'프로젝트 프로필을 사용할 수 없습니다.',
    score:'점수',
    default:'기본값',
    pending:'대기',
    needsDocker:'Docker 필요',
    needsEmbedding:'embedding endpoint 필요',
    portConflict:'포트 충돌',
    externalData:'외부 데이터 전송',
    localData:'로컬/외부 전송 없음',
    externalEmbedding:'외부 embedding API',
    applySettings:'설정 적용',
    settingsApplied:'설정 적용됨',
    applyLocalSetup:'로컬 준비 + 설정 적용',
    localSetupReady:'로컬 준비 완료',
    actionInProgress:'진행 중',
    applyLocalSetupConfirm:'이 작업은 설정 변경, Docker 컨테이너 시작/생성, Ollama 모델 다운로드, 로컬 검증을 수행할 수 있습니다. 계속할까요?',
    applyLocalSetupUnavailable:'자동 로컬 준비 불가',
    externalKeyManual:'API 키가 필요한 외부 provider는 키 등록 후 설정 적용만 사용할 수 있습니다.',
    openAiCompatibleManual:'OpenAI-compatible 로컬 embedding 서버 준비는 v1에서 수동 설정 대상입니다.',
    localSetupBlocked:'먼저 차단된 로컬 요구사항을 해결해야 합니다.',
    healthCheck:'상태 확인',
    why:'추천 이유',
    risks:'위험',
    citations:'근거 링크',
    profile:'프로필',
    vectorDb:'Vector DB',
    readiness:'준비 상태',
    actionability:'실행 가능성',
    privacy:'프라이버시',
    cost:'비용',
    installEffort:'설치 난이도',
    requiredInstall:'필요 설치',
    blockingReasons:'차단 사유',
    data:'데이터',
    none:'없음',
    ok:'정상',
    failed:'실패',
    unreachable:'연결 안 됨',
    refreshing:'RAG provider 추천을 갱신하는 중입니다...',
    refreshed:'RAG provider 추천을 갱신했습니다. 설정은 변경하지 않았습니다.',
    applied:'설정을 적용했습니다: ',
    running:'실행 중: ',
    finished:'완료: ',
    opened:'열었습니다: ',
    openFailed:'열기 실패',
    runConfirmPrefix:'다음 작업을 실행할까요: ',
    runConfirmSuffix:'? 로컬 서비스를 시작하거나 모델 파일을 다운로드할 수 있습니다.',
    downloadModel:'모델 다운로드 ',
    files:'파일',
    codeRatio:'코드 비율',
    koreanRatio:'한국어 비율',
    existingRag:'기존 RAG',
    embeddingEndpoints:'embedding endpoints',
    apiKeys:'API 키',
    engineRunning:'엔진 실행 중',
    installed:'설치됨',
    missing:'없음',
    runningState:'실행 중',
    compatibleOnly:'compatible-only',
    pullDisabled:'pull 비활성',
    reachable:'연결 가능',
    validated:'검증됨',
    ready:'준비됨',
    partial:'일부 준비',
    blocked:'차단됨',
    installRequired:'설치 필요',
    needsStart:'시작 필요',
    needsInstall:'설치 필요',
    needsModel:'모델 필요',
    needsKey:'API 키 필요'
  };
  const en={
    title:'Provider Recommendations',
    noLoaded:'No RAG recommendation loaded.',
    rankHelp:'Ranks and recommendation scores show the setup value after install/validation. Usage-based or paid API options receive a cost penalty and are ranked after comparable local/free options. Current local actionability is shown separately.',
    scoreMeaning:'Recommendation score',
    currentScore:'Current readiness score',
    scoreExcellent:'excellent',
    scoreRecommended:'recommended',
    scoreConditional:'conditional',
    scoreNeedsPrep:'needs preparation',
    scoreLowPriority:'low priority',
    immediateCandidates:'Ready now',
    setupCandidates:'After setup',
    computerFit:'Fit for this computer',
    scoreBasis:'Score basis',
    nextAction:'Next action',
    technicalDetails:'Technical details',
    disabledActions:'Disabled actions',
    disabledBecause:'Disabled because',
    summary:'Summary',
    setupSummary:'Recommendation setup summary',
    basis:'Basis',
    providerCatalog:'Provider Catalog',
    lastAction:'Last Action',
    warnings:'Warnings',
    readyNow:'Ready now',
    installFirst:'Install or unblock first',
    noCached:'No recommendations cached. Click Find Better RAG Setup.',
    entries:'entries',
    noGenerated:'not generated',
    projectUnavailable:'project profile unavailable',
    score:'score',
    default:'default',
    pending:'pending',
    needsDocker:'Needs Docker',
    needsEmbedding:'Needs embedding endpoint',
    portConflict:'Port conflict',
    externalData:'External data',
    localData:'local/no external data',
    externalEmbedding:'external embedding API',
    applySettings:'Apply Settings',
    settingsApplied:'Settings Applied',
    applyLocalSetup:'Prepare Local + Apply Settings',
    localSetupReady:'Local Ready',
    actionInProgress:'Running',
    applyLocalSetupConfirm:'This can change settings, start/create Docker containers, download Ollama models, and run local validation. Continue?',
    applyLocalSetupUnavailable:'Local auto-prepare unavailable',
    externalKeyManual:'External providers that require API keys can only use Apply Settings after the key is registered manually.',
    openAiCompatibleManual:'OpenAI-compatible local embedding server setup is manual in v1.',
    localSetupBlocked:'Resolve the blocked local prerequisite first.',
    healthCheck:'Health Check',
    why:'Why',
    risks:'Risks',
    citations:'Citations',
    profile:'profile',
    vectorDb:'vectorDb',
    readiness:'readiness',
    actionability:'actionability',
    privacy:'privacy',
    cost:'cost',
    installEffort:'installEffort',
    requiredInstall:'requiredInstall',
    blockingReasons:'blockingReasons',
    data:'data',
    none:'none',
    ok:'ok',
    failed:'failed',
    unreachable:'unreachable',
    refreshing:'Refreshing RAG provider recommendations...',
    refreshed:'RAG provider recommendations refreshed. Settings were not changed.',
    applied:'Applied ',
    running:'Running ',
    finished:'Finished ',
    opened:'Opened ',
    openFailed:'Open failed',
    runConfirmPrefix:'Run ',
    runConfirmSuffix:'? This may start a local service or download model files.',
    downloadModel:'download model ',
    files:'files',
    codeRatio:'codeRatio',
    koreanRatio:'koreanRatio',
    existingRag:'existingRag',
    embeddingEndpoints:'embeddingEndpoints',
    apiKeys:'apiKeys',
    engineRunning:'engine-running',
    installed:'installed',
    missing:'missing',
    runningState:'running',
    compatibleOnly:'compatible-only',
    pullDisabled:'pull=disabled',
    reachable:'reachable',
    validated:'validated',
    ready:'ready',
    partial:'partial',
    blocked:'blocked',
    installRequired:'install-required',
    needsStart:'needs-start',
    needsInstall:'needs-install',
    needsModel:'needs-model',
    needsKey:'needs-key'
  };
  return (language==='ko'?ko:en)[key]||key;
}
function ragReadinessText(value){
  return ({ready:ragTx('ready'),partial:ragTx('partial'),blocked:ragTx('blocked'),'install-required':ragTx('installRequired')})[value]||value||'';
}
function ragActionabilityText(value){
  return ({ready:ragTx('ready'),'needs-start':ragTx('needsStart'),'needs-install':ragTx('needsInstall'),'needs-model':ragTx('needsModel'),'needs-key':ragTx('needsKey'),blocked:ragTx('blocked')})[value]||value||'';
}
function ragActionLabel(action,label){
  if(language==='en') return label||action;
  const labels={
    health:'상태 확인',
    'install-docker-desktop':'Docker Desktop 설치',
    'start-docker-engine':'Docker Engine 시작',
    'install-native-ollama':'native Ollama 설치',
    'start-native-ollama':'native Ollama 시작',
    'start-qdrant':'Qdrant 시작',
    'start-chroma':'Chroma 시작',
    'pull-ollama-model':'Ollama 모델 받기',
    'validate-embedding-endpoint':'embedding endpoint 검증',
    'validate-vector-db':'vector DB 검증',
    'prepare-local-and-apply':'로컬 준비 + 설정 적용',
    'prepare-qdrant':'Qdrant 준비 확인',
    'prepare-chroma':'Chroma 준비 확인'
  };
  return labels[action]||label||action;
}
function ragEnvState(kind, value){
  if(language==='en') return kind+'='+value;
  return kind+'='+({
    'engine-running':ragTx('engineRunning'),
    installed:ragTx('installed'),
    missing:ragTx('missing'),
    running:ragTx('runningState'),
    'compatible-only':ragTx('compatibleOnly'),
    reachable:ragTx('reachable'),
    validated:ragTx('validated')
  })[value]||value;
}
function renderKnowledgeProjectSelector(cwd){
  const label=language==='ko'?'대상 프로젝트 경로':'Target project path';
  const openLabel=language==='ko'?'대상 프로젝트 열기':'Load target';
  const lostarkLabel=language==='ko'?'Lostark 파일럿':'Lostark pilot';
  const resetLabel=language==='ko'?'현재 프로젝트로 되돌리기':'Back to current project';
  return '<div class="row doc-actions"><label class="muted" for="knowledgeTargetCwd">'+esc(label)+'</label>'
    +'<input id="knowledgeTargetCwd" style="min-width:360px;flex:1;background:#0d1117;border:1px solid var(--line);border-radius:6px;color:var(--text);padding:8px" value="'+esc(cwd||'')+'" placeholder="D:\\\\Github\\\\lostark" />'
    +'<button class="secondary" onclick="switchKnowledgeCwd()">'+esc(openLabel)+'</button>'
    +'<button class="secondary" onclick="useLostarkKnowledgeCwd()">'+esc(lostarkLabel)+'</button>'
    +'<button class="secondary" onclick="resetKnowledgeCwd()">'+esc(resetLabel)+'</button></div>';
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
    const knowledge=await api(knowledgeApiPath(cwd,'status'));
    const ragRecommendations=await api(ragApiPath(cwd,'recommendations'));
    docsState={cwd,profile:profile.profile,cache,knowledge,verification:null,recommendation:null,ragRecommendations,ragAction:null,pendingRagAction:null,knowledgeAction:null,pendingKnowledgeAction:null,error:''};
  }catch(e){
    docsState={cwd,profile:null,cache:null,knowledge:null,verification:null,recommendation:null,ragRecommendations:null,ragAction:null,pendingRagAction:null,knowledgeAction:null,pendingKnowledgeAction:null,error:e.message};
  }
  renderDocs();
}
function renderDocs(){
  const cwd=docsState.cwd||currentDocsCwd();
  const profile=docsState.profile||{};
  const cache=docsState.cache||{};
  const knowledge=docsState.knowledge||cache.knowledge||{};
  const scanned=cache.scanned||[];
  const bundles=cache.bundles||[];
  const profileJson=JSON.stringify(profile,null,2);
  document.getElementById('detail').innerHTML=
    '<div class="card"><h2>'+esc(docsTx('title'))+'</h2><div class="muted">'+esc(cwd)+'</div>'+renderKnowledgeProjectSelector(cwd)+'<div class="muted">'+esc(docsTx('branchRule'))+'</div>'+(docsState.error?'<div class="fix">'+esc(docsState.error)+'</div>':'')+'</div>'
    +'<div class="card"><h2>'+esc(docsTx('profile'))+'</h2><textarea id="docsProfileEditor" class="docs-editor">'+esc(profileJson)+'</textarea><div class="row doc-actions"><button onclick="saveDocsProfile()">'+esc(docsTx('save'))+'</button><button class="secondary" onclick="scanDocs()">'+esc(docsTx('scan'))+'</button><button class="secondary" onclick="recommendDocs()">'+esc(docsTx('recommend'))+'</button><button class="secondary" onclick="rebuildDocsCache()">'+esc(docsTx('rebuild'))+'</button><button class="secondary" onclick="refreshDocsCache()">'+esc(docsTx('refresh'))+'</button></div></div>'
    +'<div class="card"><h2>'+esc(knowledgeTx('title'))+'</h2>'+renderKnowledgeActionButtons()+renderKnowledgeStatus(knowledge)+renderRagRecommendations(docsState.ragRecommendations)+'</div>'
    +'<div class="card"><h2>'+esc(docsTx('scanned'))+'</h2>'+renderScannedDocs(scanned)+'</div>'
    +'<div class="card"><h2>'+esc(docsTx('bundles'))+'</h2>'+renderDocBundles(bundles)+'</div>'
    +(docsState.recommendation?'<div class="card"><h2>'+esc(docsTx('reasons'))+'</h2>'+renderRecommendationReasons(docsState.recommendationReasons||[])+'</div><div class="card"><h2>'+esc(docsTx('recommendation'))+'</h2><pre>'+esc(docsState.recommendation)+'</pre></div>':'');
}
function renderKnowledgeActionButtons(){
  const pending=docsState.pendingKnowledgeAction;
  const actions=[
    ['detectKnowledge','detectSources','secondary',false],
    ['exportKnowledgeVault','exportVault','secondary',false],
    ['absorbKnowledge','absorbProject','',false],
    ['compileKnowledge','compileCapabilities','',false],
    ['buildKnowledgeIndex','buildOwnIndex','',false],
    ['evaluateKnowledgeIntegration','evaluateIntegration','secondary',false],
    ['activateKnowledgeIntegration','activateIntegration','secondary',knowledgeActivationBlocked()],
    ['verifyKnowledge','verifyKnowledge','secondary',false],
    ['findBetterRagSetup','findBetterRag','secondary',false],
    ['refreshRagRecommendations','loadRecommendations','secondary',false],
    ['openKnowledgeLlms','openLlms','secondary',false],
    ['openKnowledgeObsidian','openObsidian','secondary',false]
  ];
  return '<div class="row doc-actions">'+actions.map(a=>{
    const fn=a[0], key=a[1], cls=a[2], blocked=!!a[3];
    const disabled=pending||blocked;
    const label=pending&&pending.key===key?knowledgeTx('running'):knowledgeTx(key);
    const title=blocked?knowledgeTx('blocked'):pending?knowledgeTx('running'):'';
    const onclick=fn==='openKnowledgeLlms'?'openKnowledgeTarget(\\'llms\\')':(fn==='openKnowledgeObsidian'?'openKnowledgeTarget(\\'obsidian\\')':fn+'()');
    return '<button '+(cls?'class="'+cls+'" ':'')+(disabled?'disabled title="'+esc(title)+'" ':'')+'onclick="'+onclick+'">'+esc(label)+'</button>';
  }).join('')+'</div>';
}
function knowledgeActivationBlocked(){
  const integration=docsState.knowledge&&docsState.knowledge.integration;
  if(!integration||!integration.evaluation||!integration.evaluation.exists) return true;
  if(integration.activation&&integration.activation.status==='active') return true;
  return !(integration.evaluation.passedSurfaces||[]).length;
}
function renderKnowledgeStatus(k){
  if(!k||!k.detection) return '<div class="muted">'+esc(knowledgeTx('noStatus'))+'</div>';
  const sources=k.detection.sources||[];
  const existing=k.detection.existingRag||[];
  const index=k.index||{};
  const vault=k.vault||{};
  const config=k.config||{};
  return '<div class="timeline">'
    +'<div class="stage"><b>'+esc(knowledgeTx('currentPolicy'))+'</b><span>'+esc((config.mode||'')+' / '+(config.preferred||''))+'</span><span>'+esc(knowledgeTx('fallback')+'='+(config.fallback||'')+' vectorDb='+((config.vectorDb&&config.vectorDb.provider)||'')+' '+knowledgeTx('embedding')+'='+((config.embedding&&config.embedding.provider)||'')+'/'+((config.embedding&&config.embedding.model)||''))+'</span></div>'
    +'<div class="stage"><b>'+esc(knowledgeTx('sources'))+'</b><span>'+esc(String(sources.length))+'</span><span>'+esc(sources.map(s=>s.id+': '+s.type+(s.path?' @ '+s.path:'')).join('\\n').slice(0,1200))+'</span></div>'
    +'<div class="stage"><b>'+esc(knowledgeTx('existingRag'))+'</b><span>'+esc(String(existing.length))+'</span><span>'+esc(existing.map(s=>s.id+' '+(s.detectedBy||'')).join('\\n')||knowledgeTx('none'))+'</span></div>'
    +'<div class="stage"><b>'+esc(knowledgeTx('vault'))+'</b><span>'+esc(vault.path||'')+'</span><span>'+esc(knowledgeTx('manifest')+'='+!!vault.manifestExists+' llms='+!!vault.llmsExists+' '+knowledgeTx('obsidian')+'='+!!vault.obsidianExists)+'</span></div>'
    +'<div class="stage"><b>'+esc(knowledgeTx('index'))+'</b><span>'+esc(index.path||'')+'</span><span>'+esc(knowledgeTx('exists')+'='+!!index.exists+' '+knowledgeTx('chunks')+'='+(index.chunkCount||0)+' '+knowledgeTx('generated')+'='+(index.generatedAt||''))+'</span></div>'
    +renderKnowledgeIntegrationStatus(k.integration)
    +(docsState.verification?'<div class="stage"><b>'+esc(knowledgeTx('verification'))+'</b><span>'+esc(docsState.verification.ok?ragTx('ok'):knowledgeTx('issues'))+'</span><span>'+esc((docsState.verification.issues||[]).map(i=>i.severity+' '+i.code+' '+(i.path||'')+' '+localizedText(i.message||'')).join('\\n').slice(0,1600))+'</span></div>':'')
    +'</div>';
}
function renderKnowledgeIntegrationStatus(s){
  if(!s) return '';
  const manifest=s.manifest||{};
  const compiled=s.compiled||{};
  const evaluation=s.evaluation||{};
  const activation=s.activation||{};
  const ownership=(s.sourceOwnership||'')+' -> '+(s.derivedOwnership||'')+' / '+(s.strategy||'');
  const stale=(manifest.staleRecords||[]).map(r=>r.sourcePath+': '+r.staleReason).join('\\n');
  const compiledBody=[
    knowledgeTx('skills')+'='+(compiled.skillCount||0),
    knowledgeTx('agents')+'='+(compiled.agentCount||0),
    knowledgeTx('policies')+'='+(compiled.routingPolicyCount||0),
    (compiled.warnings||[]).join('\\n')
  ].filter(Boolean).join('\\n');
  const evalBody=[
    knowledgeTx('passed')+'='+(evaluation.passedSurfaces||[]).join(', '),
    knowledgeTx('blockedSurfaces')+'='+(evaluation.blockedSurfaces||[]).join(', '),
    knowledgeTx('trace')+'='+(evaluation.tracePath||knowledgeTx('noTrace'))
  ].join('\\n');
  const actionBody=docsState.knowledgeAction?[
    localizedText(docsState.knowledgeAction.message||''),
    docsState.knowledgeAction.recordCount!==undefined?knowledgeTx('records')+'='+docsState.knowledgeAction.recordCount:'',
    docsState.knowledgeAction.skillCount!==undefined?knowledgeTx('skills')+'='+docsState.knowledgeAction.skillCount:'',
    docsState.knowledgeAction.agentCount!==undefined?knowledgeTx('agents')+'='+docsState.knowledgeAction.agentCount:'',
    (docsState.knowledgeAction.warnings||docsState.knowledgeAction.blockedReasons||[]).map(localizedText).join('\\n')
  ].filter(Boolean).join('\\n'):'';
  return '<div class="stage"><b>'+esc(knowledgeTx('integration'))+'</b><span>'+esc(knowledgeTx('ownership'))+'</span><span>'+esc(ownership)+'</span></div>'
    +'<div class="stage"><b>'+esc(knowledgeTx('rawSnapshot'))+'</b><span>'+esc((manifest.exists?knowledgeTx('exists'):knowledgeTx('notStarted'))+' / '+knowledgeTx('records')+'='+(manifest.recordCount||0)+' / '+knowledgeTx('stale')+'='+(manifest.staleCount||0))+'</span><span>'+esc((manifest.path||'')+(stale?'\\n'+stale:''))+'</span></div>'
    +'<div class="stage"><b>'+esc(knowledgeTx('compiledGraph'))+'</b><span>'+esc(compiled.exists?knowledgeTx('completed'):knowledgeTx('notStarted'))+'</span><span>'+esc((compiled.path||'')+'\\n'+compiledBody)+'</span></div>'
    +'<div class="stage"><b>'+esc(knowledgeTx('evaluation'))+'</b><span>'+esc(evaluation.exists?(evaluation.ok?knowledgeTx('completed'):knowledgeTx('partial')):knowledgeTx('notStarted'))+'</span><span>'+esc((evaluation.path||'')+'\\n'+evalBody)+'</span></div>'
    +'<div class="stage"><b>'+esc(knowledgeTx('activation'))+'</b><span>'+esc(knowledgeStatusText(activation.status))+'</span><span>'+esc((activation.activatedSurfaces||[]).join(', ')||knowledgeTx('none'))+'</span></div>'
    +(actionBody?'<div class="stage"><b>'+esc(ragTx('lastAction'))+'</b><span>'+esc(docsState.knowledgeAction.status||'ok')+'</span><span><pre>'+esc(actionBody)+'</pre></span></div>':'');
}
function knowledgeStatusText(value){
  return ({'not-started':knowledgeTx('notStarted'),completed:knowledgeTx('completed'),partial:knowledgeTx('partial'),failed:knowledgeTx('failed'),blocked:knowledgeTx('blocked'),active:knowledgeTx('active'),stale:knowledgeTx('stale'),running:knowledgeTx('running')})[value]||value||knowledgeTx('notStarted');
}
function renderRagRecommendations(result){
  if(!result) return '<h2>'+esc(ragTx('title'))+'</h2><div class="muted">'+esc(ragTx('noLoaded'))+'</div>';
  const recs=result.recommendations||[];
  const warnings=result.warnings||[];
  const env=result.environment||{};
  const project=result.project||{};
  const catalog=result.providerCatalog&&result.providerCatalog.entries?result.providerCatalog.entries:[];
  const actionBody=docsState.ragAction?[
    localizedText(docsState.ragAction.message||''),
    localizedText((docsState.ragAction.blockingReasons||[]).join('\\n')),
    localizedText((docsState.ragAction.suggestedActions||[]).join('\\n')),
    docsState.ragAction.command||'',
    docsState.ragAction.output||''
  ].filter(Boolean).join('\\n'):'';
  const actionText=docsState.ragAction?'<div class="stage"><b>'+esc(ragTx('lastAction'))+'</b><span>'+esc(statusText(docsState.ragAction.status||(docsState.ragAction.ok?'ok':'failed')))+'</span><span><pre>'+esc(actionBody)+'</pre></span></div>':'';
  const ready=recs.filter(r=>r.readiness==='ready');
  const pending=recs.filter(r=>r.readiness!=='ready');
  return '<h2>'+esc(ragTx('title'))+'</h2>'
    +'<div class="rag-help">'+esc(ragTx('rankHelp'))+'</div>'
    +'<div class="rag-summary-grid">'
    +renderRagSummaryCard(ragTx('immediateCandidates'),String(ready.length),ready.map(r=>'#'+r.rank+' '+displayRecommendationTitle(r)).join('\\n')||ragTx('none'))
    +renderRagSummaryCard(ragTx('setupCandidates'),String(pending.length),pending.map(r=>'#'+r.rank+' '+displayRecommendationTitle(r)+' ['+ragReadinessText(r.readiness||'unknown')+']').join('\\n')||ragTx('none'))
    +renderRagSummaryCard(ragTx('basis'),result.generatedAt||ragTx('noGenerated'),ragEnvironmentSummary(env)+'\\n'+ragProjectSummary(project))
    +(catalog.length?renderRagSummaryCard(ragTx('providerCatalog'),String(catalog.length)+' '+ragTx('entries'),catalog.map(e=>e.id+': '+(e.reachable===false?ragTx('unreachable'):ragTx('ok'))+' '+(e.retrievedTitle||e.title)).join('\\n')):'')
    +'</div>'
    +'<div class="timeline">'
    +actionText
    +(warnings.length?'<div class="stage"><b>'+esc(ragTx('warnings'))+'</b><span>'+esc(String(warnings.length))+'</span><span>'+esc(warnings.map(localizedText).join('\\n'))+'</span></div>':'')
    +(recs.length?recs.map(renderRagRecommendation).join(''):'<div class="muted">'+esc(ragTx('noCached'))+'</div>')
    +'</div>';
}
function renderRagSummaryCard(title,count,body){
  return '<div class="rag-summary-card"><b>'+esc(title)+'</b><div class="status">'+esc(count)+'</div><pre>'+esc(body||ragTx('none'))+'</pre></div>';
}
function ragEnvironmentSummary(env){
  return [
    env.docker?ragEnvState('docker',(env.docker.engineRunning||env.docker.running?'engine-running':(env.docker.installed?'installed':'missing'))):'',
    env.ollama?ragEnvState('ollama',(env.ollama.running?(env.ollama.native===false?'compatible-only':'running'):'missing'))+(env.ollama.canPullModels===false?' '+ragTx('pullDisabled'):''):'',
    env.qdrant?ragEnvState('qdrant',(env.qdrant.reachable?'reachable':'missing'))+' '+localizedText(env.qdrant.message||''):'',
    env.chroma?ragEnvState('chroma',(env.chroma.reachable?'reachable':'missing'))+' '+localizedText(env.chroma.message||''):'',
    env.embeddingEndpoints?ragTx('embeddingEndpoints')+'='+(env.embeddingEndpoints||[]).map(e=>e.kind+':'+(e.runtimeState&&e.runtimeState.validated?ragTx('validated'):(e.runtimeState&&e.runtimeState.reachable?ragTx('reachable'):ragTx('missing')))).join(', '):'',
    env.apiKeys?ragTx('apiKeys')+'='+(env.apiKeys.length?env.apiKeys.join(', '):ragTx('none')):''
  ].filter(Boolean).join(' | ');
}
function ragProjectSummary(project){
  if(!project.repoFileCount) return ragTx('projectUnavailable');
  return ragTx('files')+'='+project.repoFileCount+' '+ragTx('codeRatio')+'='+project.codeFileRatio+' '+ragTx('koreanRatio')+'='+project.koreanCharRatio+' '+ragTx('existingRag')+'='+(project.existingRagKinds||[]).join(', ');
}
function renderRagRecommendation(r){
  const installs=(r.requiredInstall||[]).length?(r.requiredInstall||[]).join(', '):ragTx('none');
  const dataPolicy=r.externalData?ragTx('externalEmbedding'):ragTx('localData');
  const applied=(docsState.knowledge&&docsState.knowledge.config&&docsState.knowledge.config.recommendation&&docsState.knowledge.config.recommendation.appliedProfileId)===r.profileId;
  const blockingItems=localizedRecommendationItems(r,'blockingReasonsKo','blockingReasons');
  const blocking=blockingItems.length?blockingItems.join('\\n'):ragTx('none');
  const fitItems=localizedRecommendationItems(r,'fitForThisComputerKo',null);
  const scoreItems=localizedRecommendationItems(r,'scoreExplanationKo',null);
  const whyItems=localizedRecommendationItems(r,'whyKo','why');
  const riskItems=localizedRecommendationItems(r,'risksKo','risks');
  const nextStep=(language==='ko'&&r.nextStepKo)?r.nextStepKo:(r.readiness==='ready'?'Ready to apply or validate.':'Prepare the blocked requirements, then refresh recommendations.');
  const details=[
    ragTx('profile')+'='+r.profileId,
    ragTx('vectorDb')+'='+r.vectorDb,
    ragTx('embedding')+'='+r.embeddingProvider+'/'+r.embeddingModel,
    ragTx('scoreMeaning')+'='+String(r.score||0)+'/100',
    ragTx('currentScore')+'='+String(r.readinessAdjustedScore||r.score||0)+'/100',
    ragTx('readiness')+'='+ragReadinessText(r.readiness||'unknown'),
    ragTx('actionability')+'='+ragActionabilityText(r.actionability||'unknown'),
    ragTx('privacy')+'='+r.privacy,
    ragTx('cost')+'='+r.cost,
    ragTx('installEffort')+'='+r.installEffort,
    ragTx('requiredInstall')+'='+installs,
    ragTx('blockingReasons')+'='+blocking,
    ragTx('data')+'='+dataPolicy,
    r.reranker?('reranker='+r.reranker):'',
    '',
    ragTx('citations')+':',
    ...((r.citations||[]).map(c=>'- '+c.title+(c.url?' <'+c.url+'>':'')+(c.reachable===false?' (unverified)':'')+(c.retrievedTitle?' title='+c.retrievedTitle:'')))
  ].filter(Boolean).join('\\n');
  const currentScoreLine=(r.readinessAdjustedScore!==undefined&&Number(r.readinessAdjustedScore)!==Number(r.score))
    ? '<div class="muted">'+esc(ragTx('currentScore')+' '+String(r.readinessAdjustedScore)+'/100 · '+ragScoreLabelText(r.readinessAdjustedScoreLabel||scoreLabelFromScore(r.readinessAdjustedScore)))+'</div>'
    : '';
  return '<div class="rag-card '+esc(r.readiness||'unknown')+'">'
    +'<div class="rag-card-head"><div><div class="rag-title">#'+esc(String(r.rank||''))+' '+esc(displayRecommendationTitle(r))+'</div><div class="rag-summary">'+esc(displayRecommendationSummary(r))+'</div><div class="rag-meta">'+renderRagBadges(r,applied)+'</div></div><div class="rag-score">'+esc(ragTx('scoreMeaning')+' '+String(r.score||0)+'/100 · '+ragScoreLabelText(r.scoreLabel||scoreLabelFromScore(r.score||0)))+currentScoreLine+'</div></div>'
    +'<div class="rag-sections">'
    +renderRagListSection(ragTx('computerFit'),fitItems,ragTx('none'))
    +renderRagListSection(ragTx('scoreBasis'),scoreItems,ragTx('none'))
    +renderRagListSection(ragTx('why'),whyItems,ragTx('none'))
    +renderRagListSection(ragTx('risks'),riskItems,ragTx('none'))
    +(blockingItems.length?renderRagListSection(ragTx('blockingReasons'),blockingItems,ragTx('none')):'')
    +renderRagListSection(ragTx('nextAction'),[nextStep],ragTx('none'))
    +'</div>'
    +'<div class="rag-actions">'+renderApplySettingsButton(r,applied)+renderLocalPrepareApplyButton(r,applied)+renderRagActionButtons(r)+renderCitationLinks(r.citations||[])+'</div>'
    +renderDisabledRagActions(r)
    +'<details class="rag-details"><summary>'+esc(ragTx('technicalDetails'))+'</summary><pre>'+esc(details)+'</pre></details>'
    +'</div>';
}
function displayRecommendationTitle(r){
  return language==='ko'?(r.titleKo||r.title||r.profileId):(r.title||r.profileId);
}
function displayRecommendationSummary(r){
  if(language==='ko'&&r.summaryKo) return r.summaryKo;
  return localizedText(r.summary||((r.why||[])[0])||'');
}
function localizedRecommendationItems(r,koKey,fallbackKey){
  if(language==='ko'&&Array.isArray(r[koKey])&&r[koKey].length) return r[koKey];
  if(fallbackKey&&Array.isArray(r[fallbackKey])) return r[fallbackKey].map(localizedText);
  return [];
}
function renderRagListSection(title,items,emptyText){
  const list=(items||[]).filter(Boolean);
  return '<div class="rag-section"><h3>'+esc(title)+'</h3>'+(list.length?'<ul class="rag-list">'+list.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>':'<div class="muted">'+esc(emptyText)+'</div>')+'</div>';
}
function scoreLabelFromScore(score){
  const value=Number(score||0);
  if(value>=80) return 'excellent';
  if(value>=60) return 'recommended';
  if(value>=40) return 'conditional';
  if(value>=20) return 'needs-prep';
  return 'low-priority';
}
function ragScoreLabelText(label){
  return ({
    excellent:ragTx('scoreExcellent'),
    recommended:ragTx('scoreRecommended'),
    conditional:ragTx('scoreConditional'),
    'needs-prep':ragTx('scoreNeedsPrep'),
    'low-priority':ragTx('scoreLowPriority')
  })[label]||label||'';
}
function renderRagBadges(r,applied){
  const badges=[];
  badges.push('<span class="status '+esc(r.currentDefault?'default':(applied?'ok':'pending'))+'">'+esc(r.currentDefault?ragTx('default'):(applied?ragTx('ok'):ragTx('pending')))+'</span>');
  badges.push('<span class="status '+esc(r.readiness||'unknown')+'">'+esc(r.readiness==='ready'?ragTx('readyNow'):ragReadinessText(r.readiness||'unknown'))+'</span>');
  if(r.actionability) badges.push('<span class="status">'+esc(ragActionabilityText(r.actionability))+'</span>');
  if((r.blockingReasons||[]).some(x=>/Docker/i.test(x))) badges.push('<span class="status warn">'+esc(ragTx('needsDocker'))+'</span>');
  if((r.blockingReasons||[]).some(x=>/embedding endpoint|Ollama-compatible|model/i.test(x))) badges.push('<span class="status warn">'+esc(ragTx('needsEmbedding'))+'</span>');
  if((r.blockingReasons||[]).some(x=>/port|occupied/i.test(x))) badges.push('<span class="status fail">'+esc(ragTx('portConflict'))+'</span>');
  if(r.externalData) badges.push('<span class="status warn">'+esc(ragTx('externalData'))+'</span>');
  return badges.join(' ');
}
function renderRagActionButtons(r){
  const actions=r.nextActions||[{action:'health',label:ragTx('healthCheck'),requiresConfirm:false,enabled:true}];
  const pending=!!docsState.pendingRagAction;
  return actions.filter(a=>a.enabled!==false).map(a=>'<button class="secondary" '+(pending?'disabled title="'+esc(ragTx('actionInProgress'))+'" ':'')+'onclick="runRagAction(\\''+jsArg(a.action)+'\\',\\''+jsArg(r.profileId)+'\\',\\''+jsArg(a.model||r.embeddingModel||'')+'\\','+(a.requiresConfirm?'true':'false')+')">'+esc(pending&&docsState.pendingRagAction.profileId===r.profileId?ragTx('actionInProgress'):ragActionLabel(a.action,a.label||a.action))+'</button>').join('');
}
function renderApplySettingsButton(r,applied){
  if(docsState.pendingRagAction){
    return '<button class="secondary" disabled title="'+esc(ragTx('actionInProgress'))+'">'+esc(docsState.pendingRagAction.profileId===r.profileId?ragTx('actionInProgress'):ragTx('applySettings'))+'</button>';
  }
  if(applied){
    return '<button class="secondary" disabled>'+esc(ragTx('settingsApplied'))+'</button>';
  }
  return '<button class="secondary" onclick="applyRagRecommendation(\\''+jsArg(r.profileId)+'\\')">'+esc(ragTx('applySettings'))+'</button>';
}
function renderLocalPrepareApplyButton(r,applied){
  const state=localPrepareApplyState(r);
  const prepared=applied&&r.readiness==='ready'&&r.actionability==='ready';
  if(docsState.pendingRagAction){
    return '<button disabled title="'+esc(ragTx('actionInProgress'))+'">'+esc(docsState.pendingRagAction.profileId===r.profileId?ragTx('actionInProgress'):ragTx('applyLocalSetup'))+'</button>';
  }
  if(prepared){
    return '<button class="secondary" disabled>'+esc(ragTx('localSetupReady'))+'</button>';
  }
  if(state.enabled) return '<button onclick="applyLocalRagRecommendation(\\''+jsArg(r.profileId)+'\\')">'+esc(ragTx('applyLocalSetup'))+'</button>';
  return '<button class="secondary" disabled title="'+esc(state.reason)+'">'+esc(ragTx('applyLocalSetup'))+'</button>';
}
function localPrepareApplyState(r){
  const provider=String(r.embeddingProvider||'').toLowerCase();
  const required=(r.requiredInstall||[]).join(' ');
  if(provider==='openai'||provider==='voyage'||/api[_-]?key/i.test(required)||r.actionability==='needs-key'){
    return {enabled:false,reason:ragTx('externalKeyManual')};
  }
  if(provider==='openai-compatible'&&(r.blockingReasons||[]).some(x=>/OpenAI-compatible local embedding endpoint/i.test(x))){
    return {enabled:false,reason:ragTx('openAiCompatibleManual')};
  }
  if(r.readiness==='ready'||provider==='ollama'||String(r.vectorDb||'').toLowerCase().includes('qdrant')||String(r.vectorDb||'').toLowerCase().includes('chroma')||!(r.blockingReasons||[]).length) return {enabled:true,reason:''};
  return {enabled:false,reason:ragTx('localSetupBlocked')+' '+localizedText((r.blockingReasons||[]).join('\\n'))};
}
function renderDisabledRagActions(r){
  const disabled=(r.nextActions||[]).filter(a=>a.enabled===false);
  if(!disabled.length) return '';
  return '<div class="rag-disabled"><b>'+esc(ragTx('disabledActions'))+'</b><br>'+disabled.map(a=>esc(ragActionLabel(a.action,a.label||a.action))+' - '+esc(ragTx('disabledBecause')+': '+localizedText(a.disabledReason||''))).join('<br>')+'</div>';
}
function renderCitationLinks(citations){
  const links=(citations||[]).filter(c=>c.url).slice(0,5);
  if(!links.length) return '';
  return links.map(c=>'<a href="'+esc(c.url)+'" target="_blank" rel="noreferrer">'+esc(c.title)+'</a>').join(' ');
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
  docsState.knowledge=await api(knowledgeApiPath(docsState.cwd,'status'));
  renderDocs();
}
async function refreshDocsCache(){
  docsState.cache=await api(docsApiPath(docsState.cwd,'cache'));
  docsState.profile=docsState.cache.profile||docsState.profile;
  docsState.knowledge=await api(knowledgeApiPath(docsState.cwd,'status'));
  renderDocs();
}
async function detectKnowledge(){
  const detection=await api(knowledgeApiPath(docsState.cwd,'detect'),{method:'POST',body:'{}'});
  docsState.knowledge={...(docsState.knowledge||{}),detection};
  renderDocs();
}
async function exportKnowledgeVault(){
  docsState.exportResult=await api(knowledgeApiPath(docsState.cwd,'export'),{method:'POST',body:'{}'});
  docsState.knowledge=await api(knowledgeApiPath(docsState.cwd,'status'));
  renderDocs();
}
async function rebuildRagIndex(){
  docsState.ragIndex=await api(ragApiPath(docsState.cwd,'rebuild'),{method:'POST',body:'{}'});
  docsState.knowledge=await api(knowledgeApiPath(docsState.cwd,'status'));
  renderDocs();
}
async function absorbKnowledge(){await runKnowledgeAction('absorb','absorbProject');}
async function compileKnowledge(){await runKnowledgeAction('compile','compileCapabilities');}
async function buildKnowledgeIndex(){await runKnowledgeAction('index/build','buildOwnIndex');}
async function evaluateKnowledgeIntegration(){await runKnowledgeAction('integration/evaluate','evaluateIntegration');}
async function activateKnowledgeIntegration(){await runKnowledgeAction('integration/activate','activateIntegration');}
async function runKnowledgeAction(endpoint,key){
  docsState.pendingKnowledgeAction={endpoint,key};
  docsState.error=knowledgeTx('running')+' '+knowledgeTx(key)+'...';
  renderDocs();
  try{
    docsState.knowledgeAction=await api(knowledgeApiPath(docsState.cwd,endpoint),{method:'POST',body:'{}'});
    docsState.knowledge=await api(knowledgeApiPath(docsState.cwd,'status'));
    docsState.error=knowledgeTx(key)+' '+knowledgeTx('completed');
  }catch(e){
    docsState.error=e.message||String(e);
  }finally{
    docsState.pendingKnowledgeAction=null;
    renderDocs();
  }
}
async function switchKnowledgeCwd(){
  const input=document.getElementById('knowledgeTargetCwd');
  const cwd=(input&&input.value.trim())||'';
  if(!cwd) return;
  localStorage.setItem(KNOWLEDGE_TARGET_CWD_KEY,cwd);
  docsState={cwd,error:knowledgeTx('running')};
  renderDocs();
  await showDocs(false);
}
async function useLostarkKnowledgeCwd(){
  const cwd='D:\\\\Github\\\\lostark';
  localStorage.setItem(KNOWLEDGE_TARGET_CWD_KEY,cwd);
  docsState={cwd,error:knowledgeTx('running')};
  renderDocs();
  await showDocs(false);
}
async function resetKnowledgeCwd(){
  localStorage.removeItem(KNOWLEDGE_TARGET_CWD_KEY);
  docsState={cwd:'',error:knowledgeTx('running')};
  renderDocs();
  await showDocs(false);
}
async function findBetterRagSetup(){
  docsState.error=ragTx('refreshing');
  renderDocs();
  docsState.ragRecommendations=await api(ragApiPath(docsState.cwd,'recommend'),{method:'POST',body:JSON.stringify({refreshWeb:true})});
  docsState.knowledge=await api(knowledgeApiPath(docsState.cwd,'status'));
  docsState.error=ragTx('refreshed');
  renderDocs();
}
async function refreshRagRecommendations(){
  docsState.ragRecommendations=await api(ragApiPath(docsState.cwd,'recommendations'));
  renderDocs();
}
async function applyRagRecommendation(profileId){
  docsState.pendingRagAction={type:'apply-settings',profileId};
  docsState.error=ragTx('running')+ragTx('applySettings')+'...';
  renderDocs();
  try{
    const result=await api(ragApiPath(docsState.cwd,'recommendations/apply'),{method:'POST',body:JSON.stringify({profileId})});
    docsState.knowledge=await api(knowledgeApiPath(docsState.cwd,'status'));
    docsState.ragRecommendations=await api(ragApiPath(docsState.cwd,'recommendations'));
    docsState.error=localizedText(result.message||'')||(ragTx('applied')+profileId);
  }catch(e){
    docsState.error=e.message||String(e);
  }finally{
    docsState.pendingRagAction=null;
    renderDocs();
  }
}
async function applyLocalRagRecommendation(profileId){
  const rec=((docsState.ragRecommendations&&docsState.ragRecommendations.recommendations)||[]).find(r=>r.profileId===profileId);
  const title=rec?displayRecommendationTitle(rec):profileId;
  const state=rec?localPrepareApplyState(rec):{enabled:true,reason:''};
  if(!state.enabled){
    docsState.error=ragTx('applyLocalSetupUnavailable')+': '+state.reason;
    renderDocs();
    return;
  }
  if(!confirm(ragTx('applyLocalSetupConfirm')+'\\n\\n'+title)) return;
  docsState.pendingRagAction={type:'prepare-local-and-apply',profileId};
  docsState.error=ragTx('running')+ragTx('applyLocalSetup')+'...';
  renderDocs();
  try{
    docsState.ragAction=await api(ragApiPath(docsState.cwd,'recommendations/apply-local'),{method:'POST',body:JSON.stringify({profileId,confirm:true})});
    docsState.knowledge=await api(knowledgeApiPath(docsState.cwd,'status'));
    docsState.ragRecommendations=await api(ragApiPath(docsState.cwd,'recommendations'));
    docsState.error=localizedText(docsState.ragAction.message||'')||(ragTx('finished')+ragTx('applyLocalSetup'));
  }catch(e){
    docsState.error=e.message||String(e);
  }finally{
    docsState.pendingRagAction=null;
    renderDocs();
  }
}
async function runRagAction(action, profileId, model, requiresConfirm){
  const label=action==='pull-ollama-model'?ragTx('downloadModel')+model:ragActionLabel(action,action);
  if(requiresConfirm&&!confirm(ragTx('runConfirmPrefix')+label+ragTx('runConfirmSuffix'))) return;
  docsState.pendingRagAction={type:action,profileId};
  docsState.error=ragTx('running')+label+'...';
  renderDocs();
  try{
    docsState.ragAction=await api(ragApiPath(docsState.cwd,'actions'),{method:'POST',body:JSON.stringify({action,profileId,model,confirm:!!requiresConfirm})});
    docsState.knowledge=await api(knowledgeApiPath(docsState.cwd,'status'));
    docsState.ragRecommendations=await api(ragApiPath(docsState.cwd,'recommendations'));
    docsState.error=localizedText(docsState.ragAction.message||'')||(ragTx('finished')+label);
  }catch(e){
    docsState.error=e.message||String(e);
  }finally{
    docsState.pendingRagAction=null;
    renderDocs();
  }
}
async function verifyKnowledge(){
  docsState.verification=await api(knowledgeApiPath(docsState.cwd,'verify'),{method:'POST',body:'{}'});
  docsState.knowledge=await api(knowledgeApiPath(docsState.cwd,'status'));
  renderDocs();
}
async function openKnowledgeTarget(target){
  const result=await api(knowledgeApiPath(docsState.cwd,'open'),{method:'POST',body:JSON.stringify({target})});
  docsState.error=result.ok?ragTx('opened')+target:localizedText(result.error||ragTx('openFailed'));
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
  +renderKnowledgeRoutingTrace(r)
  +renderCancelInfo(r)
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
async function cancelRun(){await api('/api/runs/'+encodeURIComponent(selected.id)+'/cancel',{method:'POST',body:JSON.stringify({source:'ui',reason:'manual cancel from Workflow App UI'})}); await refresh()}
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
