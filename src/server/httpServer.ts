import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ZodError, z } from 'zod';

import {
  actorSchema,
  createPingResponse,
  createTaskBaseSchema,
  DomainValidationError,
  idSchema,
  mcpToolSchemas,
  projectContextInputSchema,
  projectLifecycleStatusSchema,
  taskStatusSchema,
  updateTaskBaseSchema,
  type LocalAgentKanbanService,
  type TaskWithRelations,
} from '../core/index.ts';

const responseHeaders = {
  'content-type': 'application/json; charset=utf-8',
  // The Vite UI runs on 5173 while the local API runs on 4000, so CORS is part
  // of the local developer contract rather than an afterthought in the UI.
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const claimStateSchema = z.enum(['active', 'stale', 'released', 'all']).default('all');

const createClaimSchema = z.object({
  agentId: idSchema,
  leaseSeconds: z.number().int().positive().default(1800),
});

const heartbeatClaimSchema = createClaimSchema.pick({ agentId: true, leaseSeconds: true });

const releaseClaimSchema = z.object({ actor: actorSchema });

const statusUpdateSchema = z.object({
  actor: actorSchema,
  status: taskStatusSchema,
});

const lifecycleUpdateSchema = z.object({
  actor: actorSchema,
  lifecycleStatus: projectLifecycleStatusSchema,
});

/**
 * createHttpServer is the Phase 4 adapter boundary. It parses HTTP requests,
 * validates their shape, and delegates all workflow behavior to the shared
 * LocalAgentKanbanService. Route handlers should not contain Kanban business
 * rules; those belong in core/db services so MCP and HTTP stay in parity.
 */
export function createHttpServer(service: LocalAgentKanbanService) {
  return createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      sendJson(response, 204, null);
      return;
    }

    try {
      await routeRequest(service, request, response);
    } catch (error) {
      sendError(response, error);
    }
  });
}

async function routeRequest(service: LocalAgentKanbanService, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean);

  if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
    sendJson(response, 200, createPingResponse('http-api'));
    return;
  }

  if (parts[0] !== 'api') {
    notFound(request, response);
    return;
  }

  if (request.method === 'GET' && parts.length === 2 && parts[1] === 'projects') {
    sendJson(response, 200, { ok: true, projects: service.listProjects() });
    return;
  }

  if (request.method === 'POST' && parts.length === 2 && parts[1] === 'projects') {
    const input = mcpToolSchemas.create_project.input.parse(await readJson(request));
    const project = service.createProject(input);
    sendJson(response, 201, { ok: true, project });
    return;
  }

  if (request.method === 'POST' && parts.length === 3 && parts[1] === 'projects' && parts[2] === 'register') {
    const input = mcpToolSchemas.register_project.input.parse(await readJson(request));
    const project = service.registerProject(input);
    sendJson(response, 200, { ok: true, project });
    return;
  }

  if (parts[1] === 'projects' && parts[2]) {
    await routeProjectRequest(service, request, response, parts[2], parts.slice(3), url);
    return;
  }

  if (request.method === 'GET' && parts.length === 2 && parts[1] === 'tasks') {
    sendJson(response, 200, {
      ok: true,
      tasks: service.listTasks({
        projectId: optionalQuery(url, 'projectId'),
        status: parseOptionalStatus(url),
        claimableOnly: parseBooleanQuery(url, 'claimableOnly'),
      }),
    });
    return;
  }

  if (parts[1] === 'tasks' && parts[2]) {
    await routeTaskRequest(service, request, response, parts[2], parts.slice(3));
    return;
  }

  if (request.method === 'GET' && parts.length === 2 && parts[1] === 'events') {
    sendJson(response, 200, { ok: true, events: service.listEvents(optionalQuery(url, 'projectId')) });
    return;
  }

  if (parts[1] === 'claims' && parts[2]) {
    await routeClaimRequest(service, request, response, parts[2], parts.slice(3));
    return;
  }

  notFound(request, response);
}

