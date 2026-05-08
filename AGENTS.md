# AGENTS.md

Guidance for coding agents working in this repository.

## Project Brief

This project is **Local Agent Kanban**, a personal, local-first Kanban console for trusted coding agents. It is a single-developer local workspace tool, not a hosted team SaaS product.

Primary goals:

- Provide a React Kanban UI for viewing and editing agent work.
- Expose MCP tools so trusted agents can create, claim, split, update, and complete tasks.
- Keep task dependencies, claims, artifacts, verification, and activity history durable.
- Run locally with a browser UI, local HTTP API, and separate MCP stdio process.
- Use SQLite for V1 while keeping persistence ready for future Postgres support.

Source-of-truth docs:

- `README.md` for setup and current scaffold status.
- `docs/requirements.md` for product, domain, MCP, API, UI, and persistence requirements.
- `docs/implementation-plan.md` for phased build order and dependency constraints.

## Current Layout

The repository is currently in the Phase 0 scaffold:

- `src/web` contains the React/Vite UI shell.
- `src/server` contains the local Node HTTP API shell.
- `src/mcp` contains the separate MCP stdio entrypoint.
- `src/core` contains shared domain/service code.
- `src/db` is reserved for schema, migrations, and repository code.
- `tools` contains local project checks.
- `docs` contains the product requirements and implementation plan.

Keep these boundaries clear as features are added. The docs allow a future `apps/*` and `packages/*` layout, but the current `src/*` layout is acceptable while the project is early.

## Architecture Rules

- UI code calls the HTTP API.
- HTTP routes call shared domain services.
- MCP tools call the same shared domain services.
- Domain services call repository interfaces.
- Repositories own database access.
- Do not duplicate workflow rules between MCP, HTTP, and UI code.
- Do not put UI-oriented response shapes into MCP tool responses.
- Keep database-specific SQL isolated under `src/db` or repository modules.

Important product behavior to preserve:

- The MCP contract is a first-class product interface.
- Agents are trusted to create tasks.
- Agent-created tasks default to `needs_grooming = true` unless created through an accepted split or completion workflow.
- Human-created tasks default to `needs_grooming = false`.
- Claims are temporary leases and remain separate from task status.
- Only one active claim should exist for a task.
- Task dependencies are a same-project DAG and must be validated.
- A task is claimable only when it is `ready`, has no active unexpired claim, and all prerequisites are done.
- Splitting tasks keeps the board flat; the original task is archived or superseded, not used as a parent container.
- Completion requires a summary and verification evidence.
- Significant mutations must write immutable activity events.

## Implementation Order

Follow the dependency order in `docs/implementation-plan.md`:

1. Foundation.
2. Domain model and MCP contract.
3. SQLite persistence.
4. Durable MCP server implementation.
5. Local HTTP API over the same services.
6. React board UI.
7. Project context UI.
8. Activity, claims, and review visibility.
9. Hardening and local polish.

Do not let UI work define business rules that belong in domain services. UI shell work can happen early, but persisted workflow behavior should be driven by domain services and MCP/API contracts.

## Domain Model Notes

Task statuses:

- `backlog`
- `ready`
- `in_progress`
- `blocked`
- `review`
- `done`
- `archived`

Task priorities:

- `low`
- `medium`
- `high`
- `urgent`

Suggested free-form labels include `frontend`, `backend`, `db`, `mcp`, `docs`, `test`, `bug`, `feature`, and `refactor`, but V1 should not require a fixed taxonomy.

Required MCP tools for V1 are listed in `docs/requirements.md`. When implementing them, use structured, predictable results and friendly validation errors.

## Commands

Install dependencies:

```bash
npm install
```

Run the local web app and API:

```bash
npm run dev
```

Run the MCP server entrypoint:

```bash
npm run dev:mcp
```

Run checks before handing off meaningful code changes:

```bash
npm run lint
npm run test
npm run build
npm run check:phase0
```

Current local ports:

- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:4000`
- Health: `http://127.0.0.1:4000/health`

## Code Style

- TypeScript is used throughout.
- The project uses ESM (`"type": "module"`).
- Prefer explicit domain types and validation schemas for workflow boundaries.
- Treat this repository as a learning resource for TypeScript, React, SQLite/Drizzle, local HTTP APIs, and MCP server implementation.
- Keep implementation code self-documenting for learners. Add useful comments around domain rules, workflow invariants, validation decisions, transaction boundaries, persistence mapping, MCP tool contracts, and non-obvious control flow so new contributors can understand why the code behaves the way it does.
- Prefer comments that explain intent, technology choices, and cross-boundary behavior. Avoid comments that merely restate a line of code.
- When adding MCP, HTTP, or persistence code, make the adapter boundary clear in comments: MCP/HTTP should call shared services, services should enforce workflow rules, and repositories/database code should own storage details.
- Preserve existing formatting; use Prettier for broad formatting changes.
- Add focused tests for state transitions, validation failures, dependency handling, claim expiry/reclaiming, event writing, and completion requirements.

## Persistence Direction

V1 uses SQLite and should be implemented with Drizzle ORM. Keep schema and repository code Postgres-friendly:

- Use migrations from the beginning.
- Store task dependencies in a relational table.
- Treat JSON metadata fields as escape hatches, not primary model storage.
- Keep database access out of UI, MCP handlers, and HTTP route handlers.
- Ensure event writes are transactional with the state change they describe.

## UI Direction

The UI should prioritize operational clarity over decoration. Core views are:

- Project selector.
- Kanban board.
- Task detail drawer or panel.
- Project context editor.
- Activity feed.
- Active and stale claims panel.
- Review queue.

The Done column remains visible by default for V1. Completed tasks may be archived manually, but completion should not automatically remove them from the board.

## Handoff Expectations

When changing behavior:

- Check the requirements and implementation plan first.
- State which phase or workflow the change supports.
- Keep changes scoped to the relevant boundary.
- Update tests with the behavior.
- Run the smallest relevant verification command, and run the full check set for larger changes.
