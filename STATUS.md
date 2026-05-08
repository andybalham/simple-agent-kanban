# Project Status

This file tracks implementation phase completion for Local Agent Kanban. The detailed plan lives in `docs/implementation-plan.md`.

## Summary

Current phase: **Phase 3 complete; Phase 4 next**

Phase 3 is complete. The next implementation work is to expose the same durable workflows through the local HTTP API for the React UI.

## Phase Tracker

| Phase | Name | Status | Notes |
| --- | --- | --- | --- |
| 0 | Project Foundation | Complete | React/Vite shell, Node HTTP shell, MCP ping entrypoint, shared `src/core` and `src/db` boundaries, TypeScript, lint, format, test, and scaffold check are in place. |
| 1 | MCP Contract and Domain Model | Complete | Added domain types, MCP tool schemas, validation helpers, service interfaces, and an in-memory workflow service with tests for creation defaults, dependencies, claims, splitting, review, completion, and terminal archive behavior. |
| 2 | SQLite Persistence | Complete | Added Drizzle schema, SQLite migration SQL, durable service/repository implementation, seed data helper, and SQLite workflow tests with transaction rollback coverage. |
| 3 | MCP Server Implementation | Complete | MCP tools now call the SQLite-backed service and an end-to-end stdio smoke test covers the required agent workflow. |
| 4 | Local HTTP API | Pending | Add HTTP routes over the same domain services for projects, context, tasks, claims, events, artifacts, and verification. |
| 5 | React Board UI | Pending | Build the operational Kanban board, task detail surface, task create/edit flows, status updates, and claim release action. |
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

## Next Phase Exit Criteria

Phase 4 is complete when:

- Local HTTP routes expose projects, context, tasks, claims, events, artifacts, and verification through the same service layer.
- HTTP mutations reuse the domain service validation and event-writing behavior already exercised by MCP.
- Board state returned by HTTP matches state produced by MCP workflows.
