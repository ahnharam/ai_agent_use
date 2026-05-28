# Codex Workflow 설치 가이드

이 문서는 다른 PC에서 `clone -> setup -> Codex Desktop plugin 등록 -> Workflow App 실행`까지 진행하는 절차를 정리한다.

## 구조

- Codex Desktop: 사용자가 지시를 입력하는 곳
- `codex-workflow` plugin/MCP: Codex Desktop에서 Workflow App backend를 호출하는 진입점
- Workflow App backend: `127.0.0.1:48731`에서 run 생성, agent 실행, 상태 저장, 승인 처리를 담당
- Workflow App UI: run 목록, agent 상태, diff, commit/push 승인, diagnostics를 확인하는 화면
- Codex App Server: multi-agent thread, compact/resume/fork, approval event 관제를 담당하는 기본 런타임
- Codex SDK: read-only/automation run에서 선택적으로 사용하는 경량 런타임

## 사전 준비

필수 항목:

- Git
- Node.js 20.19 이상 권장
- npm
- Codex Desktop 또는 Codex CLI
- Codex 로그인
- push까지 사용할 경우 로컬 GitHub credential 또는 git credential

기본 확인:

```powershell
git --version
node --version
npm --version
codex --version
```

Windows에서 `codex --version`이 `Access is denied`로 실패하면 PATH의 WindowsApps alias가 막힌 상태일 수 있다. setup 스크립트는 `%LOCALAPPDATA%\OpenAI\Codex\bin\codex.exe`를 자동으로 probe하고, 동작하는 경로를 `%USERPROFILE%\.codex-workflow\config.json`에 저장한다.

수동 확인이 필요할 때:

```powershell
Get-Command codex -All
& "$env:LOCALAPPDATA\OpenAI\Codex\bin\codex.exe" --version
```

## 빠른 설치

```powershell
git clone https://github.com/ahnharam/ai_agent_use.git haram_project
cd haram_project
powershell -ExecutionPolicy Bypass -File scripts/setup-codex-workflow.ps1 -StartApp
```

setup 스크립트가 수행하는 작업:

- Node/Git/npm/Codex 실행 가능 여부 확인
- WindowsApps `codex.exe Access is denied` 후보 우회
- `%USERPROFILE%\.codex-workflow\config.json`에 `projectRoot`, `codexExecutablePath`, `port` 저장
- `npm ci`
- `npm run compile`
- repo marketplace 등록 시도
- `-StartApp` 지정 시 Workflow App hidden process 실행 후 health check

옵션:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-codex-workflow.ps1 `
  -ProjectRoot "D:\Github\ai_agent\haram_project" `
  -CodexExecutablePath "$env:LOCALAPPDATA\OpenAI\Codex\bin\codex.exe" `
  -Port 48731 `
  -SkipNpmInstall `
  -SkipMarketplace `
  -StartApp
