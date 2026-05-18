# Haram AI Agent

**Haram AI Agent — AI Software Company** is a local VS Code extension that turns a PC into a small AI software team.

The v0 team is fixed:

- CEO: goals, priority, delegation, final decisions
- Business: customers, market, revenue model, pricing, KPI, GTM
- Planner: PRD, requirements, user stories, acceptance criteria, schedule
- Architect: tech stack, system structure, API contracts, module boundaries, ADR
- Designer: UX flows, screen structure, design system, component direction
- Frontend: UI implementation, state, routing, responsive behavior, browser checks
- Backend: API, auth, business logic, integrations, server tests
- DBA: schema, migrations, indexes, queries, data integrity
- QA: test plan, regression checks, release checklist, quality gates

## Defaults

- Extension id: `haram-ai-agent`
- Settings prefix: `haramAi.*`
- Default brain path: `~/.haram-ai-brain`
- Default company folder: `~/.haram-ai-brain/_company`

The company workspace seeds product documents under `_company/_shared/` and role workspaces under `_company/_agents/<role>/`.

## Commands

- `Haram AI Agent: New Chat`
- `Haram AI Agent: Open Settings`
- `Haram AI Agent: Open Company Dashboard`
- `Haram AI Agent: Create Product Brief`
- `Haram AI Agent: Create PRD`
- `Haram AI Agent: Create Architecture Plan`
- `Haram AI Agent: Create Implementation Tasks`
- `Haram AI Agent: Run QA Review`
- `Haram AI Agent: Scaffold Project`

## Development

```bash
npm install
npm run compile
```

The extension uses local LLM engines such as Ollama or LM Studio through the `haramAi.*` settings.