async function routeProjectRequest(
  service: LocalAgentKanbanService,
  request: IncomingMessage,
  response: ServerResponse,
  projectId: string,
  rest: string[],
  url: URL,
): Promise<void> {
  if (request.method === 'GET' && rest.length === 1 && rest[0] === 'context') {
    sendJson(response, 200, { ok: true, context: service.getProjectContext(projectId) });
    return;
  }

  if (request.method === 'DELETE' && rest.length === 0) {
    const body = z.object({ actor: actorSchema }).parse(await readJson(request));
    const result = service.unregisterProject(body.actor, projectId);
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (request.method === 'PATCH' && rest.length === 1 && rest[0] === 'lifecycle') {
    const body = lifecycleUpdateSchema.parse(await readJson(request));
    const project = service.updateProjectLifecycle(body.actor, projectId, body.lifecycleStatus);
    sendJson(response, 200, { ok: true, project });
    return;
  }

  if (request.method === 'PUT' && rest.length === 1 && rest[0] === 'context') {
    const body = z.object({ actor: actorSchema, context: projectContextInputSchema.partial() }).parse(await readJson(request));
    const context = service.updateProjectContext(body.actor, projectId, body.context);
    sendJson(response, 200, { ok: true, context });
    return;
  }

  if (request.method === 'GET' && rest.length === 1 && rest[0] === 'tasks') {
    sendJson(response, 200, {
      ok: true,
      tasks: service.listTasks({
        projectId,
        status: parseOptionalStatus(url),
        claimableOnly: parseBooleanQuery(url, 'claimableOnly'),
      }),
    });
    return;
  }

  if (request.method === 'POST' && rest.length === 1 && rest[0] === 'tasks') {
    const body = createTaskBaseSchema.omit({ projectId: true }).extend({ actor: actorSchema }).parse(await readJson(request));
    const task = service.createTask({ ...body, projectId });
    sendJson(response, 201, { ok: true, task });
    return;
  }

  if (request.method === 'GET' && rest.length === 1 && rest[0] === 'events') {
    sendJson(response, 200, { ok: true, events: service.listEvents(projectId) });
    return;
  }

  if (request.method === 'GET' && rest.length === 1 && rest[0] === 'claims') {
    const state = claimStateSchema.parse(url.searchParams.get('state') ?? undefined);
    sendJson(response, 200, { ok: true, claims: service.listClaims({ projectId, state }) });
    return;
  }

  notFound(request, response);
}

async function routeTaskRequest(
  service: LocalAgentKanbanService,
  request: IncomingMessage,
  response: ServerResponse,
  taskId: string,
  rest: string[],
): Promise<void> {
  if (request.method === 'GET' && rest.length === 0) {
    const task = findTask(service, taskId);
    sendJson(response, 200, {
      ok: true,
      task,
      artifacts: service.listArtifacts(taskId),
      verifications: service.listVerifications(taskId),
      events: service.listEvents(task.projectId).filter((event) => event.taskId === taskId),
    });
    return;
  }

  if (request.method === 'PATCH' && rest.length === 0) {
    const body = z.object({ actor: actorSchema, task: updateTaskBaseSchema }).parse(await readJson(request));
    const task = service.updateTask(body.actor, taskId, body.task);
    sendJson(response, 200, { ok: true, task });
    return;
  }

  if (request.method === 'PATCH' && rest.length === 1 && rest[0] === 'dependencies') {
    const body = mcpToolSchemas.update_task_dependencies.input.omit({ taskId: true }).parse(await readJson(request));
    const task = service.updateTaskDependencies(body.actor, taskId, body.prerequisiteTaskIds);
    sendJson(response, 200, { ok: true, task });
    return;
  }

  if (request.method === 'POST' && rest.length === 1 && rest[0] === 'split') {
    const body = mcpToolSchemas.split_task.input.omit({ taskId: true }).parse(await readJson(request));
    const split = service.splitTask({ ...body, taskId });
    sendJson(response, 200, { ok: true, split });
    return;
  }

  if (request.method === 'PATCH' && rest.length === 1 && rest[0] === 'status') {
    const body = statusUpdateSchema.parse(await readJson(request));
    const task = service.updateTaskStatus(body.actor, taskId, body.status);
    sendJson(response, 200, { ok: true, task });
    return;
  }

  if (request.method === 'POST' && rest.length === 1 && rest[0] === 'notes') {
    const body = mcpToolSchemas.add_task_note.input.omit({ taskId: true }).parse(await readJson(request));
    const event = service.addTaskNote(body.actor, taskId, body.note);
    sendJson(response, 201, { ok: true, event });
    return;
  }

  if (request.method === 'GET' && rest.length === 1 && rest[0] === 'claims') {
    sendJson(response, 200, { ok: true, claims: service.listClaims({ taskId }) });
    return;
  }

  if (request.method === 'POST' && rest.length === 1 && rest[0] === 'claims') {
    const body = createClaimSchema.parse(await readJson(request));
    const claim = service.claimTask(body.agentId, taskId, body.leaseSeconds);
    sendJson(response, 201, { ok: true, claim });
    return;
  }

  if (request.method === 'GET' && rest.length === 1 && rest[0] === 'artifacts') {
    sendJson(response, 200, { ok: true, artifacts: service.listArtifacts(taskId) });
    return;
  }

  if (request.method === 'POST' && rest.length === 1 && rest[0] === 'artifacts') {
    const body = mcpToolSchemas.record_artifact.input.omit({ taskId: true }).parse(await readJson(request));
    const artifact = service.recordArtifact(body.actor, taskId, body.kind, body.value, body.metadata);
    sendJson(response, 201, { ok: true, artifact });
    return;
  }

  if (request.method === 'GET' && rest.length === 1 && rest[0] === 'verifications') {
    sendJson(response, 200, { ok: true, verifications: service.listVerifications(taskId) });
    return;
  }

  if (request.method === 'POST' && rest.length === 1 && rest[0] === 'verifications') {
    const body = mcpToolSchemas.record_verification.input.omit({ taskId: true }).parse(await readJson(request));
    const verification = service.recordVerification(body.actor, taskId, body.summary, body.evidence);
    sendJson(response, 201, { ok: true, verification });
    return;
  }

  if (request.method === 'POST' && rest.length === 1 && rest[0] === 'review') {
    const body = mcpToolSchemas.request_review.input.omit({ taskId: true }).parse(await readJson(request));
    const task = service.requestReview(body.actor, taskId, body.summary);
    sendJson(response, 200, { ok: true, task });
    return;
  }

  if (request.method === 'POST' && rest.length === 1 && rest[0] === 'complete') {
    const body = mcpToolSchemas.complete_task.input.omit({ taskId: true }).parse(await readJson(request));
    const task = service.completeTask(body.actor, taskId, body.summary, body.evidence);
    sendJson(response, 200, { ok: true, task });
    return;
  }

  notFound(request, response);
}

async function routeClaimRequest(
  service: LocalAgentKanbanService,
  request: IncomingMessage,
  response: ServerResponse,
  claimId: string,
  rest: string[],
): Promise<void> {
  if (request.method === 'POST' && rest.length === 1 && rest[0] === 'heartbeat') {
    const body = heartbeatClaimSchema.parse(await readJson(request));
    const claim = service.heartbeatClaim(body.agentId, claimId, body.leaseSeconds);
    sendJson(response, 200, { ok: true, claim });
    return;
  }

  if (request.method === 'POST' && rest.length === 1 && rest[0] === 'release') {
    const body = releaseClaimSchema.parse(await readJson(request));
    const claim = service.releaseClaim(body.actor, claimId);
    sendJson(response, 200, { ok: true, claim });
    return;
  }

  notFound(request, response);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new DomainValidationError('invalid_json', 'Request body must be valid JSON.');
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, responseHeaders);
  response.end(body === null ? '' : JSON.stringify(serialize(body)));
}