```

## 수동 설치

```powershell
npm ci
npm run compile
npm run workflow:serve
```

브라우저에서 다음 주소를 연다.

```text
http://127.0.0.1:48731/
```

health와 diagnostics 확인:

```powershell
Invoke-RestMethod http://127.0.0.1:48731/api/health
Invoke-RestMethod http://127.0.0.1:48731/api/diagnostics
```

`/api/runs` 같은 상태 변경 또는 run 데이터 API는 local capability token으로 보호된다. UI는 `/` 접속 시 HttpOnly cookie를 받아 같은 origin에서 호출한다. token 값은 `%USERPROFILE%\.codex-workflow\token`에 저장되며 UI와 diagnostics에는 원문을 표시하지 않는다.

## Codex Desktop plugin 등록

repo marketplace 파일은 다음 경로에 있다.

```text
.agents/plugins/marketplace.json
```

setup 스크립트를 쓰지 않고 직접 등록하려면:

```powershell
codex plugin marketplace add "D:\path\to\haram_project"
codex plugin marketplace upgrade
codex plugin marketplace --help
```

그 다음 Codex Desktop을 재시작하고 Plugins 화면에서 `Codex Workflow`를 설치 또는 활성화한다.

plugin이 보이지 않으면 확인할 것:

```powershell
Get-Content .agents\plugins\marketplace.json
Test-Path plugins\codex-workflow\.codex-plugin\plugin.json
Test-Path out\workflow-app\cli.js
Invoke-RestMethod http://127.0.0.1:48731/api/diagnostics
```

MCP server의 project root 탐색 순서:

1. `CODEX_WORKFLOW_PROJECT_ROOT`
2. `%USERPROFILE%\.codex-workflow\config.json`
3. plugin 상위 경로를 올라가며 repo scan
4. 기존 fallback 경로

## 사용법

Codex Desktop에서 명시적으로 Workflow App 실행을 요청한다.

```text
Workflow App으로 이 repo의 npm run compile 상태를 readOnly run으로 확인해줘.
```

```text
멀티 에이전트 워크플로우로 이 기능을 구현하고, commit/push 승인은 앱에서 받게 해줘.
```

```text
Workflow App gitOperation으로 현재 변경사항을 commit/push 승인 흐름으로 처리해줘.
```

일반 Codex Desktop 대화는 자동 감청하지 않는다. `Workflow App으로 실행`, `멀티 에이전트 워크플로우`, `gitOperation`처럼 명시된 요청만 MCP tool을 통해 run으로 등록한다.

## 승인 정책

- commit, push, merge-back은 Workflow App UI 승인 전에는 실행하지 않는다.
- 승인 시 backend가 최신 `git status`, conflict 상태, diff hash 또는 commit hash를 다시 검증한다.
- 충돌 파일이 있으면 commit 단계는 `blocked`가 되고 승인 대기 상태로 넘어가지 않는다.
- force push는 금지한다.
- GitHub push는 Codex 로그인과 별개로 로컬 git credential이 필요하다.

## 상태 파일

run 상태와 event log는 repo별로 저장된다.

```text
.ai-agent/runs/<run-id>.json
.ai-agent/runs/<run-id>.events.jsonl
```

local app 설정과 token은 PC별로 저장된다.

```text
%USERPROFILE%\.codex-workflow\config.json
%USERPROFILE%\.codex-workflow\token
```

`config.json`에는 `projectRoot`, `codexExecutablePath`, `port`만 저장한다. token은 별도 파일에 유지한다.

## Diagnostics

Workflow App header의 `Diagnostics` 버튼에서 다음 항목을 확인할 수 있다.

- Node.js
- npm
- Git
- Codex executable
- Codex app-server probe
- Codex SDK dependency
- Workflow App build output
- `.codex/agents`
- repo marketplace file
- local config
- local token 존재 여부
- API browser auth
- git credential hint

status는 `ok`, `warn`, `fail`, `unknown` 중 하나로 표시된다. `fail` 또는 `warn` 항목에는 remediation 문구가 함께 표시된다.

## 배포 artifact

GitHub Actions workflow는 다음 artifact를 만든다.

- `haram-ai-agent-vsix`: VS Code 확장 설치용 VSIX
- `codex-workflow-app`: Workflow App, plugin, agent 정의, 설치 스크립트, 문서를 포함한 zip

수동 실행은 GitHub Actions의 `Codex Workflow Artifacts` workflow에서 `workflow_dispatch`로 수행할 수 있다.

## 후속 phase

이번 버전은 설치성과 로컬 운영성을 우선한다. 다음 항목은 구조만 문서화하고 별도 phase로 남긴다.

- SQLite 상태 저장: 기존 JSON 파일을 read-through 방식으로 유지하면서 `.ai-agent/workflow.db`를 선택적으로 추가
- Remote monitor: 기본은 localhost 유지, 외부 bind는 TLS, origin allowlist, capability token 정책을 별도 설계한 뒤 제공

## 최소 점검 체크리스트

새 PC에서 아래 항목이 통과하면 기본 설치는 완료된 것이다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-codex-workflow.ps1 -SkipMarketplace -StartApp
Invoke-RestMethod http://127.0.0.1:48731/api/health
Invoke-RestMethod http://127.0.0.1:48731/api/diagnostics
```

UI에서 확인할 것:

- 첫 화면에 agent profile이 보이는가
- Diagnostics 화면에 token 원문이 보이지 않는가
- readOnly run은 commit/push approval을 만들지 않는가
- gitOperation run은 diff와 approval을 앱에서 보여주는가
- conflict가 있는 repo에서는 commit approval 전에 blocked가 되는가
