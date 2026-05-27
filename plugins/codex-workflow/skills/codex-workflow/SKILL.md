---
name: codex-workflow
description: Start and inspect local Codex Workflow App runs from Codex Desktop. Use when the user asks to run a task through the workflow app, watch workflow status, open the workflow app, cancel a workflow run, or list active/pending workflow runs.
---

# Codex Workflow

Use the `codex-workflow` MCP tools for workflow-app tasks. Do not infer workflow runs from normal chat; call `start_workflow` only when the user explicitly asks to use Codex Workflow, Workflow App, the multi-agent workflow, or the approval/monitoring app.

Default behavior:

- `start_workflow`: create a Workflow App run and return the run id plus monitoring URL.
- `list_workflows`: list known runs, optionally filtered by status.
- `get_workflow_status`: inspect one run.
- `open_workflow_app`: open the local Workflow App UI.
- `cancel_workflow`: cancel a run.

Runtime policy:

- Use `runtime: "auto"` unless the user explicitly asks for `sdk` or `app-server`.
- Use `runKind: "readOnly"` for analysis/explanation/summarization tasks with no file changes.
- Use `runKind: "automation"` for simple one-shot SDK-suitable tasks.
- Use `runKind: "multiAgent"` for the full docs/web-research/git/designer/frontend/backend/QA/doc-writer workflow.
- Use `runKind: "contextControl"` when the user asks for compact/resume/fork behavior.
- Use `runKind: "gitOperation"` when the user asks the Workflow App itself to inspect, commit, or push the current repository state.

Approval policy:

- Commit and push approvals are handled in the Workflow App UI.
- Do not approve push from chat text alone.
- Tell the user to use the app approval queue when a run is waiting on commit or push.
