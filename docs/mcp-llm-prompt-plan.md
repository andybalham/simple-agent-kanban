# MCP LLM Prompt Plan

This guide shows how to prompt an MCP-capable LLM to use the `local-agent-kanban` MCP server from project setup through task creation and task execution.

The examples are written for a human who is chatting with an LLM that can call MCP tools. They are not direct JSON tool-call scripts. Keep the returned IDs from each step and substitute them into later prompts where placeholders such as `<PROJECT_ID>`, `<TASK_ID>`, and `<CLAIM_ID>` appear.

## Prerequisites

Before using these prompts:

- Register the MCP server as `local-agent-kanban`.
- Configure the server command to run the MCP entrypoint without writing npm lifecycle banners to stdout.
- Set `LOCAL_AGENT_KANBAN_REGISTRY_DB` to the same registry database used by the local UI/API if you want the browser and MCP server to share state.
- Create or choose a local example repository path. These prompts use `C:\tmp\local-agent-kanban-prompt-demo\example-project`.

Example MCP server configuration:

```json
{
  "mcpServers": {
    "local-agent-kanban": {
      "command": "node",
      "args": ["node_modules/tsx/dist/cli.mjs", "src/mcp/index.ts"],
      "cwd": "C:\\Users\\MONTEITH\\Documents\\New project",
      "env": {
        "LOCAL_AGENT_KANBAN_REGISTRY_DB": "C:\\tmp\\local-agent-kanban-prompt-demo\\registry.sqlite"
      }
    }
  }
}
```

MCP stdio uses stdout for JSON-RPC messages. Avoid configuring clients with plain `npm run dev:mcp`, because npm writes a script banner to stdout before the server handshake. If your client must launch through npm, use `npm --silent run dev:mcp`.

If the MCP client still cannot connect on Windows, use absolute paths so the client does not depend on its inherited `PATH` or `cwd` behavior:

```json
{
  "mcpServers": {
    "local-agent-kanban": {
      "command": "C:\\nvm4w-monteith\\nodejs\\node.exe",
      "args": [
        "C:\\Users\\MONTEITH\\Documents\\New project\\node_modules\\tsx\\dist\\cli.mjs",
        "C:\\Users\\MONTEITH\\Documents\\New project\\src\\mcp\\index.ts"
      ],
      "cwd": "C:\\Users\\MONTEITH\\Documents\\New project",
      "env": {
        "LOCAL_AGENT_KANBAN_REGISTRY_DB": "C:\\tmp\\local-agent-kanban-prompt-demo\\registry.sqlite"
      }
    }
  }
}
```

Useful setup commands for the disposable example repository:

```powershell
New-Item -ItemType Directory -Path "C:\tmp\local-agent-kanban-prompt-demo\example-project" -Force
Set-Content -Path "C:\tmp\local-agent-kanban-prompt-demo\example-project\README.md" -Value "# Prompt Demo Project`n"
```

## Flow 1: Create The Project

### Prompt 1: Create The Project

```text
You have access to the local-agent-kanban MCP server.

Create a new Local Agent Kanban project for this repository:

Name: Prompt Demo Project
Repository path: C:\tmp\local-agent-kanban-prompt-demo\example-project
Description: A disposable project used to demonstrate LLM-driven MCP workflows.

Use actor { "type": "human", "id": "prompt-demo-human" }.

After creating the project, return the project ID and confirm the repository-local project database path.
```

Expected MCP behavior:

- Call `create_project`.
- Optionally call `list_projects` to confirm the project is registered.

Expected result:

- The LLM returns a `projectId`.
- The project is registered in the central registry.
- The repository-local project database exists under `.local-agent-kanban/project.sqlite`.

### Prompt 2: Add Project Context

```text
Using project ID <PROJECT_ID>, update the project context for agents.

Use actor { "type": "human", "id": "prompt-demo-human" }.

Set:
- Overview: This is a disposable demo repository for testing Local Agent Kanban MCP workflows.
- Agent instructions: Work in small task-sized steps. Claim work before starting. Record artifacts and verification before completion.
- Repo path: C:\tmp\local-agent-kanban-prompt-demo\example-project
- Default branch: main
- Package manager: npm
- Install command: npm install
- Test command: npm run test
- Build command: npm run build
- Lint command: npm run lint
- Coding conventions: Keep changes scoped, explain validation, and leave evidence for every completed task.

After updating, read the context back and summarize what agents will see.
```

Expected MCP behavior:

- Call `update_project_context`.
- Call `get_project_context`.

Expected result:

- Project context is stored for `<PROJECT_ID>`.
- The LLM summarizes the context that future agents will receive.

## Flow 2: Add A Planned Backlog

### Prompt 3: Create A Task Backlog

```text
Using project ID <PROJECT_ID>, create an initial task backlog for the Prompt Demo Project.

Use actor { "type": "human", "id": "prompt-demo-human" }.

Create these tasks:

1. Title: Inspect project scaffold
   Status: ready
   Priority: high
   Labels: docs, test
   Acceptance criteria:
   - Project files are inspected.
   - Findings are recorded as a task note.

2. Title: Add README usage notes
   Status: ready
   Priority: medium
   Labels: docs
   Acceptance criteria:
   - README usage section is drafted.
   - Changed file artifact is recorded.
   This task depends on "Inspect project scaffold".

