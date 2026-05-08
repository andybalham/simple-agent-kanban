# Project Database Architecture Refactor Plan

## Summary

This refactor brings the current implementation in line with the updated Phase 2 persistence architecture: a central metadata-only project registry database plus one repository-local SQLite database per project at `.local-agent-kanban/project.sqlite`.

Treat this as a correction to the original SQLite persistence phase, not as a new later feature. The MCP server, HTTP API, and React UI should continue to use the shared domain service boundary, but persistence must be split so project workflow data lives with the project repository and can be versioned with it.

The refactor must include an automated migration path from the current single `LOCAL_AGENT_KANBAN_DB` database into the new registry plus per-project database layout.

## Current State

- `SqliteKanbanService` owns all workflow persistence in one SQLite database.
- `src/db/schema.ts` and `src/db/migrations/0000_phase2_sqlite_persistence.sql` define one combined schema for projects, context, tasks, dependencies, claims, events, artifacts, and verification.
- `src/server/index.ts` and `src/mcp/index.ts` both construct the service from `LOCAL_AGENT_KANBAN_DB`.
- MCP and HTTP expose `list_projects` and `create_project`, but do not yet support registering or unregistering existing project repositories.
- Task and claim workflows often identify work by `taskId` or `claimId` only, so the current implementation does not need to resolve which project database owns those IDs.
- The React UI can create projects by name, but it does not collect a repository path.

## Target Architecture

- The central registry database stores only project registration metadata needed to list, open, and unregister active projects.
- Each project repository stores its canonical project data and workflow records in `.local-agent-kanban/project.sqlite`.
- Project IDs are stable canonical IDs stored inside the project database and reused across machines or clones.
- Removing a project from the app unregisters it from the central registry only. It must not delete or mutate the project repository database.
- HTTP and MCP processes use the same central registry database, then resolve each workflow operation to the correct project database.
- Business rules stay in shared domain services. HTTP and MCP adapters must remain thin validation and transport layers.

## Implementation Changes

### Domain and Service Contract

- Add project lifecycle status with `active` and `completed`.
- Extend project creation input to require `repoPath`.
- Add `registerProject` and `unregisterProject` service methods.
- Add MCP tools `register_project` and `unregister_project`.
- Add HTTP routes for project registration, unregistration, and lifecycle metadata updates.
- Keep existing task, claim, event, artifact, verification, and context methods on the shared service contract so callers do not bypass domain rules.

### Persistence Split

- Split the current schema into two Drizzle schema areas:
  - Central registry schema for `project_registry`.
  - Per-project schema for `projects`, `project_contexts`, `tasks`, `task_dependencies`, `task_claims`, `task_events`, `task_artifacts`, and `task_verifications`.
- Split migrations into separate registry and project migration sets.
- Add `project_registry` with `project_id`, display cache fields, `repo_path`, `project_db_path`, `lifecycle_status`, `registered_at`, `last_opened_at`, and `updated_at`.
- Keep workflow tables in the project database. The central registry must not store tasks, context, claims, dependencies, events, artifacts, or verification.
- Derive `project_db_path` from `repo_path` as `.local-agent-kanban/project.sqlite`.

### Project Database Resolver

- Add a shared resolver used by both HTTP and MCP service construction.
- The resolver reads the central registry, derives each project database path, opens and caches project database connections, and applies project migrations before use.
- Resolve project-scoped operations directly from `projectId`.
- For V1, resolve task-only and claim-only operations by scanning registered project databases for the matching `taskId` or `claimId`.
- Return friendly domain validation errors when a project, task, claim, or project database cannot be found.

### Creation, Registration, and Unregistration

- `create_project` creates or initializes `.local-agent-kanban/project.sqlite` in the provided repo path, writes the canonical project row there, then records registry metadata centrally.
- `register_project` reads an existing `.local-agent-kanban/project.sqlite`, verifies it contains exactly one canonical project row, and registers that project ID in the central registry.
- `unregister_project` removes the central registry row only. It must not delete the project database or edit project workflow data.
- `list_projects` reads from the central registry and returns stable canonical project IDs plus display metadata.

### Migration Script

- Add `tools/migrate-single-db-to-project-dbs.ts` and an npm script for running it.
- Inputs should include the legacy single database path and the target central registry database path.
- The script reads every project from the legacy database, determines each project repo path from project context, creates `.local-agent-kanban/project.sqlite`, applies project migrations, copies that project's project/context/tasks/dependencies/claims/events/artifacts/verification rows, and writes a registry row.
- Preserve canonical project IDs and all existing workflow row IDs.
- Fail before writing partial output if any project lacks a usable `repoPath`, if a target project database already contains conflicting data, or if two projects resolve to the same repository path.
- Print a clear summary of migrated projects and any skipped or blocking validation errors.

### Adapter and Runtime Updates

- Replace normal runtime use of `LOCAL_AGENT_KANBAN_DB` with `LOCAL_AGENT_KANBAN_REGISTRY_DB` in HTTP and MCP entrypoints.
- Keep `LOCAL_AGENT_KANBAN_DB` only for the migration script and compatibility documentation.
- Update README, `.env.example`, and MCP configuration examples after the implementation changes land.
- Ensure service shutdown closes all cached project database connections.

### UI Updates

- Update project creation to collect a repository path.
- Keep the project selector backed by `GET /api/projects`, which now lists registry projects.
- Add project unregister and lifecycle controls after the first persistence refactor slice if they are not required for initial parity.
- Keep board, task detail, claim release, and task mutation flows behaviorally unchanged from the user's perspective.

## Test Plan

- Creating a project in a temporary repository creates `.local-agent-kanban/project.sqlite`, inserts the canonical project row, and registers the project centrally.
- Unregistering a project removes only the registry row and leaves `.local-agent-kanban/project.sqlite` untouched.
- Registering an existing repository recovers the same canonical project ID from the project database.
- Multiple projects in separate temporary repositories keep tasks, dependencies, events, claims, artifacts, and verification isolated.
- Task-only and claim-only workflows resolve the owning project database correctly by scanning registered projects.
- Cross-project dependencies remain rejected.
- Migration tests copy legacy single-database data into registry plus project databases while preserving project IDs, task IDs, dependency edges, claims, events, artifacts, and verification rows.
- Migration tests fail clearly when a legacy project has no usable `repoPath`.
- MCP smoke tests cover project creation, registration or listing, task creation, claim, artifact, verification, and completion through the new resolver-backed service.
- HTTP route tests cover registry-backed project listing, project creation with repo path, unregister behavior, board state, claim release, and task detail.
- Run full verification before handoff:

```bash
npm run lint
npm run test
npm run build
npm run check:phase0
```

## Assumptions

- The refactor plan lives at `docs/refactor-plan.md`.
- Existing single-database data should be migrated with an automated local migration script.
- Scanning registered project databases to resolve `taskId` and `claimId` is acceptable for V1 because this is a local single-developer tool.
- The central registry may cache project display fields, but canonical project identity and workflow data live in the project database.
- The standard project database path is not configurable in V1.
