# Local Agent Kanban Acceptance Test Plan

This plan verifies the completed Local Agent Kanban workflow end to end: local setup, MCP registration, project registration, durable SQLite persistence, MCP workflows, HTTP/API parity, React UI behavior, activity visibility, and cleanup/recovery.

Use a disposable registry database and a disposable example repository while running these tests. The examples below assume Windows PowerShell from the repository root:

```powershell
cd "C:\Users\MONTEITH\Documents\New project"
$env:LOCAL_AGENT_KANBAN_REGISTRY_DB = "C:\tmp\local-agent-kanban-acceptance\registry.sqlite"
$exampleRepo = "C:\tmp\local-agent-kanban-acceptance\example-project"
```

## Acceptance Scope

This plan covers the completed phases in `docs/implementation-plan.md`:

- Foundation and local commands.
- MCP contract and durable MCP server.
- SQLite central registry plus repository-local project database.
- Local HTTP API over the shared services.
- React board UI, project context UI, claims, activity, review, artifacts, and verification visibility.
- Local hardening checks, backup/export, migration sanity, error states, and cleanup.

Passing this plan means a human can run the app locally, connect an MCP-capable agent, create and recover project boards, and verify that MCP, HTTP, UI, and SQLite persistence agree on the same workflow state.

## Prerequisites

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create a clean disposable test area:

   ```powershell
   npm run cleanup:dev
   Remove-Item -LiteralPath "C:\tmp\local-agent-kanban-acceptance" -Recurse -Force -ErrorAction SilentlyContinue
   New-Item -ItemType Directory -Path "C:\tmp\local-agent-kanban-acceptance\example-project" -Force
   Set-Content -Path "C:\tmp\local-agent-kanban-acceptance\example-project\README.md" -Value "# Example Project`n`nDisposable project for Local Agent Kanban acceptance testing."
   ```

3. Run the normal project checks:

   ```powershell
   npm run lint
   npm run test
   npm run build
   npm run check:phase0
   ```

Expected result:

- All commands exit successfully.
- No generated acceptance data appears outside `C:\tmp\local-agent-kanban-acceptance` except normal build artifacts.

## Register The MCP Server

Register this repository's MCP stdio process in your MCP client. Use the command form supported by your client. The server command must run from this repository root and should point at the same registry database used by the HTTP API.

Recommended MCP server configuration:

```json
{
  "mcpServers": {
    "local-agent-kanban": {
      "command": "npm",
      "args": ["run", "dev:mcp"],
      "cwd": "C:\\Users\\MONTEITH\\Documents\\New project",
      "env": {
        "LOCAL_AGENT_KANBAN_REGISTRY_DB": "C:\\tmp\\local-agent-kanban-acceptance\\registry.sqlite"
      }
    }
  }
}
```

If your MCP client does not support `cwd`, use an absolute command and arguments that run the same entrypoint from this repo. For example:

```json
{
  "command": "C:\\nvm4w-monteith\\nodejs\\npm.cmd",
  "args": ["run", "dev:mcp"],
  "cwd": "C:\\Users\\MONTEITH\\Documents\\New project",
  "env": {
    "LOCAL_AGENT_KANBAN_REGISTRY_DB": "C:\\tmp\\local-agent-kanban-acceptance\\registry.sqlite"
  }
}
```

Smoke test the registration from the MCP client:

1. Start or reload the MCP client.
2. Confirm the server named `local-agent-kanban` is connected.
3. Call the `ping` tool.
4. Call `list_projects` with `{}`.

Expected result:

- `ping` returns a structured success response for the MCP process.
- `list_projects` returns `projects: []` for a clean acceptance registry, or only projects intentionally created during this test run.

## Start The Local App

Start the local web app and API using the same registry database:

```powershell
$env:LOCAL_AGENT_KANBAN_REGISTRY_DB = "C:\tmp\local-agent-kanban-acceptance\registry.sqlite"
npm run dev
```

Open:

- Web UI: `http://127.0.0.1:5173`
- API health: `http://127.0.0.1:4000/health`
- API app health: `http://127.0.0.1:4000/api/health`

Expected result:

- The API health endpoint reports healthy.
- The React app loads without an error screen.
- Empty states are understandable when no project has been created yet.

## Example Project

Use this example project throughout the MCP, HTTP, and UI tests:

