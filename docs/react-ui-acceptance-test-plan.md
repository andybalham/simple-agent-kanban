# React UI Acceptance Test Plan

This plan covers manual acceptance testing for the React UI only. It verifies the browser experience at `http://127.0.0.1:5173`, with setup and cleanup commands used only to create an isolated local test environment.

Project removal is listed as a current UI gap because the React app does not expose a remove or unregister project control.

## Scope

Run these tests against a disposable registry database and disposable example repositories so acceptance testing does not affect normal local data.

In scope:

- Empty project state.
- Adding projects through the React UI.
- Selecting and switching projects.
- Creating, editing, moving, archiving, and completing tasks through the React UI.
- Verifying task detail, operations console, activity, grooming, review, refresh, keyboard, and retry behavior.
- Documenting the current project removal gap.

Out of scope:

- MCP registration and MCP tool behavior.
- Direct API acceptance, except for setup, health checks, and optional fixture cleanup.
- Automated Playwright or browser automation specs.

## Test Environment

Use PowerShell from the repository root:

```powershell
cd "C:\Users\MONTEITH\Documents\New project"
$env:LOCAL_AGENT_KANBAN_REGISTRY_DB = "C:\tmp\local-agent-kanban-ui-acceptance\registry.sqlite"
$projectA = "C:\tmp\local-agent-kanban-ui-acceptance\project-a"
$projectB = "C:\tmp\local-agent-kanban-ui-acceptance\project-b"
```

On Windows PowerShell, use `npm.cmd` instead of `npm` if `npm.ps1` is blocked by the local execution policy.

Create clean disposable project folders:

```powershell
npm.cmd run cleanup:dev
Remove-Item -LiteralPath "C:\tmp\local-agent-kanban-ui-acceptance" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $projectA -Force
New-Item -ItemType Directory -Path $projectB -Force
Set-Content -Path "$projectA\README.md" -Value "# UI Acceptance Project A`n"
Set-Content -Path "$projectB\README.md" -Value "# UI Acceptance Project B`n"
```

Run prerequisite checks before starting manual UI acceptance:

```powershell
npm.cmd install
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

Expected result:

- All commands exit successfully.
- No acceptance data is created outside `C:\tmp\local-agent-kanban-ui-acceptance`, except normal build or cache artifacts.

Start the local app:

```powershell
$env:LOCAL_AGENT_KANBAN_REGISTRY_DB = "C:\tmp\local-agent-kanban-ui-acceptance\registry.sqlite"
npm.cmd run dev
```

Open:

- React UI: `http://127.0.0.1:5173`
- API health check: `http://127.0.0.1:4000/health`

Expected result:

- The health endpoint reports healthy.
- The React app loads without a fatal error.

## Test Data

Use these exact values so results are easy to compare:

- Project A name: `UI Acceptance Project A`
- Project A repo path: `C:\tmp\local-agent-kanban-ui-acceptance\project-a`
- Project B name: `UI Acceptance Project B`
- Project B repo path: `C:\tmp\local-agent-kanban-ui-acceptance\project-b`

Task set for Project A:

- Backlog task: `UI backlog task`
- Ready task: `UI ready task`
- In-progress task: `UI in-progress task`
- Review task: `UI review task`
- Grooming task: `UI grooming task`
- Completion task: `UI completion task`
- Archive task: `UI archive task`

Task set for Project B:

- `Project B isolated task`

## Acceptance Scenarios

### 1. Empty Project State

Steps:

1. Open `http://127.0.0.1:5173` with the clean registry database.
2. Confirm the project selector is disabled or shows no registered projects.
3. Confirm the board area shows the empty project state.
4. Click the empty-state `New Project` action.

Expected result:

- The app clearly communicates that there are no registered projects.
- The `New Project` form becomes available.
- No task columns show stale data from another registry.

### 2. Create Project A

Steps:

1. In the `New Project` form, enter:
   - Project name: `UI Acceptance Project A`
   - Repository path: `C:\tmp\local-agent-kanban-ui-acceptance\project-a`
2. Submit with `Create`.

Expected result:

- Project A is selected automatically.
- The board header shows `UI Acceptance Project A`.
- The project path is visible in the board header.
- The board columns render for Backlog, Ready, In Progress, Blocked, Review, and Done.
- All columns initially show `No tasks`.
- The project database exists at `C:\tmp\local-agent-kanban-ui-acceptance\project-a\.local-agent-kanban\project.sqlite`.

### 3. Create Project B And Switch Projects

Steps:

