# Project Status

This file tracks implementation phase completion for Local Agent Kanban. The detailed plan lives in `docs/implementation-plan.md`.

## Summary

Current phase: **Phase 8 complete**

Phase 8 is complete. The app now has the local polish needed for daily use: retryable UI errors, loading and empty states, registry backup/export, migration sanity checks, and recovery documentation for project registration and repository-local databases.

Architecture note: Phase 2 persistence now uses a central project registry database plus separate repository-local project databases at `.local-agent-kanban/project.sqlite`.

## Phase Tracker

| Phase | Name | Status | Notes |
| --- | --- | --- | --- |
| 0 | Project Foundation | Complete | React/Vite shell, Node HTTP shell, MCP ping entrypoint, shared `src/core` and `src/db` boundaries, TypeScript, lint, format, test, and scaffold check are in place. |
| 1 | MCP Contract and Domain Model | Complete | Added domain types, MCP tool schemas, validation helpers, service interfaces, and an in-memory workflow service with tests for creation defaults, dependencies, claims, splitting, review, completion, and terminal archive behavior. |
| 2 | SQLite Persistence | Complete | Added central registry and per-project Drizzle schemas/migrations, a resolver-backed SQLite service, register/unregister workflows, seed data helper, legacy migration tool, and SQLite workflow tests. |
| 3 | MCP Server Implementation | Complete | MCP tools now call the SQLite-backed service and an end-to-end stdio smoke test covers the required agent workflow. |
| 4 | Local HTTP API | Complete | Added HTTP routes over the same domain services for projects, context, tasks, claims, events, artifacts, and verification. |
| 5 | React Board UI | Complete | Built the operational Kanban board, project selector, task detail surface, task create/edit flows, status updates, claim release action, and stale claim indicators. |
| 6 | Project Context UI | Complete | Added context editing for overview, agent instructions, repo metadata, commands, coding conventions, agent preview, and context update activity. |
| 7 | Agent Activity and Review Visibility | Complete | Added activity feed, active and stale claims panels, review queue, task evidence detail, and grooming visibility. |
| 8 | Hardening and Local Polish | Complete | Added robust empty/loading/error states, keyboard-friendly board recovery actions, registry backup/export support, migration checks, recovery docs, and local workflow polish. |

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

- `src/db/schema.ts` defines Drizzle tables for the central `project_registry` plus repository-local workflow tables.
- `src/db/migrations/registry/0000_registry.sql` creates registry metadata only.
- `src/db/migrations/project/0000_project_workflow.sql` creates per-project workflow tables and indexes.
- `src/db/sqliteService.ts` implements the shared service contract over a central registry, project database resolver, and repository-local project stores.
- `tools/migrate-single-db-to-project-dbs.ts` migrates legacy single-database data into registry plus per-project databases.
- `src/db/sqliteService.test.ts` verifies durability across reopen, register/unregister behavior, dependency-cycle rollback, claimability, splitting, and completion evidence rules against SQLite.

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
- `src/mcp/index.ts` starts a separate stdio MCP process backed by SQLite, with `LOCAL_AGENT_KANBAN_REGISTRY_DB` registry configuration and optional seed configuration.
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
- `src/server/index.ts` starts the HTTP API with the same registry-backed SQLite service and seed configuration used by MCP.
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

## Phase 5 Evidence

Phase 5 deliverables present:

- `src/web/App.tsx` now loads projects, tasks, claims, task detail, artifacts, verification, and recent task events from the local HTTP API.
- The UI includes a project selector, project creation, visible Kanban columns including Done, task cards with priority, labels, active claim, stale claim, blocker, and needs-grooming indicators.
- The side panel includes task creation, task editing, dependency context, task completion with verification evidence, task detail evidence, and claim release controls.
- Board status moves call the shared HTTP status route, while task edits call a new shared `updateTask` service workflow through `PATCH /api/tasks/:taskId`.
- Task completion calls the shared `completeTask` workflow through `POST /api/tasks/:taskId/complete` so the UI follows the same summary and evidence rules as MCP.
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
- Selected the task and confirmed dependency context renders in the detail panel.
- Completed the task through the UI with verification evidence and confirmed it appears in the Done column.

Last verified: 2026-05-08.

## Phase 6 Evidence

Phase 6 deliverables present:

- `src/web/App.tsx` now loads and saves project context through `GET/PUT /api/projects/:projectId/context`.
- The project context panel supports Markdown fields for overview, agent instructions, and coding conventions.
- The context editor supports structured fields for repo path, default branch, package manager, install command, test command, build command, and lint command.
- The UI renders an agent preview of the exact context object returned by the HTTP endpoint and exposed through MCP `get_project_context`.
- Context saves refresh recent `project.context_updated` activity from `/api/projects/:projectId/events`, verifying that UI updates are backed by the shared event-writing workflow.

Phase 6 verification commands:

```bash
npm run lint
npm run test
npm run build
npm run check:phase0
```

Last verified: 2026-05-08.

## Phase 7 Evidence

Phase 7 deliverables present:

- `src/web/App.tsx` now includes an agent operations console above the board with review queue, active claims, stale claims, recent activity, and needs-grooming summary views.
- Operations panels select tasks into the existing detail surface so review, claim, and activity items connect back to task context without duplicating workflow rules in React.
- Stale claim rows keep the human release action visible from both the operations console and task detail.
- Task detail evidence now shows artifact metadata, verification summaries, verification evidence lines, actor identity, and timestamps.
- UI mutations that affect operations visibility refresh project activity after task create/edit/status/completion and claim release actions.
- `src/server/httpServer.test.ts` covers the Phase 7 query contract for review tasks, active claims, stale claims, task evidence, and activity events.

Phase 7 verification commands:

```bash
npm run lint
npm run test
npm run build
npm run check:phase0
```

Browser smoke test:

- Opened `http://127.0.0.1:5173`.
- Confirmed the running UI renders Review Queue, Stale Claims, Active Claims, Activity, Needs grooming, and the Local Agent Kanban shell.

Last verified: 2026-05-08.

## Phase 8 Evidence

Phase 8 deliverables present:

- `src/web/App.tsx` includes retryable error handling, no-project empty state, board loading state, defensive non-JSON API error reporting, and keyboard-friendly board refresh/task close behavior.
- `tools/backup-registry.ts` writes a central registry SQLite backup plus a JSON manifest of registered project database locations.
- `tools/check-phase8.ts` reapplies idempotent central/project migrations, runs SQLite `quick_check`, verifies expected tables, and checks registered project databases contain their canonical project row.
- `README.md` documents fresh local setup, project create/register/unregister/reopen behavior, registry backup/export, project database backup guidance, migration sanity checks, MCP configuration, and cleanup/recovery.
- `src/db/migrationScript.test.ts` covers the Phase 8 check and backup scripts against temporary SQLite registry/project databases.

Phase 8 verification commands:

```bash
npm run lint
npm run test
npm run build
npm run check:phase0
npm run check:phase8
```

Last verified: 2026-05-08.