- Project name: `Acceptance Example Project`
- Repo path: `C:\tmp\local-agent-kanban-acceptance\example-project`
- Registry DB: `C:\tmp\local-agent-kanban-acceptance\registry.sqlite`
- Project DB expected path: `C:\tmp\local-agent-kanban-acceptance\example-project\.local-agent-kanban\project.sqlite`
- Human actor:

  ```json
  { "type": "human", "id": "acceptance-human" }
  ```

- Agent actor:

  ```json
  { "type": "agent", "id": "acceptance-agent" }
  ```

## MCP Workflow Tests

Run these through the MCP client connected to `local-agent-kanban`. Record returned IDs as variables for later steps.

### 1. Create Project

Call `create_project`:

```json
{
  "actor": { "type": "human", "id": "acceptance-human" },
  "name": "Acceptance Example Project",
  "repoPath": "C:\\tmp\\local-agent-kanban-acceptance\\example-project",
  "description": "Disposable project used for acceptance testing."
}
```

Expected result:

- Response contains `projectId`.
- `list_projects` includes the project with the expected `repoPath`.
- `C:\tmp\local-agent-kanban-acceptance\example-project\.local-agent-kanban\project.sqlite` exists.
- The central registry stores project registration metadata only; workflow data is in the project database.

### 2. Update And Read Project Context

Call `update_project_context`:

```json
{
  "actor": { "type": "human", "id": "acceptance-human" },
  "projectId": "<PROJECT_ID>",
  "context": {
    "overviewMarkdown": "Acceptance test project for Local Agent Kanban.",
    "agentInstructionsMarkdown": "Use small tasks, record artifacts, and provide verification evidence.",
    "repoPath": "C:\\tmp\\local-agent-kanban-acceptance\\example-project",
    "defaultBranch": "main",
    "packageManager": "npm",
    "installCommand": "npm install",
    "testCommand": "npm run test",
    "buildCommand": "npm run build",
    "lintCommand": "npm run lint",
    "codingConventionsMarkdown": "Keep changes scoped and update tests for behavior changes."
  }
}
```

Then call `get_project_context`:

```json
{ "projectId": "<PROJECT_ID>" }
```

Expected result:

- The update returns `{ "updated": true }`.
- The read response includes all context fields and the updated values.
- The UI project context editor shows the same values.
- The activity feed includes a context update event.

### 3. Create Tasks And Verify Defaults

Create a human task:

```json
{
  "actor": { "type": "human", "id": "acceptance-human" },
  "projectId": "<PROJECT_ID>",
  "title": "Prepare acceptance fixture",
  "description": "Create the small fixture needed by later tests.",
  "acceptanceCriteria": ["Fixture repository exists", "Project database exists"],
  "status": "ready",
  "priority": "medium",
  "labels": ["test"]
}
```

Create an agent task:

```json
{
  "actor": { "type": "agent", "id": "acceptance-agent" },
  "projectId": "<PROJECT_ID>",
  "title": "Implement acceptance change",
  "description": "Representative agent-created work item.",
  "acceptanceCriteria": ["Artifact recorded", "Verification recorded"],
  "status": "ready",
  "priority": "high",
  "labels": ["feature", "mcp"]
}
```

Expected result:

- Both calls return `taskId`.
- Human-created task has `needsGrooming: false`.
- Agent-created task has `needsGrooming: true`.
- Both ready tasks appear in `list_tasks`.
- The UI board shows both tasks in the Ready column, including priority and labels.
- The agent-created task visibly indicates that it needs grooming.

### 4. Validate Dependencies And Claimability

Create a blocked task that depends on the human task:

```json
{
  "actor": { "type": "human", "id": "acceptance-human" },
  "projectId": "<PROJECT_ID>",
  "title": "Run acceptance verification",
  "description": "Should not be claimable until the fixture task is done.",
  "status": "ready",
  "priority": "medium",
  "labels": ["test"],
  "prerequisiteTaskIds": ["<HUMAN_TASK_ID>"]
}
```

Call `list_tasks`:

```json
{
  "projectId": "<PROJECT_ID>",
  "claimableOnly": true
}
```

Expected result:

- The dependent task has `dependencyStatus: "blocked_by_tasks"`.
- The dependent task is not returned when `claimableOnly` is true.
- The dependent task's `blockingPrerequisites` includes the human task.
- The UI shows the dependency/blocking state on the task card or detail view.

Negative dependency tests:

1. Call `update_task_dependencies` on the human task with the dependent task as a prerequisite, creating a cycle.
2. Try setting a prerequisite ID that does not exist.

