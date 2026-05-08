# Implementation Plan

## Guiding Principle

Build the MCP contract first, then build the HTTP API and React UI on top of the same domain services.

The app should be useful to agents before it is visually complete. The UI should make agent activity visible, explainable, and easy for the human to override.

## Dependency Map

The phases are ordered by dependency, not just preference:

1. **Foundation** must exist before feature work: project layout, TypeScript, test runner, React shell, server shell, MCP shell, and shared `core`/`db` boundaries.
2. **Domain and MCP contract** must define the workflow rules before persistence, HTTP, or UI code can safely depend on them.
3. **SQLite persistence** depends on the domain model and repository contracts, then makes the workflows durable through a central project registry database plus one repository-local project database per project.
4. **MCP server implementation** depends on durable domain services so agents exercise the real workflow.
5. **HTTP API** depends on the same durable domain services so the UI and MCP stay behaviorally consistent.
6. **React board UI** depends on HTTP board/task/claim endpoints.
7. **Project context UI** depends on project context persistence and HTTP context endpoints.
8. **Activity and review visibility** depends on events, claims, artifacts, and verification being written by earlier MCP and HTTP workflows.
9. **Hardening and polish** depends on the core local workflow being usable end to end.

Parallel work is allowed inside a phase only when it does not bypass these dependencies. For example, UI shell components can be sketched during API work, but they should not define business rules that belong in domain services.

## Phase 0: Project Foundation

Goal: create a clean local development base.

Depends on:

- No earlier implementation phase.

Unblocks:

- Domain modeling, persistence setup, MCP implementation, HTTP API, and UI work.

Tasks:

- Choose package manager and app layout.
- Initialize Node/TypeScript project.
- Add linting, formatting, and test runner.
- Add React app shell.
- Add Node server shell.
- Add separate MCP server entrypoint shell.
- Add shared `core` and `db` boundaries.
- Add local environment configuration.

Deliverables:

- App starts locally.
- Server has health endpoint.
- Separate MCP entrypoint can start and expose a basic `ping` tool.
- Tests can run.

Exit criteria:

- `npm install`, `npm run dev`, and `npm test` or equivalents work.
- Project structure supports web, server, MCP, core, and db code without circular dependencies.

## Phase 1: MCP Contract and Domain Model

Goal: define the agent-facing workflow before building UI behavior around it.

Depends on:

- Phase 0 project structure, test runner, and `core` boundary.

Unblocks:

- SQLite schema/repository design.
- Durable MCP implementation.
- HTTP validation and route behavior.
- UI state semantics.

Tasks:

- Define TypeScript domain types for projects, tasks, claims, events, artifacts, and verification.
- Define named task priorities: `low`, `medium`, `high`, and `urgent`.
- Define labels as free-form strings with optional suggested labels.
- Define input/output schemas for MCP tools.
- Implement validation for task creation, task splitting, claims, completion, and verification.
- Write service interfaces for project, task, claim, event, and artifact workflows.
- Add tests for allowed and rejected state transitions.

Initial MCP tools:

- `list_projects`
- `create_project`
- `register_project`
- `unregister_project`
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

Important decisions to encode:

- Agents are trusted to create tasks.
- Projects can be created into repository-local databases, registered from existing repository-local databases, and unregistered without deleting repo data.
- Human-created tasks default to `needs_grooming = false`.
- Agent-created tasks default to `needs_grooming = true` unless created through an accepted split or completion workflow.
- Split tasks remain flat.
- Split originals are removed from active board flow.
- Claims are temporary leases.
- Claim state is separate from task status.
- Completion requires summary and verification evidence.
- Significant actions create events.

Deliverables:

- MCP schemas documented in code.
- Domain services can be exercised in memory or against a temporary repository.
- Tests cover task splitting, claiming, stale claims, status updates, and completion.

Exit criteria:

- The MCP tool contract is stable enough that agents could integrate against it.
- No UI-specific assumptions leak into MCP response shapes.

## Phase 2: SQLite Persistence

Goal: make the domain durable using SQLite with a Postgres-friendly boundary and a clear split between application registry data and project-owned workflow data.

Depends on:

- Phase 1 domain types, validation rules, service interfaces, and event requirements.

Unblocks:

