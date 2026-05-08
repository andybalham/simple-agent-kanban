import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodError, type z } from 'zod';

import {
  createPingResponse,
  DomainValidationError,
  mcpToolSchemas,
  type LocalAgentKanbanService,
  type ProjectContext,
  type TaskClaim,
  type TaskEvent,
  type TaskWithRelations,
} from '../core/index.ts';

type ToolName = keyof typeof mcpToolSchemas;
type ToolInput<TName extends ToolName> = z.infer<(typeof mcpToolSchemas)[TName]['input']>;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/**
 * MCP is an adapter boundary: it validates the agent-facing contract, then
 * delegates all workflow rules to the shared service used by future HTTP
 * routes. Tool handlers should stay thin so MCP never becomes a second domain
 * implementation.
 */
export function createKanbanMcpServer(service: LocalAgentKanbanService): McpServer {
  const server = new McpServer({
    name: 'local-agent-kanban',
    version: '0.1.0',
  });

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Check that the Local Agent Kanban MCP process is reachable.',
    },
    async () => success(createPingResponse('mcp') as unknown as JsonObject),
  );

  registerWorkflowTool(server, 'list_projects', 'List projects agents can work with.', () => ({
    projects: service.listProjects().map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      repoPath: project.repoPath,
      projectDbPath: project.projectDbPath,
      lifecycleStatus: project.lifecycleStatus,
      updatedAt: project.updatedAt.toISOString(),
    })),
  }));

  registerWorkflowTool(server, 'create_project', 'Create a local project board.', (input) => {
    const project = service.createProject(input);
    return { projectId: project.id };
  });

  registerWorkflowTool(server, 'register_project', 'Register an existing repository-local project database.', (input) => {
    const project = service.registerProject(input);
    return { projectId: project.id, registered: true };
  });

  registerWorkflowTool(server, 'unregister_project', 'Remove a project from the local registry without deleting repository data.', (input) =>
    service.unregisterProject(input.actor, input.projectId),
  );

  registerWorkflowTool(server, 'get_project_context', 'Read the agent-facing project context.', (input) =>
    contextResult(service.getProjectContext(input.projectId)),
  );

  registerWorkflowTool(server, 'update_project_context', 'Update the agent-facing project context.', (input) => {
    service.updateProjectContext(input.actor, input.projectId, input.context);
    return { projectId: input.projectId, updated: true };
  });

  registerWorkflowTool(server, 'list_tasks', 'List tasks and claimability facts.', (input) => ({
    tasks: service.listTasks(input).map(taskResult),
  }));

  registerWorkflowTool(server, 'create_task', 'Create a task in the shared workflow service.', (input) =>
    taskResult(service.createTask(input)),
  );

  registerWorkflowTool(server, 'update_task_dependencies', 'Replace a task prerequisite list after DAG validation.', (input) => {
    const task = service.updateTaskDependencies(input.actor, input.taskId, input.prerequisiteTaskIds);
    return { taskId: task.id, prerequisiteTaskIds: task.prerequisiteTaskIds };
  });

  registerWorkflowTool(server, 'split_task', 'Split a broad task into flat replacement tasks.', (input) => {
    const split = service.splitTask(input);
    return {
      archivedTaskId: split.archivedTask.id,
      replacementTaskIds: split.replacementTasks.map((task) => task.id),
    };
  });

  registerWorkflowTool(server, 'claim_task', 'Claim a ready and unblocked task with a temporary lease.', (input) => {
    const claim = service.claimTask(input.agentId, input.taskId, input.leaseSeconds);
    return claimResult(claim);
  });

  registerWorkflowTool(server, 'heartbeat_claim', 'Extend a task claim lease for the owning agent.', (input) => {
    const claim = service.heartbeatClaim(input.agentId, input.claimId, input.leaseSeconds);
    return { claimId: claim.id, expiresAt: claim.expiresAt.toISOString() };
  });

  registerWorkflowTool(server, 'release_claim', 'Release an active task claim.', (input) => {
    const claim = service.releaseClaim(input.actor, input.claimId);
    return { claimId: claim.id, released: true };
  });

  registerWorkflowTool(server, 'update_task_status', 'Move a task through non-completion board statuses.', (input) =>
    taskResult(service.updateTaskStatus(input.actor, input.taskId, input.status)),
  );

  registerWorkflowTool(server, 'add_task_note', 'Append an immutable note event to a task.', (input) => {
    const event = service.addTaskNote(input.actor, input.taskId, input.note);
    return eventResult(event);
  });

  registerWorkflowTool(server, 'record_artifact', 'Record work evidence such as files, commits, branches, or test output.', (input) => {
    const artifact = service.recordArtifact(input.actor, input.taskId, input.kind, input.value, input.metadata);
    return { artifactId: artifact.id };
  });

  registerWorkflowTool(server, 'record_verification', 'Record explicit verification evidence for completion.', (input) => {
    const verification = service.recordVerification(input.actor, input.taskId, input.summary, input.evidence);
    return { verificationId: verification.id };
  });

  registerWorkflowTool(server, 'request_review', 'Move a task into review with an agent summary.', (input) =>
    taskResult(service.requestReview(input.actor, input.taskId, input.summary)),
  );

  registerWorkflowTool(server, 'complete_task', 'Complete a task with summary and verification evidence.', (input) => {
    const task = service.completeTask(input.actor, input.taskId, input.summary, input.evidence);
    return {
      ...taskResult(task),
      completedAt: task.completedAt?.toISOString() ?? new Date().toISOString(),
    };
  });

  return server;
}

