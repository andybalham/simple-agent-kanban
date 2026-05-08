import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DomainValidationError, type Actor, type LocalAgentKanbanService } from '../core/index.ts';
import { createSqliteKanbanService, type SqliteKanbanService } from './sqliteService.ts';

const human: Actor = { type: 'human', id: 'human' };
const agent: Actor = { type: 'agent', id: 'agent-a' };

function createProject(service: LocalAgentKanbanService) {
  return service.createProject({ actor: human, name: 'SQLite Workspace', description: 'Durable work' });
}

describe('SQLite-backed domain service', () => {
  it('persists projects, context, tasks, claims, artifacts, verification, and events across service instances', () => {
    // Use an on-disk temporary database for this test instead of :memory: so the
    // second service instance proves data was actually flushed to SQLite.
    const directory = mkdtempSync(join(tmpdir(), 'local-agent-kanban-'));
    const filename = join(directory, 'test.sqlite');
    let service: SqliteKanbanService | null = null;
    let reopened: SqliteKanbanService | null = null;

    try {
      service = createSqliteKanbanService(filename);
      const project = createProject(service);
      service.updateProjectContext(human, project.id, {
        overviewMarkdown: 'Durable overview',
        testCommand: 'npm run test',
      });
      const task = service.createTask({
        actor: agent,
        projectId: project.id,
        title: 'Durable task',
        status: 'ready',
        labels: ['db', 'test'],
      });
      const claim = service.claimTask(agent.id, task.id, 60, new Date('2026-05-08T10:00:00.000Z'));
      service.recordArtifact(agent, task.id, 'file', 'src/db/sqliteService.ts');
      service.recordVerification(agent, task.id, 'Checked persistence', ['npm run test passed']);
      service.completeTask(agent, task.id, 'Finished persistence check');
      service.close();
      service = null;

      // Reopening with a fresh service instance simulates the local app or MCP
      // process restarting and reading durable workflow state back.
      reopened = createSqliteKanbanService(filename);
      expect(reopened.listProjects().map((listed) => listed.id)).toContain(project.id);
      expect(reopened.getProjectContext(project.id).overviewMarkdown).toBe('Durable overview');
      expect(reopened.listTasks({ projectId: project.id }).find((listed) => listed.id === task.id)?.status).toBe('done');
      expect(reopened.listEvents(project.id).map((event) => event.eventType)).toEqual(
        expect.arrayContaining(['task.claimed', 'artifact.recorded', 'verification.recorded', 'task.completed']),
      );
      expect(claim.expiresAt.toISOString()).toBe('2026-05-08T10:01:00.000Z');
      reopened.close();
      reopened = null;
    } finally {
      service?.close();
      reopened?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back dependency rewrites and events when DAG validation fails', () => {
    const service = createSqliteKanbanService(':memory:');
    const project = createProject(service);
    const first = service.createTask({ actor: human, projectId: project.id, title: 'First' });
    const second = service.createTask({ actor: human, projectId: project.id, title: 'Second', prerequisiteTaskIds: [first.id] });
    const eventCount = service.listEvents(project.id).length;

    // This attempted update would create First -> Second -> First. The service
    // should reject it and SQLite should roll back both graph edits and events.
    expect(() => service.updateTaskDependencies(human, first.id, [second.id])).toThrow(DomainValidationError);
    expect(service.listTasks().find((task) => task.id === first.id)?.prerequisiteTaskIds).toEqual([]);
    expect(service.listEvents(project.id)).toHaveLength(eventCount);
    service.close();
  });

  it('preserves Phase 1 claimability, split, and completion rules on SQLite', () => {
    // This mirrors the in-memory workflow tests at a higher level. The point is
    // not to duplicate every Phase 1 assertion, but to prove the durable service
    // still enforces the important shared contract MCP will depend on.
    const service = createSqliteKanbanService(':memory:');
    const project = createProject(service);
    const prerequisite = service.createTask({ actor: human, projectId: project.id, title: 'Prereq', status: 'ready' });
    const blocked = service.createTask({
      actor: human,
      projectId: project.id,
      title: 'Blocked',
      status: 'ready',
      prerequisiteTaskIds: [prerequisite.id],
    });

    expect(blocked.dependencyStatus).toBe('blocked_by_tasks');
    expect(() => service.claimTask(agent.id, blocked.id)).toThrow(DomainValidationError);

    service.completeTask(agent, prerequisite.id, 'Done', ['sqlite test passed']);
    const claim = service.claimTask(agent.id, blocked.id, 60, new Date('2026-05-08T10:00:00.000Z'));
    expect(() => service.claimTask('agent-b', blocked.id, 60, new Date('2026-05-08T10:00:30.000Z'))).toThrow(
      DomainValidationError,
    );
    service.releaseClaim(human, claim.id, new Date('2026-05-08T10:00:40.000Z'));

    const split = service.splitTask({
      actor: agent,
      taskId: blocked.id,
      reason: 'Too broad',
      dependencyHandling: { moveOriginalPrerequisitesToReplacements: true },
      replacements: [{ title: 'Part one' }, { title: 'Part two', priority: 'high' }],
    });

    expect(split.archivedTask.status).toBe('archived');
    expect(split.replacementTasks).toHaveLength(2);
    expect(split.replacementTasks.every((task) => task.needsGrooming === false)).toBe(true);
    expect(() => service.updateTaskStatus(human, split.replacementTasks[0].id, 'done')).toThrow(DomainValidationError);
    service.close();
  });
});
