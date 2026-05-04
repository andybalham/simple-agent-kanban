# Local Agent Kanban Requirements

## Purpose

Build a personal, local-first Kanban web application that helps coding agents self-organize while giving the human developer clear visibility and control.

The system is not a team SaaS board. It is an agent work console for a single developer working in one local workspace.

## Goals

- Provide a React Kanban UI for viewing and editing project work.
- Support multiple projects.
- Let trusted coding agents create, claim, split, update, and complete tasks through MCP tools.
- Store durable project, task, context, claim, artifact, and activity history.
- Run as a plain local server opened in the browser.
- Use SQLite initially while keeping the persistence layer ready for future Postgres support.
- Treat the MCP contract as a first-class product interface, not an implementation detail.

## Non-Goals for V1

- Multi-user team collaboration.
- External hosted deployment.
- Heavy authentication or role-based permissions.
- Multiple workspaces per project.
- Parent or nested task hierarchies after splitting.
- Complex reporting or analytics.

## Users

### Human Developer

- Creates and edits projects, project context, and tasks.
- Reviews agent activity.
- Overrides task status and stale claims.
- Uses the UI to understand what agents are doing and where human input is needed.

### Trusted Coding Agent

- Reads project context.
- Lists available work.
- Creates new tasks when needed.
- Splits oversized tasks into smaller flat tasks.
- Claims tasks with a lease.
- Sends heartbeats while working.
- Records notes, file paths, branches, commits, test results, and completion summaries.
- Requests human review or marks work complete with evidence.

## Product Model

### Project

A project represents one body of work in the local workspace.

Required fields:

- `id`
- `name`
- `description`
- `created_at`
- `updated_at`

Recommended context fields:

- `overview_markdown`
- `agent_instructions_markdown`
- `repo_path`
- `default_branch`
- `package_manager`
- `install_command`
- `test_command`
- `build_command`
- `lint_command`
- `coding_conventions_markdown`

Project context is global per project. Task-specific context documents are out of scope for V1.

### Task

A task is a flat unit of work on a project board.

Required fields:

- `id`
- `project_id`
- `title`
- `description`
- `status`
- `priority`
- `created_by`
- `created_at`
- `updated_at`

Recommended fields:

- `acceptance_criteria`
- `labels`
- `needs_grooming`
- `source_task_id`
- `split_reason`
- `completed_at`
- `archived_at`

Task statuses:

- `backlog`
- `ready`
- `in_progress`
- `blocked`
- `review`
- `done`
- `archived`

Task splitting must keep the board flat. When an agent splits a task, the original task should be replaced by the new tasks rather than becoming a parent container.

Recommended split behavior:

- New replacement tasks are created as normal flat tasks.
- Each new task records `source_task_id` and `split_reason` for traceability.
- The original task is archived or marked as superseded and removed from active board columns.
- The UI may show a historical event that the original task was split, but must not display the original as an active parent task.

### Claim

A claim represents a temporary lease by an agent on a task.

Required fields:

- `id`
- `task_id`
- `agent_id`
- `claimed_at`
- `expires_at`
- `last_heartbeat_at`
- `released_at`

Claim state must be separate from task status. A task can be `in_progress` while its claim is stale or expired.

Claim rules:

- Only one active claim should exist for a task.
- Agents must refresh claims with heartbeats.
- Expired claims may be reclaimed.
- Human users may release stale claims through the UI.

### Event

Every meaningful action should create an immutable activity event.

Recommended event types:

- `project.created`
- `project.context_updated`
- `task.created`
- `task.split`
- `task.claimed`
- `task.heartbeat`
- `task.claim_released`
- `task.status_changed`
- `task.note_added`
- `task.blocked`
- `task.review_requested`
- `task.completed`
- `task.archived`
- `artifact.recorded`
- `verification.recorded`

Events should capture:

- `id`
- `project_id`
- `task_id`
- `actor_type`
- `actor_id`
- `event_type`
- `message`
- `metadata_json`
- `created_at`

### Artifact

Artifacts capture useful work evidence without overloading the task row.