- Durable MCP workflows.
- Durable HTTP workflows.
- UI state backed by persisted project data.

Tasks:

- Add Drizzle ORM.
- Create Drizzle migrations for the central registry database.
- Create Drizzle migrations for the per-project database.
- Implement a central project registry schema for active project metadata only.
- Implement a per-project schema for the canonical project record, project context, tasks, dependencies, claims, events, artifacts, and verification.
- Store each project database at `.local-agent-kanban/project.sqlite` inside the project repository.
- Add project registration workflows that create or register a project repository database and record its `repo_path` in the central registry.
- Add project unregister workflows that remove only the central registry entry and leave the project repository database untouched.
- Implement stable project IDs stored inside the project database and used by MCP, HTTP, and UI workflows.
- Implement repository interfaces for the central registry and per-project workflow data.
- Implement a project database resolver that maps a canonical project ID to the correct project repository database.
- Wire domain services to SQLite repositories through the resolver.
- Add seed data for local development.
- Add tests against a temporary SQLite database.

Recommended central registry tables:

- `project_registry`

Recommended per-project tables:

- `projects`
- `project_contexts`
- `tasks`
- `task_dependencies`
- `task_claims`
- `task_events`
- `task_artifacts`
- `task_verifications`

Deliverables:

- Central registry and per-project SQLite databases are created through Drizzle migrations.
- Domain service tests pass against SQLite across multiple temporary project repositories.
- Event writing is transactional with the state change it describes.
- Project workflow data is stored only in the repository-local project database.
- The central registry stores only project registration metadata.

Exit criteria:

- A project can be registered, unregistered, and reopened from its repository-local database.
- A project can be created, populated with context, given tasks, claimed by an agent, updated, split, and completed durably in its project database.
- Removing a project from the app deletes no project workflow data.
- A second clone or machine can recover the same canonical project ID from the project database.
- Database-specific code is isolated in `db` or repository modules.

## Phase 3: MCP Server Implementation

Goal: expose the real durable workflows to agents.

Depends on:

- Phase 1 MCP schemas and workflow rules.
- Phase 2 SQLite-backed registry, project database resolver, services, and repositories.

Unblocks:

- End-to-end agent workflow validation.
- HTTP/UI consistency checks against agent-created state.

Tasks:

- Keep MCP running as a separate local process with its own entrypoint.
- Connect MCP tools to domain services.
- Return structured tool results with clear success/error shapes.
- Add friendly validation errors for agents.
- Add MCP-level tests or scripted smoke tests.
- Document local MCP server configuration.

Deliverables:

- MCP server runs independently from the HTTP API while sharing domain, registry, project database resolver, and repository layers.
- Agents can list projects, read context, create tasks, claim tasks, split tasks, record work, and complete tasks.
- MCP tool results include IDs and current state needed for follow-up calls.

Exit criteria:

- A scripted agent workflow can run end to end through MCP only:
  1. Create project.
  2. Update project context.
  3. Create task.
  4. Claim task.
  5. Record artifact.
  6. Record verification.
  7. Complete task.

## Phase 4: Local HTTP API

Goal: expose the same workflows to the React UI without duplicating business logic.

Depends on:

- Phase 1 shared domain services and validation.
- Phase 2 durable repositories.
- Phase 3 MCP behavior as a reference for workflow parity.

Unblocks:

- React board UI.
- Project context UI.
- Activity, claims, artifacts, verification, and review views.

Tasks:

- Add HTTP routes for projects, context, tasks, claims, events, artifacts, and verification.
- Add HTTP routes for project registration, unregistration, and lifecycle metadata updates.
- Reuse domain services for all mutations.
- Add API validation using the same schemas where practical.
- Add integration tests for key routes.
- Add error handling and structured response conventions.

Deliverables:

- Local HTTP API supports the UI workflows.
- API can fetch board state, task details, active claims, stale claims, and activity.

Exit criteria:

- Board state returned by HTTP matches state produced by MCP workflows.
- Claim release and task status updates through HTTP write the same event types as MCP actions.

## Phase 5: React Board UI

Goal: give the human a useful visual control surface.

Depends on:

- Phase 4 HTTP endpoints for projects, tasks, claims, and status updates.

Unblocks:

