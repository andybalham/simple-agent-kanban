# Local Agent Kanban

A personal, local-first Kanban console for trusted coding agents.

Local Agent Kanban is an agent work console for a single developer working across local project repositories. It is designed to give coding agents a first-class MCP workflow while giving the human developer a clear browser UI for visibility, review, and control.

## Goals

- Provide a React Kanban UI for viewing and editing project work.
- Support multiple active projects through a local registry.
- Let trusted coding agents create, claim, split, update, and complete tasks through MCP tools.
- Store durable project context, tasks, dependencies, claims, artifacts, verification, and activity history in each project repository.
- Run as a plain local server opened in the browser.
- Use SQLite for V1 with a central project registry database and separate repository-local project databases, while keeping the persistence boundary ready for future Postgres support.
- Keep the MCP contract as a first-class product interface.

## Current Status

The repository is currently at **Phase 8 complete**.

Implemented foundation, domain contract, SQLite persistence, durable MCP workflows, the local HTTP API, the React board UI, project context UI, operations visibility, and local hardening:

- React and Vite web app shell.
- Node HTTP API with `/health`, `/api/health`, and Phase 4 workflow routes for projects, context, tasks, claims, events, artifacts, and verification.
- MCP stdio entrypoint with `ping` plus the V1 project, context, task, claim, artifact, verification, review, and completion workflow tools.
- Shared `src/core` and `src/db` boundaries.
- TypeScript, ESLint, Prettier, and Vitest configuration.
- Local environment example in `.env.example`.
- Dependency-free Phase 0 scaffold check.
- Domain types, MCP tool schemas, validation helpers, service interfaces, and in-memory workflow tests for Phase 1.
- Drizzle SQLite schema and migration SQL split between the central project registry and repository-local workflow databases.
- SQLite-backed registry/resolver service under `src/db` with seed data support and temporary database workflow tests.
- MCP tool registration over the SQLite-backed service with structured results and domain validation errors.
- MCP stdio smoke test covering project creation, context update, task creation, claim, artifact, verification, and completion.
- HTTP route tests covering project/context/task creation, board state, claims, artifacts, verification, completion, claim release events, and completion validation parity.
- Operational React board UI with project selector, task detail surface, task create/edit flows, status moves, claim release, and stale claim indicators.
- Project context editor with Markdown fields, repo metadata, workflow commands, an agent-facing preview, and context update activity visibility.
- Agent operations console with review queue, active and stale claims, activity feed, grooming visibility, artifacts, and verification evidence.
- Phase 8 local polish with loading, empty, retryable error states, keyboard-friendly board refresh/task close behavior, registry backup/export, and database migration sanity checks.

See `STATUS.md` for the phase tracker and `docs/implementation-plan.md` for the full build order.

## Project Layout

```text
src/web       React/Vite UI shell
src/server    Local Node HTTP API
src/mcp       Separate MCP stdio entrypoint
src/core      Shared domain and service code
src/db        Persistence boundary for schema, migrations, repositories
tools         Local checks and project scripts
docs          Requirements and implementation plan
```

The current `src/*` layout is intentionally simple. The requirements allow moving toward an `apps/*` and `packages/*` structure later, but the important rule is to preserve the boundaries between UI, HTTP, MCP, domain services, and database access.

## Architecture

The intended dependency flow is:

```text
React UI -> HTTP API -> Domain services -> Registry/project repositories -> SQLite
MCP tools -> Domain services -> Registry/project repositories -> SQLite
```

Core rules:

- UI calls the HTTP API.
- HTTP routes and MCP tools share the same domain services.
- Domain services own workflow rules and validation.
- Registry repositories own central project registration data.
- Project repositories own repository-local workflow data.
- Each project repository stores its project database at `.local-agent-kanban/project.sqlite`.
- Projects can be created, registered from an existing repository database, and unregistered from the app.
- Removing a project from the app unregisters it from the central registry and leaves the project database untouched.
- Project IDs are canonical, stable IDs stored inside each project database.
- MCP responses should be structured for agents, not shaped for the UI.
- Significant mutations should write immutable activity events.

## Local Setup

Install dependencies:

```bash
npm install
```

Run the local web app and API:

```bash
npm run dev
```

Clean up the local dev server and generated default registry database:

```bash
npm run cleanup:dev
```

This stops the recorded dev process tree and any listeners on the default local ports before removing `local-agent-kanban-registry.sqlite` and dev-server logs. That order matters on Windows because SQLite files stay locked while the API process has an open database connection.

Run the MCP server entrypoint:

```bash
npm run dev:mcp
```

Runtime persistence uses a central registry database for active project metadata and project databases at `.local-agent-kanban/project.sqlite` inside registered repositories. Override the registry path for local agent configuration or tests with:

```powershell
$env:LOCAL_AGENT_KANBAN_REGISTRY_DB = 'C:\path\to\local-agent-kanban-registry.sqlite'
npm run dev:mcp
```

Set `LOCAL_AGENT_KANBAN_SEED=true` when starting the MCP process to create the local seed project if it does not already exist.

## Project Registration And Recovery

Create a new project from the UI or MCP `create_project` tool by providing a local repository path. The app creates `.local-agent-kanban/project.sqlite` inside that repository, stores the canonical project ID there, and registers the project in the central registry database.