Expected result:

- Both calls fail with a friendly structured validation error.
- No dependency event is written for the rejected mutation.
- Existing task dependencies remain unchanged.

### 5. Claim, Heartbeat, Release, And Reclaim

Claim the agent task:

```json
{
  "agentId": "acceptance-agent",
  "taskId": "<AGENT_TASK_ID>",
  "leaseSeconds": 60
}
```

Heartbeat the claim:

```json
{
  "agentId": "acceptance-agent",
  "claimId": "<CLAIM_ID>",
  "leaseSeconds": 120
}
```

Attempt a second claim while the first claim is active:

```json
{
  "agentId": "other-agent",
  "taskId": "<AGENT_TASK_ID>",
  "leaseSeconds": 60
}
```

Release the original claim:

```json
{
  "actor": { "type": "human", "id": "acceptance-human" },
  "claimId": "<CLAIM_ID>"
}
```

Claim it again:

```json
{
  "agentId": "other-agent",
  "taskId": "<AGENT_TASK_ID>",
  "leaseSeconds": 60
}
```

Expected result:

- First claim returns `claimId`, `agentId`, `expiresAt`, and `lastHeartbeatAt`.
- Heartbeat extends `expiresAt`.
- Second active claim is rejected while the original claim is active.
- Releasing the claim returns `released: true`.
- Reclaim after release succeeds.
- Active/released claim state is visible through the UI claims panels and task detail.
- Activity contains `task.claimed`, `task.heartbeat`, and `task.claim_released` events.

### 6. Record Notes, Artifacts, Verification, Review, And Completion

Add a note:

```json
{
  "actor": { "type": "agent", "id": "acceptance-agent" },
  "taskId": "<AGENT_TASK_ID>",
  "note": "Acceptance note from the MCP workflow."
}
```

Record artifacts:

```json
{
  "actor": { "type": "agent", "id": "acceptance-agent" },
  "taskId": "<AGENT_TASK_ID>",
  "kind": "file",
  "value": "README.md",
  "metadata": { "reason": "fixture touched during acceptance test" }
}
```

```json
{
  "actor": { "type": "agent", "id": "acceptance-agent" },
  "taskId": "<AGENT_TASK_ID>",
  "kind": "test",
  "value": "npm run test",
  "metadata": { "result": "passed" }
}
```

Record verification:

```json
{
  "actor": { "type": "agent", "id": "acceptance-agent" },
  "taskId": "<AGENT_TASK_ID>",
  "summary": "Acceptance verification was recorded.",
  "evidence": ["npm run test passed", "Task detail shows artifacts and verification"]
}
```

Request review:

```json
{
  "actor": { "type": "agent", "id": "acceptance-agent" },
  "taskId": "<AGENT_TASK_ID>",
  "summary": "Ready for human acceptance review."
}
```

Complete the task:

```json
{
  "actor": { "type": "agent", "id": "acceptance-agent" },
  "taskId": "<AGENT_TASK_ID>",
  "summary": "Completed during acceptance testing."
}
```

Expected result:

- Notes return an `eventId`.
- Artifacts return `artifactId`.
- Verification returns `verificationId`.
- Review moves the task to `review`.
- Completion moves the task to `done` and returns `completedAt`.
- Done tasks remain visible in the UI Done column.
- Task detail shows note, artifacts, verification evidence, review summary, completion summary, and activity timeline.

Negative completion test:

1. Create a fresh ready task.
2. Try `complete_task` with a summary but without prior recorded verification and without inline `evidence`.

Expected result:

- Completion fails with a friendly structured validation error.
- The task remains non-done.
- No completion event is written.

### 7. Split A Task

Create a broad task:

```json
{
  "actor": { "type": "agent", "id": "acceptance-agent" },
  "projectId": "<PROJECT_ID>",
  "title": "Broad acceptance task",
  "description": "Task intentionally too large.",
  "status": "ready",
  "priority": "high",
  "labels": ["refactor"]
}
```

Split it:

```json
{
  "actor": { "type": "agent", "id": "acceptance-agent" },
  "taskId": "<BROAD_TASK_ID>",
  "reason": "Split into smaller acceptance-testable units.",
  "replacements": [
    {
      "title": "Acceptance split part one",
      "description": "First replacement task.",
      "status": "ready",
      "priority": "medium",
      "labels": ["test"]
    },
    {
      "title": "Acceptance split part two",
      "description": "Second replacement task.",
      "status": "backlog",
      "priority": "medium",
      "labels": ["test"]
    }
  ],
  "dependencyHandling": {
    "moveOriginalPrerequisitesToReplacements": true
  }
}
```