Artifact kinds:

- `file`
- `branch`
- `commit`
- `test`
- `build`
- `lint`
- `link`
- `note`

Recommended fields:

- `id`
- `task_id`
- `kind`
- `value`
- `metadata_json`
- `created_by`
- `created_at`

## MCP Requirements

The MCP server must expose intentional workflow tools rather than raw database operations.

V1 tools:

- `list_projects`
- `create_project`
- `get_project_context`
- `update_project_context`
- `list_tasks`
- `create_task`
- `split_task`
- `claim_task`
- `heartbeat_claim`
- `release_claim`
- `update_task_status`
- `add_task_note`
- `record_artifact`
- `record_verification`
- `request_review`
- `complete_task`

MCP tool responses should be structured, predictable, and useful to agents. Avoid returning UI-oriented or presentation-specific shapes.

Important MCP behavior:

- Agent-created tasks are allowed.
- Agent-created tasks should be marked with the creating agent identity.
- Agent-created tasks should default to `needs_grooming = true` unless explicitly created as part of an accepted split or completion workflow.
- `split_task` must require a reason and at least two replacement tasks.
- `complete_task` must require a summary and verification evidence.
- Task status changes, notes, artifacts, verification, claim changes, and splits must write events.

## HTTP API Requirements

The React UI should use a local HTTP API over the same domain service layer as the MCP server.

The HTTP API should support:

- Project CRUD.
- Project context editing.
- Task CRUD.
- Drag/drop task status changes.
- Claim visibility and release.
- Event/activity feed queries.
- Artifact and verification display.

The HTTP API and MCP server must not duplicate business logic. Shared services should enforce validation, state transitions, claims, and event creation.

## UI Requirements

The initial UI should prioritize operational clarity over decorative design.

Core views:

- Project selector.
- Kanban board.
- Task detail drawer or panel.
- Project context editor.
- Activity feed.
- Active/stale claims panel.
- Review queue.

Board columns:

- Backlog
- Ready
- In Progress
- Blocked
- Review
- Done

Task cards should show:

- Title.
- Priority.
- Labels.
- Claim/agent indicator.
- Stale claim warning.
- Needs grooming flag.
- Review/completion state.

Task detail should show:

- Description.
- Acceptance criteria.
- Status.
- Claim state.
- Notes.
- Artifacts.
- Verification.
- Activity timeline.

## Persistence Requirements

Use SQLite for V1.

Persistence must be structured so Postgres can be introduced later:

- Use migrations from the beginning.
- Avoid scattering database-specific SQL across feature code.
- Keep schema and repository/data-access code isolated.
- Prefer data types and query patterns that can map cleanly to Postgres.
- Treat JSON fields as metadata escape hatches, not as the primary model.

Recommended implementation options:

- Drizzle ORM for typed SQL and migrations.
- Kysely for SQL-shaped query building.
- Prisma if faster schema iteration is preferred over lower-level SQL control.

## Architecture Requirements

Recommended structure:

```text
apps/web        React UI
apps/server     Local Node HTTP API
apps/mcp        MCP server entrypoint
packages/core   Domain services and validation
packages/db     Schema, migrations, repositories
```

The simpler `src/*` version is acceptable early, but the boundaries should remain clear:

```text
src/web
src/server
src/mcp
src/core
src/db
```

Required architectural boundary:

- UI calls HTTP API.
- MCP tools call shared domain services.
- HTTP API calls shared domain services.
- Domain services call repositories.
- Repositories own database access.

## Local Runtime Requirements

- The app runs as a plain local server.
- The human opens the UI in a browser.
- Agents connect to the MCP server locally.
- V1 assumes one local workspace.
- V1 does not need login.

## Open Questions

- Which database toolkit should be used: Drizzle, Kysely, Prisma, or another option?
- Should the MCP server run as a separate process or inside the same Node process with a separate entrypoint?
- What default task priorities and label conventions should be supported?
- Should completed tasks stay visible on the board by default or move into an archive view?
- Should human-created tasks default to `needs_grooming = false`?