function registerWorkflowTool<TName extends ToolName>(
  server: McpServer,
  name: TName,
  description: string,
  handler: (input: ToolInput<TName>) => JsonObject,
): void {
  const schema = mcpToolSchemas[name];
  server.registerTool(
    name,
    {
      title: titleFromToolName(name),
      description,
      inputSchema: schema.input,
      outputSchema: schema.output,
    },
    async (input: unknown) => {
      try {
        return success(handler(input as ToolInput<TName>));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function success(structuredContent: JsonObject): CallToolResult {
  return {
    structuredContent,
    content: [{ type: 'text', text: JSON.stringify({ ok: true, ...structuredContent }) }],
  };
}

function failure(error: unknown): CallToolResult {
  const normalized = normalizeError(error);
  return {
    isError: true,
    structuredContent: normalized,
    content: [{ type: 'text', text: JSON.stringify(normalized) }],
  };
}

function normalizeError(error: unknown): JsonObject {
  if (error instanceof DomainValidationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: 'Tool input failed validation.',
        details: error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`),
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'internal_error',
      message: error instanceof Error ? error.message : String(error),
      details: [],
    },
  };
}

function taskResult(task: TaskWithRelations): JsonObject {
  return {
    taskId: task.id,
    projectId: task.projectId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    labels: task.labels,
    needsGrooming: task.needsGrooming,
    dependencyStatus: task.dependencyStatus,
    prerequisiteTaskIds: task.prerequisiteTaskIds,
    dependentTaskIds: task.dependentTaskIds,
    blockingPrerequisites: task.blockingPrerequisites,
    activeClaim: task.activeClaim ? claimResult(task.activeClaim) : null,
    isClaimable: task.isClaimable,
    updatedAt: task.updatedAt.toISOString(),
  };
}

function claimResult(claim: TaskClaim): JsonObject {
  return {
    claimId: claim.id,
    taskId: claim.taskId,
    agentId: claim.agentId,
    claimedAt: claim.claimedAt.toISOString(),
    expiresAt: claim.expiresAt.toISOString(),
    lastHeartbeatAt: claim.lastHeartbeatAt.toISOString(),
    releasedAt: claim.releasedAt?.toISOString() ?? null,
  };
}

function contextResult(context: ProjectContext): JsonObject {
  return {
    projectId: context.projectId,
    overviewMarkdown: context.overviewMarkdown,
    agentInstructionsMarkdown: context.agentInstructionsMarkdown,
    repoPath: context.repoPath,
    defaultBranch: context.defaultBranch,
    packageManager: context.packageManager,
    installCommand: context.installCommand,
    testCommand: context.testCommand,
    buildCommand: context.buildCommand,
    lintCommand: context.lintCommand,
    codingConventionsMarkdown: context.codingConventionsMarkdown,
    updatedAt: context.updatedAt.toISOString(),
  };
}

function eventResult(event: TaskEvent): JsonObject {
  return {
    eventId: event.id,
  };
}

function titleFromToolName(name: string): string {
  return name
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}