1. Click `New Project` again.
2. Enter:
   - Project name: `UI Acceptance Project B`
   - Repository path: `C:\tmp\local-agent-kanban-ui-acceptance\project-b`
3. Submit with `Create`.
4. Use the project selector to switch back to Project A.
5. Switch again to Project B.

Expected result:

- Project B is created and selected after submit.
- Both Project A and Project B appear in the project selector.
- Switching projects updates the board header and project path.
- Each project has an isolated board.
- Project B does not show tasks created later in Project A.

### 4. Create Tasks In Multiple Statuses

Run these steps while Project A is selected.

For each Project A task, use the `Create Task` form and submit with `Create Task`:

| Title               | Status      | Priority | Labels           | Acceptance Criteria                       | Needs Grooming |
| ------------------- | ----------- | -------- | ---------------- | ----------------------------------------- | -------------- |
| UI backlog task     | Backlog     | Low      | `ui, backlog`    | `Appears in Backlog`                      | Off            |
| UI ready task       | Ready       | Medium   | `ui, ready`      | `Appears in Ready`                        | Off            |
| UI in-progress task | In Progress | High     | `ui, active`     | `Appears in In Progress`                  | Off            |
| UI review task      | Review      | Urgent   | `ui, review`     | `Appears in Review queue`                 | Off            |
| UI grooming task    | Backlog     | Medium   | `ui, grooming`   | `Appears in Needs Grooming operations UI` | On             |
| UI completion task  | Ready       | High     | `ui, completion` | `Can be completed with evidence`          | Off            |
| UI archive task     | Ready       | Low      | `ui, archive`    | `Can be archived from card move control`  | Off            |

Expected result:

- Each task appears in the column selected in the create form.
- Column counts update immediately after each submit.
- Labels render on the task cards.
- Priority renders on the task cards.
- `UI review task` appears in the Review column and increments the Review operations metric.
- `UI grooming task` appears in the Needs Grooming operations area and increments the Needs Grooming metric.
- The create form resets after each successful submit.

### 5. Verify Project Isolation

Steps:

1. Switch to Project B.
2. Confirm Project B has no Project A tasks.
3. Create one task:
   - Title: `Project B isolated task`
   - Status: Ready
   - Priority: Medium
   - Labels: `ui, isolation`
   - Acceptance criteria: `Only visible in Project B`
4. Switch back to Project A.
5. Switch again to Project B.

Expected result:

- Project A does not show `Project B isolated task`.
- Project B does not show Project A tasks.
- Task counts and operations metrics update based only on the selected project.

### 6. Select And Edit A Task

Run these steps while Project A is selected.

Steps:

1. Select `UI backlog task`.
2. In Task Detail, update:
   - Title: `UI backlog task edited`
   - Description: `Edited through the React UI task detail form.`
   - Priority: Urgent
   - Labels: `ui, edited, detail`
   - Acceptance criteria: add `Edited fields persist after refresh`
   - Needs Grooming: On
3. Submit with `Save Task`.
4. Click `Refresh`.
5. Re-select the edited task if needed.

Expected result:

- The task card title updates to `UI backlog task edited`.
- The task card shows the updated priority and labels.
- The Needs Grooming metric increments.
- Task Detail retains the edited description, labels, priority, acceptance criteria, and grooming flag after refresh.
- Activity shows a task update event.

### 7. Move Tasks Between Columns

Run these steps from the task cards using the `Move` status selector.

Steps:

1. Move `UI ready task` from Ready to In Progress.
2. Move it from In Progress to Blocked.
3. Move it from Blocked to Review.
4. Move it from Review to Backlog.
5. Move it from Backlog to Ready.

Expected result:

- The task moves to the selected column after each change.
- Source and destination column counts update each time.
- The selected task detail remains consistent if the task is selected while moving.
- Activity records status change events.
- No move to Done is available through the generic status selector for non-done tasks; completion must use the Complete Task form.

### 8. Archive A Task

Steps:

1. Locate `UI archive task`.
2. Use its card `Move` selector and choose `archived`.
3. Click `Refresh`.

Expected result:

- The task disappears from all active board columns.
- Existing visible columns remain Backlog, Ready, In Progress, Blocked, Review, and Done.
- The board does not render an Archived column.
- Activity records an archive/status event.

### 9. Complete A Task

Steps:

1. Select `UI completion task`.
2. In the Complete Task form, enter:
   - Summary: `Completed through the React UI acceptance flow.`
   - Evidence:
     ```text
     Manual UI completion form submitted.
     Done column retained the completed task.
     ```
3. Submit with `Complete`.