- Context editing in the same UI shell.
- Review and activity surfaces that link back to tasks.

Tasks:

- Build project selector.
- Build Kanban board columns, including Done visible by default.
- Build task cards with named priority, free-form labels, claim state, stale warning, and needs-grooming flag.
- Build task detail drawer or panel.
- Build drag/drop or explicit status move controls.
- Build task create/edit forms.
- Build claim release action.

Deliverables:

- Human can view and edit project tasks.
- Human can see which tasks are claimed, stale, blocked, in review, or done.
- Completed tasks remain visible in the Done column by default for V1.

Exit criteria:

- A task created by MCP appears in the UI.
- A task moved in the UI is reflected through MCP `list_tasks`.
- Stale claims are visibly distinct.

## Phase 6: Project Context UI

Goal: make project context easy for humans to maintain and agents to consume.

Depends on:

- Phase 4 HTTP endpoints for project context.
- Phase 5 project selector or equivalent UI navigation.

Unblocks:

- Agent-facing context review from the UI.
- Activity visibility for context changes.

Tasks:

- Build project context editor.
- Support Markdown fields for overview, agent instructions, and coding conventions.
- Support structured fields for repo path and commands.
- Show a preview of what agents receive from `get_project_context`.

Deliverables:

- Human can edit global project context.
- Agents receive updated context through MCP.

Exit criteria:

- Context updates through UI are immediately visible through MCP.
- Context updates write activity events.

## Phase 7: Agent Activity and Review Visibility

Goal: turn the UI from a board into an agent operations console.

Depends on:

- Phase 2 event, claim, artifact, and verification persistence.
- Phase 3 MCP workflows writing those records.
- Phase 4 HTTP query endpoints for those records.
- Phase 5 task detail UI surfaces to display linked records.

Unblocks:

- Human operational review of agent work.
- Hardening around stale claims, blocked work, and review queues.

Tasks:

- Build activity feed.
- Build active claims panel.
- Build stale claims panel.
- Build review queue.
- Show task artifacts and verification evidence.
- Highlight agent-created tasks that need grooming.

Deliverables:

- Human can quickly answer: what are agents doing, what is blocked, what needs review, and what has gone stale?

Exit criteria:

- Claim heartbeats and stale claims are visible.
- Review requests are easy to find.
- Completion summaries and verification evidence are visible in task details.

## Phase 8: Hardening and Local Polish

Goal: make the app pleasant and reliable as a daily local tool.

Depends on:

- Phases 0-7 providing a complete local workflow.

Unblocks:

- Daily local use with setup, recovery, migration, and error handling documented.

Tasks:

- Add robust error states.
- Add empty states.
- Add loading states.
- Add keyboard-friendly task workflows where useful.
- Add registry backup/export command.
- Add project database backup/export guidance if practical.
- Add documentation for registering, unregistering, and reopening project repositories.
- Add migration sanity checks.
- Add documentation for local setup and agent configuration.

Deliverables:

- A developer can run the app locally, connect agents, and understand how to recover data.

Exit criteria:

- Fresh clone setup is documented and tested.
- Existing central and project SQLite databases migrate cleanly.
- Common agent workflow failures produce understandable errors.

## Suggested Early Test Scenarios

- Agent creates a task and human sees it on the board.
- Agent splits a task into replacements and the original disappears from active columns.
- Agent claims a task, heartbeats, and completes it.
- Agent claim expires and another agent can reclaim the task.
- Human releases a stale claim.
- Agent records changed files, branch, commit, and test output.
- Agent requests review with a summary.
- Human edits project context and agent reads the new version.

## Initial Build Order

1. Define domain types and MCP schemas.
2. Implement in-memory domain service tests.
3. Add central registry schema, per-project schema, database resolver, and repositories.
4. Wire MCP tools to durable services.
5. Add HTTP API over the same services.
6. Build the minimal board UI.
7. Add context editor.
8. Add activity, claims, and review visibility.

## Quality Bar

- State transitions are tested.
- Mutations write events.
- MCP and HTTP share business logic.
- SQLite access is isolated by registry and per-project repository boundaries.
- The UI exposes agent work clearly rather than hiding it behind generic Kanban behavior.
- The system remains simple enough to run locally without operational ceremony.
