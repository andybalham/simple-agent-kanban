# Project Status

This file tracks implementation phase completion for Local Agent Kanban. The detailed plan lives in `docs/implementation-plan.md`.

## Summary

Current phase: **Phase 5 complete; Phase 6 next**

Phase 5 is complete. The next implementation work is to add the project context UI on top of the existing context endpoints.

## Phase Tracker

| Phase | Name | Status | Notes |
| --- | --- | --- | --- |
| 0 | Project Foundation | Complete | React/Vite shell, Node HTTP shell, MCP ping entrypoint, shared `src/core` and `src/db` boundaries, TypeScript, lint, format, test, and scaffold check are in place. |
| 1 | MCP Contract and Domain Model | Complete | Added domain types, MCP tool schemas, validation helpers, service interfaces, and an in-memory workflow service with tests for creation defaults, dependencies, claims, splitting, review, completion, and terminal archive behavior. |
| 2 | SQLite Persistence | Complete | Added Drizzle schema, SQLite migration SQL, durable service/repository implementation, seed data helper, and SQLite workflow tests with transaction rollback coverage. |
| 3 | MCP Server Implementation | Complete | MCP tools now call the SQLite-backed service and an end-to-end stdio smoke test covers the required agent workflow. |
| 4 | Local HTTP API | Complete | Added HTTP routes over the same domain services for projects, context, tasks, claims, events, artifacts, and verification. |
| 5 | React Board UI | Complete | Built the operational Kanban board, project selector, task detail surface, task create/edit flows, status updates, claim release action, and stale claim indicators. |
| 6 | Project Context UI | Pending | Add context editing for overview, agent instructions, repo metadata, commands, and coding conventions. |
| 7 | Agent Activity and Review Visibility | Pending | Add activity feed, active/stale claims panels, review queue, artifacts, verification evidence, and grooming indicators. |
| 8 | Hardening and Local Polish | Pending | Add robust empty/loading/error states, backup/export support, migration checks, recovery docs, and local workflow polish. |

## Phase 0 Evidence

Phase 0 deliverables present:

- `src/web/App.tsx` provides the React app shell.
- `src/server/httpServer.ts` serves `/health` and `/api/health`.
- `src/mcp/index.ts` exposes the MCP `ping` tool.
- `src/core/index.ts` contains shared product and ping response logic.
- `src/db/index.ts` reserves the persistence boundary.
- `tools/check-phase0.mjs` validates required scaffold files and scripts.

Phase 0 verification commands:

```bash
npm run lint
npm run test
npm run build
npm run check:phase0
```

## Phase 1 Evidence

Phase 1 deliverables present:

- `src/core/domain.ts` defines project, context, task, dependency, claim, event, artifact, and verification domain types.
- `src/core/mcpSchemas.ts` documents the V1 MCP tool input/output contracts with agent-oriented schemas.
- `src/core/validation.ts` provides shared validation schemas and friendly domain validation errors.
- `src/core/services.ts` defines service interfaces for project, task, claim, event, artifact, and verification workflows.
- `src/core/memoryService.ts` implements an in-memory domain service for exercising Phase 1 workflow rules before SQLite persistence.
- `src/core/memoryService.test.ts` covers grooming defaults, dependency validation and cycles, claimability and stale claims, claim heartbeat/release, splitting, review/completion evidence, event writing, and archived task terminal behavior.

Phase 1 verification commands:

```bash
npm run lint
npm run test
npm run build
npm run check:phase0
```

Last verified: 2026-05-06.

## Phase 2 Evidence

Phase 2 deliverables present:

- `src/db/schema.ts` defines Drizzle tables for projects, project contexts, tasks, dependencies, claims, events, artifacts, and verification.
- `src/db/migrations/0000_phase2_sqlite_persistence.sql` creates the V1 SQLite schema and indexes.
- `src/db/sqliteService.ts` implements the Phase 1 service contract over SQLite/Drizzle, including transaction-scoped event writes.
- `src/db/sqliteService.test.ts` verifies durability across reopen, dependency-cycle rollback, claimability, splitting, and completion evidence rules against SQLite.

Phase 2 verification commands:

```bash
npm run lint
npm run test
npm run build
npm run check:phase0
```

Last verified: 2026-05-08.

## Phase 3 Evidence

Phase 3 deliverables present:

- `src/mcp/tools.ts` registers `ping` plus the V1 MCP workflow tools over the shared `LocalAgentKanbanService`.
- `src/mcp/index.ts` starts a separate stdio MCP process backed by SQLite, with `LOCAL_AGENT_KANBAN_DB` and optional seed configuration.
- `src/core/mcpSchemas.ts` defines structured output schemas for richer task, claim, project, and context results.
- `src/mcp/mcpServer.test.ts` runs a stdio MCP-only workflow: create project, update context, create task, claim task, record artifact, record verification, and complete task.
- `README.md` documents local MCP server configuration.

Phase 3 verification commands:

```bash
npm run lint
npm run test
npm run build
npm run check:phase0
```

Last verified: 2026-05-08.

## Phase 4 Evidence

Phase 4 deliverables present:

- `src/server/httpServer.ts` exposes local API routes for projects, project context, tasks, task dependencies, claims, events, artifacts, verification, review, and completion.
- `src/server/index.ts` starts the HTTP API with the same SQLite-backed service and seed configuration used by MCP.
- `src/core/services.ts` now includes read methods for claims, artifacts, and verification so HTTP adapters do not reach into persistence directly.
- `src/core/memoryService.ts` and `src/db/sqliteService.ts` implement those read methods while preserving the shared service boundary.
- `src/server/httpServer.test.ts` covers a Phase 4 route workflow and verifies completion and claim-release event parity with the shared service rules.
- `README.md` documents the implemented local HTTP API routes.

Phase 4 verification commands:

```bash
npm run lint
npm run test
npm run build
npm run check:phase0
```

Last verified: 2026-05-08.

## Next Phase Exit Criteria

Phase 6 is complete when:

- Context updates through UI are immediately visible through MCP.
- Context updates write activity events.

## Phase 5 Evidence

Phase 5 deliverables present:

- `src/web/App.tsx` now loads projects, tasks, claims, task detail, artifacts, verification, and recent task events from the local HTTP API.
- The UI includes a project selector, project creation, visible Kanban columns including Done, task cards with priority, labels, active claim, stale claim, blocker, and needs-grooming indicators.
- The side panel includes task creation, task editing, task detail evidence, and claim release controls.
- Board status moves call the shared HTTP status route, while task edits call a new shared `updateTask` service workflow through `PATCH /api/tasks/:taskId`.
- `src/core/services.ts`, `src/core/memoryService.ts`, `src/db/sqliteService.ts`, and `src/server/httpServer.ts` include the narrow task edit workflow used by the UI.
- `src/server/httpServer.test.ts` covers the task edit route and verifies that it updates the shared service read model and writes `task.updated`.

Phase 5 verification commands:

```bash
npm run lint
npm run test
npm run build
npm run check:phase0
```

Browser smoke test:

- Created a project through the UI.
- Created a task through the UI.
- Moved the task from Backlog to Ready through the board move control.

Last verified: 2026-05-08.
