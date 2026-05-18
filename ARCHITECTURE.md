# Haram AI Agent Architecture

## Product Shape

Haram AI Agent is a VS Code extension that runs a local software-company workflow.

The extension keeps a local brain at `~/.haram-ai-brain` and creates the default company workspace at:

```text
~/.haram-ai-brain/_company
```

## Core Source

- `src/extension.ts`: VS Code activation, webviews, command registration, orchestration, company workspace seeding
- `src/agents.ts`: canonical agent definitions and ordering
- `src/paths.ts`: brain and company directory resolution
- `assets/webview/`: dashboard/sidebar CSS and JS
- `assets/tool-seeds/frontend/`: reusable frontend project tools seeded into the Frontend agent as v0 implementation helpers

## Company Workspace

The default seeded structure is:

```text
_company/
  _shared/
    product_brief.md
    business_model.md
    roadmap.md
    specs/
    architecture/
    design/
    tasks/
    qa/
  _agents/
    ceo/
    business/
    planner/
    architect/
    designer/
    frontend/
    backend/
    dba/
    qa/
```

## Agent Flow

1. CEO clarifies the goal, expected outputs, priority, and execution order.
2. Business validates target customer, business model, pricing, KPI, and GTM assumptions.
3. Planner turns the idea into PRD, requirements, user stories, and acceptance criteria.
4. Architect defines stack, system boundaries, API contracts, DB draft, and ADR candidates.
5. Designer defines UX flows, screen structure, design system, and component direction.
6. Frontend, Backend, and DBA split implementation tasks by responsibility.
7. QA produces test scenarios, regression checks, and release gates.
8. CEO merges the work into a final action plan.

## Build

```bash
npm install
npm run compile
```
