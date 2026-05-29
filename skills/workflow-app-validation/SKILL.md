---
name: workflow-app-validation
description: Use when Codex changes or verifies the Codex Workflow App server, UI, plugin integration, Knowledge/RAG screen, Korean localization, action button state, browser behavior, or smoke test readiness.
---

# Workflow App Validation

Use this skill after Workflow App code, UI, API, provider recommendation, or Knowledge/RAG behavior changes.

## Validation Sequence

1. Build TypeScript with `npm run compile`.
2. Confirm the app is reachable through `/api/health`.
3. Exercise affected Knowledge/RAG APIs before browser checks when the UI depends on them.
4. Open or reload the running app in the Codex in-app browser.
5. Verify the visible UI path the user cares about, not just API output.
6. Check browser console errors after the page has loaded and after relevant button clicks.

## Knowledge/RAG UI Checks

- The `Knowledge/RAG` screen should show Korean copy in Korean mode except product names, model names, API key names, profile IDs, and enum-like technical handles.
- Recommendation cards should explain `추천도`, current PC fit, score reasons, blocking reasons, and next actions in readable Korean.
- Buttons must come from backend `nextActions`; the UI should not infer install/start/pull actions from text.
- Long-running local preparation buttons should become disabled while work is in progress.
- Buttons should remain disabled or become unnecessary when the current environment already satisfies the requested state.
- Raw JSON or technical dumps should stay hidden behind details by default.

## Smoke Run Checks

- A read-only smoke run must not mutate source docs.
- A code-changing smoke run may warn or block when required knowledge cache/index is missing.
- Latest run status should be interpreted from run details, traces, and cancellation intent, not from old failed runs alone.

## Verification

- Run `npm run compile`.
- Call `/api/health`.
- For Knowledge/RAG changes, call `/knowledge/integration/status`, `/rag/status`, and a small `/rag/search` query.
- In the browser, confirm there are no new console errors for `http://127.0.0.1:<port>/`.