Expected result:

- The task moves to the Done column.
- The Done column remains visible.
- The completed task remains visible in Done after `Refresh`.
- The Complete Task form is no longer shown for the done task.
- Task Detail shows completion-related evidence in the evidence area.
- Activity records completion and verification-related events.

Negative check:

1. Select a non-done task.
2. Attempt to submit Complete Task without a summary.

Expected result:

- The UI does not submit an empty completion summary.
- The task remains in its current status.
- No new completion event appears.

### 10. Verify Operations Console

Steps:

1. Confirm `UI review task` appears in the Review Queue.
2. Confirm `UI grooming task` and `UI backlog task edited` appear in Needs Grooming.
3. Select a task from the Review Queue.
4. Select a task from Needs Grooming.
5. Inspect the Activity panel.

Expected result:

- Review metric reflects the number of review tasks.
- Needs Grooming metric reflects the number of grooming tasks.
- Clicking operations queue items selects the matching task and opens Task Detail.
- Activity panel shows recent project/task actions from the UI flow.

### 11. Verify Task Detail Evidence And Timeline

Steps:

1. Select `UI completion task`.
2. Review Task Detail.
3. Select `UI backlog task edited`.
4. Review Task Detail.

Expected result:

- Completed task detail shows verification evidence from completion.
- Edited task detail shows updated form values.
- Task timelines show events relevant to the selected task.
- Detail view updates when switching selected tasks.

### 12. Verify Refresh And Keyboard Shortcuts

Steps:

1. Click `Refresh`.
2. Confirm board data remains stable.
3. Select any task.
4. Click outside text inputs.
5. Press `Escape`.
6. Select Project A again if needed, click outside text inputs, and press `r`.

Expected result:

- Refresh reloads board data without duplicating tasks.
- `Escape` clears the selected task and returns Task Detail to its empty selection state.
- `r` refreshes the board when focus is not inside an input, textarea, or select.
- Keyboard shortcuts do not trigger while editing text fields.

### 13. Verify Retryable Error Behavior

Steps:

1. Stop the local API/dev server.
2. With the browser still open, click `Refresh`.
3. Observe the error notice.
4. Restart `npm.cmd run dev` with the same `LOCAL_AGENT_KANBAN_REGISTRY_DB`.
5. Click `Retry`.

Expected result:

- The UI shows an understandable error instead of crashing.
- The error notice includes a Retry action.
- Retry reloads the selected project after the API is available again.
- Previously created projects and tasks remain present.

## Project Removal Gap

Current status: blocked for React UI acceptance.

The current React UI does not expose a remove or unregister project control. Because of that, project removal cannot be tested through the React UI in this acceptance pass.

This is not a failed UI acceptance scenario for the current implementation. It is a known gap to address when a project removal control is added.

Future acceptance criteria for React UI project removal:

- A user can initiate removal from the selected project context or project selector area.
- The UI presents a confirmation that makes clear the action unregisters the project from the app but does not delete the repository-local project database.
- After confirmation, the project disappears from the selector.
- If other projects remain, the UI selects another registered project and reloads its board.
- If no projects remain, the UI returns to the empty project state.
- The removed project's repository database remains at `.local-agent-kanban/project.sqlite`.
- The project can still be re-registered later through API or MCP because the canonical project database was not deleted.

## Final Checklist

- React app loads at `http://127.0.0.1:5173`.
- Empty project state is clear.
- Project A and Project B can be created through the UI.
- Project selector switches between projects and keeps boards isolated.
- Tasks can be created in Backlog, Ready, In Progress, Review, and Done-adjacent workflows.
- Task fields can be edited through Task Detail.
- Task status moves work through the visible card move selector.
- Archived tasks disappear from active board columns.
- Tasks can be completed only through the Complete Task form with summary and evidence.
- Done column remains visible and completed tasks remain visible.
- Review, grooming, activity, task detail, refresh, keyboard, and retry behavior work as expected.
- Project removal is documented as blocked because no React UI control currently exists.

## Cleanup

After testing:

```powershell
npm.cmd run cleanup:dev -- --repo "C:\tmp\local-agent-kanban-ui-acceptance\project-a" --repo "C:\tmp\local-agent-kanban-ui-acceptance\project-b"
Remove-Item -LiteralPath "C:\tmp\local-agent-kanban-ui-acceptance" -Recurse -Force -ErrorAction SilentlyContinue
```

Expected result:

- Local dev processes on the default ports are stopped.
- Disposable UI acceptance registry, project databases, logs, and example project folders are removed.