function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof DomainValidationError) {
    const statusCode = error.code.endsWith('_not_found') ? 404 : 400;
    sendJson(response, statusCode, {
      ok: false,
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof ZodError) {
    sendJson(response, 400, {
      ok: false,
      error: {
        code: 'invalid_input',
        message: 'Request input failed validation.',
        details: error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`),
      },
    });
    return;
  }

  sendJson(response, 500, {
    ok: false,
    error: {
      code: 'internal_error',
      message: error instanceof Error ? error.message : String(error),
      details: [],
    },
  });
}

function notFound(request: IncomingMessage, response: ServerResponse): void {
  sendJson(response, 404, {
    ok: false,
    error: {
      code: 'not_found',
      message: `Route not found: ${request.method ?? 'GET'} ${request.url ?? '/'}`,
      details: [],
    },
  });
}

function findTask(service: LocalAgentKanbanService, taskId: string): TaskWithRelations {
  const task = service.listTasks().find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new DomainValidationError('task_not_found', `Task not found: ${taskId}`);
  }
  return task;
}

function parseOptionalStatus(url: URL) {
  const status = url.searchParams.get('status');
  return status ? taskStatusSchema.parse(status) : undefined;
}

function parseBooleanQuery(url: URL, key: string): boolean {
  return url.searchParams.get(key) === 'true';
}

function optionalQuery(url: URL, key: string): string | undefined {
  return url.searchParams.get(key) ?? undefined;
}

function serialize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serialize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serialize(nested)]));
  }
  return value;
}