Register an existing project repository when its `.local-agent-kanban/project.sqlite` already exists:

```powershell
curl -X POST http://127.0.0.1:4000/api/projects/register ^
  -H "content-type: application/json" ^
  -d "{\"actor\":{\"type\":\"human\",\"id\":\"local-cli\"},\"repoPath\":\"C:\\path\\to\\repo\"}"
```

Unregistering removes only the central registry entry. It does not delete or mutate `.local-agent-kanban/project.sqlite`, so the repository can be reopened later through the same register route or MCP `register_project`.

Back up the central registry and export a JSON manifest of registered project database locations:

```bash
npm run backup:registry -- ./local-agent-kanban-registry.sqlite ./backups
```

Project databases live with their repositories. Back them up with the repository, or copy `.local-agent-kanban/project.sqlite` while the local API and MCP server are stopped. Run cleanup first if a dev server may still have SQLite files open:

```bash
npm run cleanup:dev
```

Check that the central registry and all registered project databases can accept the current migrations and pass SQLite sanity checks:

```bash
npm run check:phase8 -- ./local-agent-kanban-registry.sqlite
```

To migrate data from the earlier single-database layout, pass the legacy database and the target registry database:

```bash
npm run migrate:single-db -- ./local-agent-kanban.sqlite ./local-agent-kanban-registry.sqlite
```

Example MCP server configuration:

```json
{
  "mcpServers": {
    "local-agent-kanban": {
      "command": "npm",
      "args": ["run", "dev:mcp"],
      "cwd": "C:\\Users\\MONTEITH\\Documents\\New project",
      "env": {
        "LOCAL_AGENT_KANBAN_REGISTRY_DB": "C:\\Users\\MONTEITH\\Documents\\New project\\local-agent-kanban-registry.sqlite"
      }
    }
  }
}
```

## Ports

- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:4000`
- Health: `http://127.0.0.1:4000/health`
- API health: `http://127.0.0.1:4000/api/health`

## HTTP API

The React UI should call the local API under `/api`. HTTP routes are adapter code over the same shared service used by MCP, so validation, events, dependency rules, claims, and completion requirements stay consistent.

Implemented Phase 4 routes:

- `GET /api/projects`
- `POST /api/projects`
- `POST /api/projects/register`
- `DELETE /api/projects/:projectId`
- `PATCH /api/projects/:projectId/lifecycle`
- `GET /api/projects/:projectId/context`
- `PUT /api/projects/:projectId/context`
- `GET /api/projects/:projectId/tasks`
- `POST /api/projects/:projectId/tasks`
- `GET /api/projects/:projectId/events`
- `GET /api/projects/:projectId/claims?state=active|stale|released|all`
- `GET /api/tasks?projectId=...&status=...&claimableOnly=true`
- `GET /api/tasks/:taskId`
- `PATCH /api/tasks/:taskId/dependencies`
- `POST /api/tasks/:taskId/split`
- `PATCH /api/tasks/:taskId/status`
- `POST /api/tasks/:taskId/notes`
- `GET /api/tasks/:taskId/claims`
- `POST /api/tasks/:taskId/claims`
- `GET /api/tasks/:taskId/artifacts`
- `POST /api/tasks/:taskId/artifacts`
- `GET /api/tasks/:taskId/verifications`
- `POST /api/tasks/:taskId/verifications`
- `POST /api/tasks/:taskId/review`
- `POST /api/tasks/:taskId/complete`
- `GET /api/events?projectId=...`
- `POST /api/claims/:claimId/heartbeat`
- `POST /api/claims/:claimId/release`

## Checks

Run the test suite manually:

```bash
npm run test
```

This runs Vitest once through the `test` npm script.

Run the normal project checks before handing off meaningful code changes:

```bash
npm run lint
npm run test
npm run build
```

Script reference:

- `npm run lint` runs ESLint across the repository.
- `npm run test` runs the Vitest test suite once.
- `npm run build` runs TypeScript checking and the Vite production build.
- `npm run check:phase0` verifies that the foundation scaffold files and scripts still exist.
- `npm run cleanup:dev` stops local dev processes on the default ports and removes generated default dev database/log artifacts.
- `npm run backup:registry` writes a SQLite registry backup plus a JSON manifest under `./backups` by default.
- `npm run check:phase8` reapplies idempotent migrations and runs SQLite sanity checks for the central registry and registered project databases.

Run the Phase 0 scaffold check:

```bash
npm run check:phase0
```

Format the repository:

```bash
npm run format
```

## Documentation

- `docs/requirements.md` describes product, domain, MCP, HTTP API, UI, persistence, and runtime requirements.
- `docs/implementation-plan.md` describes the phased implementation plan and dependency map.
- `AGENTS.md` gives coding-agent guidance for working in this repository.
- `STATUS.md` tracks phase completion.

## Implementation Plan Summary

1. Project foundation.
2. MCP contract and domain model.
3. SQLite persistence with central registry and per-project databases.
4. Durable MCP server implementation. **Complete.**
5. Local HTTP API. **Complete.**
6. React board UI. **Complete.**
7. Project context UI. **Complete.**
8. Agent activity and review visibility. **Complete.**
9. Hardening and local polish. **Complete.**

Build the MCP contract and domain services before durable persistence, HTTP workflows, or UI behavior. The app should be useful to agents before it is visually complete.