Expected result:

- Response contains `archivedTaskId` and two `replacementTaskIds`.
- The original broad task is archived and removed from active board columns.
- Replacement tasks are flat tasks, not children in a nested task hierarchy.
- Replacement tasks record source/split traceability in task detail or activity.
- Activity contains a `task.split` event.

Negative split test:

1. Try splitting a task with only one replacement.
2. Try splitting without a reason.

Expected result:

- Both calls fail with structured validation errors.
- The original task remains unchanged.

## HTTP API Parity Tests

Use PowerShell or another HTTP client while `npm run dev` is running.

### 1. Project And Task State Match MCP

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/projects"
Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/projects/<PROJECT_ID>/tasks"
Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/projects/<PROJECT_ID>/events"
```

Expected result:

- Project list includes the MCP-created project.
- Task list contains the same statuses, priorities, labels, grooming flags, claims, dependency facts, artifacts, verification, and completion state produced through MCP.
- Event list includes the MCP-created mutation events.

### 2. UI/HTTP Mutations Are Visible Through MCP

Use the UI or HTTP API to create a human task. Example HTTP request:

```powershell
$body = @{
  actor = @{ type = "human"; id = "acceptance-human" }
  title = "HTTP-created acceptance task"
  description = "Created through HTTP to verify MCP parity."
  status = "ready"
  priority = "low"
  labels = @("api", "test")
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4000/api/projects/<PROJECT_ID>/tasks" -ContentType "application/json" -Body $body
```

Then call MCP `list_tasks`:

```json
{ "projectId": "<PROJECT_ID>" }
```

Expected result:

- MCP sees the HTTP-created task.
- The task has `needsGrooming: false` because it was human-created.
- Activity includes a task creation event.

### 3. Claim Release Event Parity

Create and claim a task through MCP, then release the claim through HTTP:

```powershell
$body = @{
  actor = @{ type = "human"; id = "acceptance-human" }
} | ConvertTo-Json -Depth 4

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4000/api/claims/<CLAIM_ID>/release" -ContentType "application/json" -Body $body
```

Expected result:

- MCP `list_tasks` shows no active claim on that task.
- HTTP events include `task.claim_released`.
- UI active claims panel no longer lists the released claim.

## React UI Acceptance Tests

Run these in the browser at `http://127.0.0.1:5173`.

### 1. Project Selector

Expected result:

- The project selector lists `Acceptance Example Project`.
- Selecting the project loads the board.
- The app shows retryable error states if the API is stopped, and recovers after the API is restarted and the retry/refresh action is used.

### 2. Kanban Board

Expected result:

- Columns are visible for Backlog, Ready, In Progress, Blocked, Review, and Done.
- Done remains visible by default.
- Task cards show title, priority, labels, dependency state, claim state, stale warning where applicable, and needs-grooming flag.
- Moving a task through UI controls updates the board and is visible through MCP `list_tasks`.

### 3. Task Detail

Expected result:

- Opening a task shows description, acceptance criteria, status, prerequisites, dependents, claim state, notes, artifacts, verification, and activity timeline.
- Artifacts and verification recorded through MCP are visible without manual database inspection.
- Completion summary and evidence are visible for done tasks.

### 4. Project Context

Expected result:

- Context editor shows overview, agent instructions, repo path, branch, package manager, commands, and coding conventions.
- Editing and saving context writes an activity event.
- MCP `get_project_context` returns the updated context immediately.
- The agent-facing preview matches the saved context.

### 5. Activity, Claims, And Review Visibility

Expected result:

- Activity feed shows project context updates, task creation, dependencies, claims, heartbeats, claim releases, notes, artifacts, verification, review requests, splits, and completion events.
- Active claims panel shows unexpired active claims.
- Stale claims panel distinguishes expired claims after their lease expires.
- Review queue lists tasks in review and links to the relevant task detail.
- Human claim release from the UI removes the active/stale claim and writes an event.

## Persistence And Recovery Tests

### 1. Data Location

Expected result:

- Central registry exists at `C:\tmp\local-agent-kanban-acceptance\registry.sqlite`.
- Project database exists at `C:\tmp\local-agent-kanban-acceptance\example-project\.local-agent-kanban\project.sqlite`.
- Project workflow data survives app restarts because it lives in the project database.

### 2. Restart Recovery

1. Stop the MCP client/server and `npm run dev`.
2. Start `npm run dev` again with the same `LOCAL_AGENT_KANBAN_REGISTRY_DB`.
3. Reload the MCP client with the same MCP server configuration.
4. Call `list_projects`, `get_project_context`, and `list_tasks`.
5. Open the UI.

Expected result:

- Project ID is unchanged.
- Context, tasks, dependencies, claims, artifacts, verification, review state, done tasks, and activity history are still present.
- UI and MCP still agree.

### 3. Unregister And Re-register

Call MCP `unregister_project`:

```json
{
  "actor": { "type": "human", "id": "acceptance-human" },
  "projectId": "<PROJECT_ID>"
}
```

Expected result:

- `list_projects` no longer includes the project.
- `C:\tmp\local-agent-kanban-acceptance\example-project\.local-agent-kanban\project.sqlite` still exists.

Call MCP `register_project`:

```json
{
  "actor": { "type": "human", "id": "acceptance-human" },
  "repoPath": "C:\\tmp\\local-agent-kanban-acceptance\\example-project"
}
```

Expected result:

- Returned `projectId` matches the original canonical project ID.
- Project tasks, context, events, artifacts, and verification are still present.
- UI shows the re-registered project.

### 4. Backup And Migration Sanity

Run:

```powershell
npm run backup:registry -- "C:\tmp\local-agent-kanban-acceptance\registry.sqlite" "C:\tmp\local-agent-kanban-acceptance\backups"
npm run check:phase8 -- "C:\tmp\local-agent-kanban-acceptance\registry.sqlite"
```

Expected result:

- Backup command writes a registry backup and manifest under the acceptance backup folder.
- Phase 8 check succeeds and confirms registry/project databases can accept current migrations and sanity checks.

## Validation And Error Handling Tests

Each rejected operation should return a structured, friendly error and leave persisted state unchanged.

Run these negative tests through MCP and, where an equivalent route exists, HTTP:

- Create a task with an invalid status.
- Create a task with an invalid priority.
- Create a task with an empty title.
- Claim a task that is not `ready`.
- Claim a task with incomplete prerequisites.
- Claim a task that already has an active unexpired claim.
- Heartbeat a claim with the wrong agent ID.
- Complete a task without summary.
- Complete a task without verification evidence and without previously recorded verification.
- Split a task with fewer than two replacements.
- Add dependency cycles.
- Register a repo path that has no project database after it has not been created through `create_project`.
- Unregister a project ID that does not exist.

Expected result:

- Error responses include `ok: false` or the API equivalent, an error code, a human-readable message, and useful details.
- No partial task, dependency, claim, artifact, verification, or event writes are visible after a rejected operation.
- UI displays understandable error messages and allows retry or correction.

## Final Acceptance Checklist

- `npm run lint`, `npm run test`, `npm run build`, and `npm run check:phase0` pass.
- MCP server is registered and `ping` plus `list_projects` work.
- Example project can be created through MCP and appears in the UI.
- Project database is created under the example repository at `.local-agent-kanban/project.sqlite`.
- Project context updates through MCP are visible in UI and activity.
- Human-created tasks default to `needsGrooming: false`.
- Agent-created tasks default to `needsGrooming: true`.
- Dependencies are represented as a DAG, block claimability, and reject cycles.
- Claims are leases separate from task status and can be heartbeated, released, and reclaimed.
- Artifacts, verification, notes, review requests, and completion are durable and visible.
- Completion requires summary plus verification evidence.
- Split tasks remain flat and archive the original broad task.
- HTTP API state matches MCP-created state.
- UI-created or HTTP-created state is visible through MCP.
- Done column remains visible by default.
- Activity, active claims, stale claims, and review queue are operationally useful.
- Unregistering a project removes only central registry metadata and does not delete the project database.
- Re-registering a project recovers the same canonical project ID and workflow data.
- Backup and Phase 8 sanity checks pass.

## Cleanup

After acceptance testing:

```powershell
npm run cleanup:dev -- --repo "C:\tmp\local-agent-kanban-acceptance\example-project"
Remove-Item -LiteralPath "C:\tmp\local-agent-kanban-acceptance" -Recurse -Force -ErrorAction SilentlyContinue
```

Expected result:

- Local dev processes on the default ports are stopped.
- Disposable acceptance registry, backups, logs, and project repository are removed.
