import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type ToolOutput = Record<string, unknown>;

const actor = { type: 'agent', id: 'agent-smoke' } as const;

let activeClient: Client | null = null;

afterEach(async () => {
  await activeClient?.close();
  activeClient = null;
});

describe('MCP stdio workflow', () => {
  it('runs the Phase 3 agent workflow end to end through MCP only', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'local-agent-kanban-mcp-'));
    const databasePath = join(directory, 'mcp-smoke.sqlite');

    try {
      const { client } = await connectMcp(databasePath);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'create_project',
          'update_project_context',
          'create_task',
          'claim_task',
          'record_artifact',
          'record_verification',
          'complete_task',
        ]),
      );

      const project = await callTool(client, 'create_project', {
        actor,
        name: 'MCP Smoke Project',
        repoPath: join(directory, 'repo'),
        description: 'Created by the MCP smoke test.',
      });
      const projectId = stringField(project, 'projectId');

      await callTool(client, 'update_project_context', {
        actor,
        projectId,
        context: {
          overviewMarkdown: 'MCP smoke context',
          testCommand: 'npm run test',
        },
      });

      const task = await callTool(client, 'create_task', {
        actor,
        projectId,
        title: 'Complete through MCP',
        status: 'ready',
        labels: ['mcp', 'test'],
      });
      const taskId = stringField(task, 'taskId');
      expect(task.needsGrooming).toBe(true);
      expect(task.isClaimable).toBe(true);

      const claim = await callTool(client, 'claim_task', {
        agentId: actor.id,
        taskId,
        leaseSeconds: 120,
      });
      expect(stringField(claim, 'claimId')).toMatch(/^claim_/);

      const artifact = await callTool(client, 'record_artifact', {
        actor,
        taskId,
        kind: 'file',
        value: 'src/mcp/tools.ts',
      });
      expect(stringField(artifact, 'artifactId')).toMatch(/^artifact_/);

      const verification = await callTool(client, 'record_verification', {
        actor,
        taskId,
        summary: 'Smoke test verification',
        evidence: ['MCP stdio smoke path passed'],
      });
      expect(stringField(verification, 'verificationId')).toMatch(/^verification_/);

      const completed = await callTool(client, 'complete_task', {
        actor,
        taskId,
        summary: 'Finished through MCP',
      });
      expect(completed.status).toBe('done');
      expect(stringField(completed, 'completedAt')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await activeClient?.close();
      activeClient = null;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

async function connectMcp(databasePath: string): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/mcp/index.ts')],
    cwd: process.cwd(),
    env: {
      LOCAL_AGENT_KANBAN_REGISTRY_DB: databasePath,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'local-agent-kanban-test', version: '0.1.0' });
  await client.connect(transport);
  activeClient = client;
  return { client, transport };
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolOutput> {
  const result = await client.callTool({ name, arguments: args });
  if ('isError' in result && result.isError) {
    throw new Error(JSON.stringify(result.content));
  }
  if ('structuredContent' in result && result.structuredContent) {
    return result.structuredContent as ToolOutput;
  }
  throw new Error(`Tool ${name} did not return structured content.`);
}

function stringField(output: ToolOutput, field: string): string {
  const value = output[field];
  expect(typeof value).toBe('string');
  return value as string;
}
