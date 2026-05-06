# Project Status

This file tracks implementation phase completion for Local Agent Kanban. The detailed plan lives in `docs/implementation-plan.md`.

## Summary

Current phase: **Phase 1 next**

Phase 0 is complete. The next implementation work is to define the MCP contract, domain model, validation rules, and service interfaces.

## Phase Tracker

| Phase | Name | Status | Notes |
| --- | --- | --- | --- |
| 0 | Project Foundation | Complete | React/Vite shell, Node HTTP shell, MCP ping entrypoint, shared `src/core` and `src/db` boundaries, TypeScript, lint, format, test, and scaffold check are in place. |
| 1 | MCP Contract and Domain Model | Pending | Define project, task, dependency, claim, event, artifact, and verification types; add schemas, validation, service interfaces, and state-transition tests. |
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

## Next Phase Exit Criteria

Phase 1 is complete when:

- Domain types exist for projects, tasks, dependencies, claims, events, artifacts, and verification.
- MCP tool input/output schemas are documented in code.
- Validation covers task creation, dependency updates, splitting, claiming, claim heartbeat/release, status updates, review requests, verification, and completion.
- Service interfaces are defined for project, task, claim, event, artifact, and verification workflows.
- Tests cover allowed and rejected state transitions.
- MCP response shapes remain agent-oriented and free of UI-specific assumptions.
