---
name: workflow-rag-provider-ops
description: Use when Codex recommends, prepares, validates, troubleshoots, or applies local RAG providers such as Qdrant, Chroma, Ollama, Ollama-compatible endpoints, OpenAI-compatible embeddings, Voyage, Docker, ports, API keys, or embedding model pulls.
---

# Workflow RAG Provider Ops

Use this skill for provider recommendation and local setup operations. Separate recommendation quality from current execution readiness.

## Provider Readiness Model

- Classify embedding endpoints as `native-ollama`, `ollama-compatible`, `openai-compatible`, or `none`.
- Record capabilities such as `canEmbed`, `canPullModels`, `canListModels`, `supportsBatch`, and `supportsDimensions`.
- Record runtime state separately: installed, running, reachable, validated, port conflict, and blocked reason.
- Map actionability to `ready`, `needs-start`, `needs-install`, `needs-model`, `needs-key`, or `blocked`.

## Local Setup Rules

- Do not treat `/api/tags` alone as native Ollama.
- Show `Pull Model` only when native Ollama can pull models.
- For Ollama-compatible servers, ask the user or endpoint owner to expose an embedding model; do not run `ollama pull`.
- Validate embeddings with a fixed safe sample string, not project documents.
- Split Docker CLI installed, Docker Engine running, container existing, service reachable, and API validated.
- Validate Qdrant through `/readyz`.
- Validate Chroma through `/api/v2/heartbeat`.
- If a default port is occupied by another service, do not stop it automatically. Pick an alternate port for local preparation when the selected provider supports it.
- Keep API-key providers advisory until the user manually registers the key; never store secret values.

## Recommendation Scoring

- Rank primarily by post-setup usefulness for the project, not by whether it is already installed.
- Apply penalties for paid external services, external data transfer, missing API keys, Docker not running, missing model, and port conflicts.
- Keep local/free/private candidates ahead of paid API candidates unless quality or operational constraints clearly justify the paid option.
- Show both current readiness and expected score after setup.

## Verification

- Run provider health checks after any start/install/pull action.
- Re-detect the environment after each action and return the updated environment.
- Ensure `local-hybrid` remains a ready fallback when no semantic provider is available.
- Confirm `/rag/status` and `/rag/search` after applying a provider profile.
