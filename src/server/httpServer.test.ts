import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createInMemoryKanbanService, type Actor, type LocalAgentKanbanService } from '../core/index.ts';
import { createHttpServer } from './httpServer.ts';

type JsonObject = Record<string, unknown>;

const human: Actor = { type: 'human', id: 'human-http' };
const agent: Actor = { type: 'agent', id: 'agent-http' };

let activeServer: Server | null = null;

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve, reject) => {
      activeServer?.close((error) => (error ? reject(error) : resolve()));
    });
    activeServer = null;
  }
});

describe('HTTP API workflow', () => {
  it('exposes Phase 4 board workflows through the shared service', async () => {
    const { service, baseUrl } = await startApi();

    const project = await api(baseUrl, 'POST', '/api/projects', {
      actor: human,
      name: 'HTTP Project',
      description: 'Created through the local API.',
    });
    const projectId = stringField(objectField(project, 'project'), 'id');

    await api(baseUrl, 'PUT', `/api/projects/${projectId}/context`, {
      actor: human,
      context: {
        overviewMarkdown: 'HTTP context',
        testCommand: 'npm run test',
      },
    });

    const created = await api(baseUrl, 'POST', `/api/projects/${projectId}/tasks`, {
      actor: agent,
      title: 'Finish through HTTP',
      status: 'ready',
      labels: ['api', 'test'],
    });
    const createdTask = objectField(created, 'task');
    const taskId = stringField(createdTask, 'id');
    expect(createdTask.needsGrooming).toBe(true);
    expect(createdTask.isClaimable).toBe(true);

    const claim = await api(baseUrl, 'POST', `/api/tasks/${taskId}/claims`, {
      agentId: agent.id,
      leaseSeconds: 120,
    });
    expect(stringField(objectField(claim, 'claim'), 'id')).toMatch(/^claim_/);

    await api(baseUrl, 'POST', `/api/tasks/${taskId}/artifacts`, {
      actor: agent,
      kind: 'file',
      value: 'src/server/httpServer.ts',
    });
    await api(baseUrl, 'POST', `/api/tasks/${taskId}/verifications`, {
      actor: agent,
      summary: 'HTTP route test',
      evidence: ['Vitest HTTP workflow passed'],
    });

    const completed = await api(baseUrl, 'POST', `/api/tasks/${taskId}/complete`, {
      actor: agent,
      summary: 'Finished through HTTP',
    });
    expect(objectField(completed, 'task').status).toBe('done');

    const detail = await api(baseUrl, 'GET', `/api/tasks/${taskId}`);
    expect(detail.artifacts).toHaveLength(1);
    expect(detail.verifications).toHaveLength(1);

    const board = await api(baseUrl, 'GET', `/api/projects/${projectId}/tasks`);
    const boardTasks = arrayField(board, 'tasks') as JsonObject[];
    expect(boardTasks.find((task) => task.id === taskId)?.status).toBe('done');
    expect(service.listTasks({ projectId }).find((task) => task.id === taskId)?.status).toBe('done');
  });

  it('keeps HTTP status moves on the same completion and event rules as MCP', async () => {
    const { baseUrl } = await startApi();
    const project = await api(baseUrl, 'POST', '/api/projects', { actor: human, name: 'Rules Project' });
    const projectId = stringField(objectField(project, 'project'), 'id');
    const created = await api(baseUrl, 'POST', `/api/projects/${projectId}/tasks`, {
      actor: human,
      title: 'Needs evidence',
      status: 'ready',
    });
    const taskId = stringField(objectField(created, 'task'), 'id');

    const rejected = await rawApi(baseUrl, 'PATCH', `/api/tasks/${taskId}/status`, {
      actor: human,
      status: 'done',
    });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe('completion_requires_complete_task');

    const claim = await api(baseUrl, 'POST', `/api/tasks/${taskId}/claims`, {
      agentId: agent.id,
      leaseSeconds: 120,
    });
    await api(baseUrl, 'POST', `/api/claims/${stringField(objectField(claim, 'claim'), 'id')}/release`, { actor: human });

    const events = await api(baseUrl, 'GET', `/api/projects/${projectId}/events`);
    expect((arrayField(events, 'events') as JsonObject[]).map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['task.claimed', 'task.claim_released']),
    );
  });

  it('updates editable task fields through the shared service', async () => {
    const { service, baseUrl } = await startApi();
    const project = await api(baseUrl, 'POST', '/api/projects', { actor: human, name: 'Edit Project' });
    const projectId = stringField(objectField(project, 'project'), 'id');
    const created = await api(baseUrl, 'POST', `/api/projects/${projectId}/tasks`, {
      actor: human,
      title: 'Draft task',
      status: 'ready',
    });
    const taskId = stringField(objectField(created, 'task'), 'id');

    const updated = await api(baseUrl, 'PATCH', `/api/tasks/${taskId}`, {
      actor: human,
      task: {
        title: 'Edited task',
        priority: 'high',
        labels: ['frontend', 'ui'],
        acceptanceCriteria: ['Edits persist'],
      },
    });

    const updatedTask = objectField(updated, 'task');
    expect(updatedTask.title).toBe('Edited task');
    expect(updatedTask.priority).toBe('high');
    expect(updatedTask.labels).toEqual(['frontend', 'ui']);
    expect(service.listTasks({ projectId }).find((task) => task.id === taskId)?.title).toBe('Edited task');

    const events = await api(baseUrl, 'GET', `/api/projects/${projectId}/events`);
    expect((arrayField(events, 'events') as JsonObject[]).map((event) => event.eventType)).toContain('task.updated');
  });
});

async function startApi(): Promise<{ service: LocalAgentKanbanService; baseUrl: string }> {
  const service = createInMemoryKanbanService();
  const server = createHttpServer(service);
  activeServer = server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { service, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function api(baseUrl: string, method: string, path: string, body?: unknown): Promise<JsonObject> {
  const response = await rawApi(baseUrl, method, path, body);
  const json = (await response.json()) as JsonObject;
  if (!response.ok) {
    throw new Error(JSON.stringify(json));
  }
  return json;
}

async function rawApi(baseUrl: string, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function objectField(source: JsonObject, key: string): JsonObject {
  const value = source[key];
  expect(value !== null && typeof value === 'object' && !Array.isArray(value)).toBe(true);
  return value as JsonObject;
}

function arrayField(source: JsonObject, key: string): unknown[] {
  const value = source[key];
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

function stringField(source: JsonObject, key: string): string {
  const value = source[key];
  expect(typeof value).toBe('string');
  return value as string;
}
