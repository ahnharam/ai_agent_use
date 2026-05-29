---
name: workflow-agent-routing
description: Use when Codex Workflow must choose worker agents or capabilities for code changes, docs/wiki updates, RAG rebuilds, UI work, read-only analysis, git work, project absorption, or Knowledge Coordinator decisions.
---

# Workflow Agent Routing

Use this skill to choose the smallest useful set of Workflow agents and knowledge capabilities for a request.

## Routing Rules

- General code modification: run `knowledge-source-agent` first when project rules are needed, then use the implementation agent for the touched area, then verify with the relevant test path.
- Documentation or wiki update: route through `knowledge-source-agent`, `wiki-export-agent`, and `knowledge-auditor-agent`.
- RAG rebuild or provider setup: route through `knowledge-source-agent`, `knowledge-index-agent`, `rag-retriever-agent`, and `knowledge-auditor-agent`.
- Knowledge/RAG answer or context injection: route through `knowledge-source-agent`, `rag-retriever-agent`, then `docs-agent` as coordinator.
- UI behavior change: include frontend/UI validation, browser verification, and Korean localization checks when Korean mode is relevant.
- Read-only analysis: prefer source detection, retrieval, and auditor checks without mutating source docs.
- Git work: inspect current status first, avoid reverting unrelated user changes, and commit only the requested scope.

## Coordinator Behavior

- `docs-agent` should coordinate knowledge work instead of performing every worker task itself.
- Do not run every knowledge worker on every request.
- Select workers by intent, affected surface, and risk.
- Prefer existing project RAG as bridge/baseline when healthy; use Workflow-owned index for capability routing and project policy.
- When evidence is weak, report the gap instead of inventing project rules.

## Verification

- Check that selected workers match the run type.
- Confirm retrieved context includes citations, provenance, and warnings when conflicts or stale sources are found.
- For `D:\Github\ai_agent\haram_project`, capability routing should see at least four repo-local Workflow skills.
