# Codex Workflow Agent Notes

## Encoding-Safe Workflow Requests

Use UTF-8 end-to-end for every Workflow App request, run artifact, event log, and
agent-facing prompt. This repo includes Korean text in prompts, summaries, and UI
labels, so mojibake or `?` replacement should be treated as a bug in the request
path.

When creating Workflow App runs from Windows, do not inline Korean JSON directly
inside a PowerShell command string. Prefer one of these formats:

1. Use the Workflow App UI text box directly.
2. Use a UTF-8 JSON file and send it with an explicit charset.
3. Use Node or another UTF-8-safe HTTP client that serializes JSON directly.

PowerShell file-based format:

```powershell
$body = @{
  cwd = "D:\Github\ai_agent\haram_project"
  runKind = "readOnly"
  runtime = "auto"
  source = "codex-desktop"
  contextMode = "fresh"
  prompt = "한글 인코딩 검증 요청입니다. 물음표로 깨지면 실패입니다."
} | ConvertTo-Json -Depth 6

$bodyPath = Join-Path $env:TEMP "codex-workflow-run.json"
[System.IO.File]::WriteAllText($bodyPath, $body, [System.Text.UTF8Encoding]::new($false))

$tokenPath = Join-Path $env:USERPROFILE ".codex-workflow\token"
$token = if (Test-Path $tokenPath) { [System.IO.File]::ReadAllText($tokenPath).Trim() } else { "" }
$headers = @{}
if ($token) { $headers["Authorization"] = "Bearer $token" }

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:48731/api/runs" `
  -Headers $headers `
  -ContentType "application/json; charset=utf-8" `
  -InFile $bodyPath
```

Node format:

```js
const body = {
  cwd: "D:\\Github\\ai_agent\\haram_project",
  runKind: "readOnly",
  runtime: "auto",
  source: "codex-desktop",
  contextMode: "fresh",
  prompt: "한글 인코딩 검증 요청입니다. 물음표로 깨지면 실패입니다."
};

const response = await fetch("http://127.0.0.1:48731/api/runs", {
  method: "POST",
  headers: {
    "content-type": "application/json; charset=utf-8",
    "authorization": `Bearer ${token}`
  },
  body: JSON.stringify(body)
});
```

Verification checklist:

- The saved `.ai-agent/runs/<runId>.json` must contain the original Korean text.
- The Workflow App UI must show Korean text without `?` replacement.
- If `?` appears in `prompt`, `userPrompt`, stage summaries, or event messages,
  first suspect the client request path before changing UI rendering.
- Shell display mojibake can be a console rendering issue, but persisted JSON
  mojibake or `?` replacement is a data corruption issue.

For commit and push operations, keep the existing Workflow App approval policy:
commit, push, and merge-back actions require explicit approval in the Workflow
App UI when the operation is initiated as a Workflow App `gitOperation`.
