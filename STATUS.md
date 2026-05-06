# Project Status

This file tracks implementation phase completion for Local Agent Kanban. The detailed plan lives in `docs/implementation-plan.md`.

## Summary

Current phase: **Phase 2 next**

Phase 1 is complete. The next implementation work is to add SQLite persistence with Drizzle migrations and repository implementations over the Phase 1 domain/service contracts.

## Phase Tracker

| Phase | Name | Status | Notes |
| --- | --- | --- | --- |
| 0 | Project Foundation | Complete | React/Vite shell, Node HTTP shell, MCP ping entrypoint, shared `src/core` and `src/db` boundaries, TypeScript, lint, format, test, and scaffold check are in place. |
| 1 | MCP Contract and Domain Model | Complete | Added domain types, MCP tool schemas, validation helpers, service interfaces, and an in-memory workflow service with tests for creation defaults, dependencies, claims, splitting, review, completion, and terminal archive behavior. |
| 2 | SQLite Persistence | Pending | Add Drizzle ORM, migrations, repositories, and durable service wiring with SQLite tests. |
| 3 | MCP Server Implementation | Pending | Connect MCP tools to durable domain services and add end-to-end MCP workflow smoke tests. |
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

## Next Phase Exit Criteria

Phase 2 is complete when:

- Drizzle ORM is added for SQLite.
- Migrations exist for projects, project contexts, tasks, dependencies, claims, events, artifacts, and verification.
- Repository implementations satisfy the Phase 1 service contracts.
- Domain workflow tests pass against a temporary SQLite database.
- Event writes are transactional with the state change they describe.
- Database-specific code remains isolated under `src/db` or repository modules.