3. Title: Run verification checks
   Status: ready
   Priority: high
   Labels: test
   Acceptance criteria:
   - Test command result is recorded.
   - Build command result is recorded.
   This task depends on "Add README usage notes".

Create the tasks, wire the dependencies, and then list all tasks with their dependency status and claimability.
```

Expected MCP behavior:

- Call `create_task` for each task.
- Call `update_task_dependencies` for dependent tasks.
- Call `list_tasks`.

Expected result:

- Three tasks are created.
- `Add README usage notes` depends on `Inspect project scaffold`.
- `Run verification checks` depends on `Add README usage notes`.
- Only tasks with completed prerequisites and no active claim are claimable.

## Flow 3: Work The Tasks As An Agent

### Prompt 4: Find And Claim Work

```text
You are agent prompt-demo-agent.

Use the local-agent-kanban MCP server to find claimable work for project <PROJECT_ID>.

List only claimable tasks, choose the highest-priority task, claim it for 30 minutes, and return:
- task ID
- task title
- claim ID
- why it was claimable
```

Expected MCP behavior:

- Call `list_tasks` with `claimableOnly: true`.
- Call `claim_task`.

Expected result:

- The LLM chooses the highest-priority claimable task.
- The task receives an active claim for `prompt-demo-agent`.
- The LLM returns `<TASK_ID>` and `<CLAIM_ID>` for later prompts.

### Prompt 5: Work On A Claimed Task

```text
You are agent prompt-demo-agent and you hold claim <CLAIM_ID> on task <TASK_ID>.

Heartbeat the claim for another 30 minutes.

Then record a task note saying what you inspected or changed. If files were changed, record each changed path as a file artifact. If commands were run, record each command as a test, build, or lint artifact with pass/fail metadata.

Do not complete the task yet. Return the updated claim expiration and a short progress summary.
```

Expected MCP behavior:

- Call `heartbeat_claim`.
- Call `add_task_note`.
- Call `record_artifact` for each changed file or command result.

Expected result:

- The claim expiration is extended.
- The task has an immutable progress note.
- Any files, tests, builds, or lint checks are recorded as artifacts.
- The task is not completed yet.

### Prompt 6: Request Human Review

```text
You are agent prompt-demo-agent.

For task <TASK_ID>, request review with this summary:

The task is ready for human review. I inspected the relevant files, recorded the important artifacts, and left verification evidence where available.

After requesting review, list the task and confirm it is in review status.
```

Expected MCP behavior:

- Call `request_review`.
- Call `list_tasks`.

Expected result:

- The task status becomes `review`.
- The task appears in review-oriented UI/API views.
- The review summary is recorded as task activity.

### Prompt 7: Complete Work With Evidence

```text
You are agent prompt-demo-agent.

Complete task <TASK_ID>.

Use this completion summary:
Completed the task and verified the expected behavior for the prompt demo workflow.

Use this verification evidence:
- Reviewed the changed files.
- Confirmed the relevant command output was recorded as artifacts.
- Confirmed the task acceptance criteria were satisfied.

After completion, list the task and confirm it is done.
```

Expected MCP behavior:

- Call `complete_task` with evidence.
- Call `list_tasks`.

Expected result:

- The task status becomes `done`.
- Completion summary and verification evidence are durable.
- The task remains visible in the Done column in the React UI.

## Optional Flow: Split Oversized Work

### Prompt 8: Split Oversized Work

```text
You are agent prompt-demo-agent.

Task <TASK_ID> is too large to complete safely in one pass. Split it into smaller flat replacement tasks.

Use reason:
The task combines documentation, implementation, and verification work that should be tracked separately.

Create these replacement tasks:
1. Draft the documentation change
2. Implement the scoped code change
3. Run and record verification

Keep original prerequisites on the replacement tasks. After splitting, return the archived original task ID and the replacement task IDs.
```

Expected MCP behavior:

- Call `split_task`.

Expected result:

- The original task is archived or superseded and removed from active board columns.
- Replacement tasks are flat tasks.
- The LLM returns the archived original task ID and replacement task IDs.

## Prompting Notes

- Keep IDs returned by each prompt. Later prompts depend on the actual `projectId`, `taskId`, and `claimId` values.
- Ask the LLM to report which MCP tools it used if you want an auditable trace.
- Use `list_tasks` after mutations when you want the LLM to confirm current state, dependency status, claimability, or completion status.
- Use `heartbeat_claim` during long-running work so the claim lease does not expire.
- Use `record_verification` or `complete_task` with evidence before marking work complete. Completion requires a summary and verification evidence.
- Use `request_review` when a human should inspect work before completion.

## Cleanup Prompt

Use this prompt when you want to unregister the disposable demo project without deleting the repository-local database:

```text
You have access to the local-agent-kanban MCP server.

Unregister project <PROJECT_ID> from the Local Agent Kanban registry.

Use actor { "type": "human", "id": "prompt-demo-human" }.

Do not delete or mutate the repository-local project database. After unregistering, list projects and confirm the demo project is no longer registered.
```

Expected MCP behavior:

- Call `unregister_project`.
- Call `list_projects`.

Expected result:

- The project is removed from the local central registry.
- The repository-local `.local-agent-kanban/project.sqlite` database remains in place.
