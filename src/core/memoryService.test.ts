import { describe, expect, it } from 'vitest';

import { createInMemoryKanbanService, DomainValidationError, mcpToolSchemas } from './index.ts';
import type { Actor, LocalAgentKanbanService } from './index.ts';

const human: Actor = { type: 'human', id: 'human' };
const agent: Actor = { type: 'agent', id: 'agent-a' };
const reviewTool: Actor = { type: 'system', id: 'review-tool' };

// Most tests need a valid project before they can exercise task workflows. This
// helper keeps that setup boring while still using the public service method.
function createProject(service: LocalAgentKanbanService, repoPath = 'C:/tmp/local-agent-kanban-memory') {
  return service.createProject({ actor: human, name: 'Workspace', description: 'Local work', repoPath });
}

describe('MCP contract schemas', () => {
  it('documents the required Phase 1 tool contracts', () => {
    // This is a contract inventory test. It fails loudly if a required V1 MCP
    // tool is removed or renamed before adapters are updated.
    expect(Object.keys(mcpToolSchemas)).toEqual([
      'list_projects',
      'create_project',
      'register_project',
      'unregister_project',
      'get_project_context',
      'update_project_context',
      'list_tasks',
      'create_task',
      'update_task_dependencies',
      'mark_task_groomed',
      'split_task',
      'claim_task',
      'heartbeat_claim',
      'release_claim',
      'update_task_status',
      'add_task_note',
      'record_artifact',
      'record_verification',
      'request_review',
      'complete_task',
    ]);
  });
});

describe('in-memory domain service', () => {
  it('applies creator-specific grooming defaults', () => {
    const service = createInMemoryKanbanService();
    const project = createProject(service);

    const humanTask = service.createTask({ actor: human, projectId: project.id, title: 'Human task' });
    const agentTask = service.createTask({ actor: agent, projectId: project.id, title: 'Agent task' });

    // Human-created tasks are considered intentionally entered by the developer.
    expect(humanTask.needsGrooming).toBe(false);
    // Agent-created tasks are allowed, but marked for later human grooming.
    expect(agentTask.needsGrooming).toBe(true);
  });

  it('marks a task as groomed through a focused workflow event', () => {
    const service = createInMemoryKanbanService();
    const project = createProject(service);
    const task = service.createTask({ actor: agent, projectId: project.id, title: 'Needs review' });

    const groomed = service.markTaskGroomed(human, task.id);

    expect(groomed.needsGrooming).toBe(false);
    expect(service.listEvents(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          eventType: 'task.updated',
          metadata: { fields: ['needsGrooming'] },
        }),
      ]),
    );
  });

  it('filters tasks by text, priority, label, grooming state, and claimability', () => {
    const service = createInMemoryKanbanService();
    const project = createProject(service);
    const prerequisite = service.createTask({
      actor: human,
      projectId: project.id,
      title: 'Compile docs foundation',
      status: 'done',
      acceptanceCriteria: ['SQLite migration notes are reviewed'],
      labels: ['docs'],
    });
    const ready = service.createTask({
      actor: agent,
      projectId: project.id,
      title: 'Add SQLite task search',
      description: 'Search the local board through shared services',
      status: 'ready',
      priority: 'high',
      labels: ['db', 'feature'],
      prerequisiteTaskIds: [prerequisite.id],
    });
    service.createTask({
      actor: human,
      projectId: project.id,
      title: 'Polish board filters',
      status: 'ready',
      priority: 'medium',
      labels: ['frontend'],
    });

    expect(service.listTasks({ projectId: project.id, query: '  sqlite  ' }).map((task) => task.id)).toEqual([
      prerequisite.id,
      ready.id,
    ]);
    expect(service.listTasks({ projectId: project.id, query: 'LOCAL BOARD' }).map((task) => task.id)).toEqual([ready.id]);
    expect(service.listTasks({ projectId: project.id, query: 'feature' }).map((task) => task.id)).toEqual([ready.id]);
    expect(service.listTasks({ projectId: project.id, query: '' })).toHaveLength(3);
    expect(
      service
        .listTasks({ projectId: project.id, status: 'ready', priority: 'high', label: 'DB', needsGrooming: true, claimableOnly: true })
        .map((task) => task.id),
    ).toEqual([ready.id]);
  });

  it('rejects cross-project dependencies and dependency cycles', () => {
    const service = createInMemoryKanbanService();
    const projectA = createProject(service);
    const projectB = service.createProject({ actor: human, name: 'Other', repoPath: 'C:/tmp/local-agent-kanban-memory-other' });
    const taskA = service.createTask({ actor: human, projectId: projectA.id, title: 'A' });
    const taskB = service.createTask({ actor: human, projectId: projectB.id, title: 'B' });
    const taskC = service.createTask({ actor: human, projectId: projectA.id, title: 'C' });

    // Cross-project dependencies would make local board semantics ambiguous, so
    // Phase 1 rejects them outright.
    expect(() => service.updateTaskDependencies(human, taskA.id, [taskB.id])).toThrow(DomainValidationError);

    // C depends on A is valid, but adding A depends on C would create a cycle.
    service.updateTaskDependencies(human, taskC.id, [taskA.id]);
    expect(() => service.updateTaskDependencies(human, taskA.id, [taskC.id])).toThrow(DomainValidationError);
    // Failed dependency updates must roll back. Otherwise a rejected MCP call
    // could still corrupt the graph behind the scenes.
    expect(service.listTasks().find((task) => task.id === taskA.id)?.prerequisiteTaskIds).toEqual([]);
  });

  it('allows claiming only ready tasks with completed prerequisites and no active claim', () => {
    const service = createInMemoryKanbanService();
    const project = createProject(service);
    const prerequisite = service.createTask({ actor: human, projectId: project.id, title: 'Prereq', status: 'ready' });
    const blocked = service.createTask({
      actor: human,
      projectId: project.id,
      title: 'Blocked',
      status: 'ready',
      prerequisiteTaskIds: [prerequisite.id],
    });

    // A task can be in the Ready column but still blocked from agent claiming by
    // unfinished prerequisites.
    expect(blocked.dependencyStatus).toBe('blocked_by_tasks');
    expect(() => service.claimTask(agent.id, blocked.id)).toThrow(DomainValidationError);

    service.updateTaskStatus(agent, prerequisite.id, 'in_progress');
    service.recordVerification(agent, prerequisite.id, 'Verified', ['npm test passed']);
    service.requestReview(agent, prerequisite.id, 'Ready for prerequisite approval');
    service.completeTask(human, prerequisite.id, 'Approved');
    const claim = service.claimTask(agent.id, blocked.id, 60, new Date('2026-05-06T10:00:00.000Z'));

    expect(claim.taskId).toBe(blocked.id);
    // A second agent cannot steal an unexpired lease.
    expect(() => service.claimTask('agent-b', blocked.id, 60, new Date('2026-05-06T10:00:30.000Z'))).toThrow(
      DomainValidationError,
    );

    // After expiry, the stale claim no longer blocks a new agent from claiming.
    const reclaimed = service.claimTask('agent-b', blocked.id, 60, new Date('2026-05-06T10:01:01.000Z'));
    expect(reclaimed.agentId).toBe('agent-b');
  });

  it('heartbeats and releases claim leases without changing task status', () => {
    const service = createInMemoryKanbanService();
    const project = createProject(service);
    const task = service.createTask({ actor: human, projectId: project.id, title: 'Ready', status: 'ready' });
    const claim = service.claimTask(agent.id, task.id, 60, new Date('2026-05-06T10:00:00.000Z'));

    // Heartbeat extends the lease relative to the heartbeat time.
    const heartbeat = service.heartbeatClaim(agent.id, claim.id, 120, new Date('2026-05-06T10:00:30.000Z'));
    expect(heartbeat.expiresAt.toISOString()).toBe('2026-05-06T10:02:30.000Z');

    // Releasing a claim makes the task claimable again, but it does not move the
    // card between board columns.
    service.releaseClaim(human, claim.id, new Date('2026-05-06T10:00:40.000Z'));
    expect(service.listTasks({ claimableOnly: true }).map((listed) => listed.id)).toContain(task.id);
    expect(service.listTasks().find((listed) => listed.id === task.id)?.status).toBe('ready');
  });

  it('splits tasks into flat replacements and archives the original', () => {
    const service = createInMemoryKanbanService();
    const project = createProject(service);
    const prerequisite = service.createTask({ actor: human, projectId: project.id, title: 'Prereq', status: 'done' });
    const original = service.createTask({
      actor: agent,
      projectId: project.id,
      title: 'Large task',
      status: 'ready',
      prerequisiteTaskIds: [prerequisite.id],
    });

    const result = service.splitTask({
      actor: agent,
      taskId: original.id,
      reason: 'Too broad',
      dependencyHandling: { moveOriginalPrerequisitesToReplacements: true },
      replacements: [{ title: 'Part one' }, { title: 'Part two', priority: 'high' }],
    });

    // Splitting removes the original from active board flow by archiving it.
    expect(result.archivedTask.status).toBe('archived');
    // Replacement tasks are flat tasks with traceability, not child records.
    expect(result.replacementTasks).toHaveLength(2);
    expect(result.replacementTasks.every((task) => task.sourceTaskId === original.id)).toBe(true);
    // Accepted split output is considered groomed by the workflow itself.
    expect(result.replacementTasks.every((task) => task.needsGrooming === false)).toBe(true);
    // Original prerequisites are inherited so replacements do not become
    // claimable earlier than the original would have been.
    expect(result.replacementTasks.every((task) => task.prerequisiteTaskIds.includes(prerequisite.id))).toBe(true);
  });

  it('requires review and completion evidence while writing activity events', () => {
    const service = createInMemoryKanbanService();
    const project = createProject(service);
    const task = service.createTask({ actor: human, projectId: project.id, title: 'Finish me', status: 'in_progress' });

    // A summary alone is insufficient. Completion must have verification
    // evidence, either inline or recorded before completion.
    expect(() => service.completeTask(agent, task.id, 'Finished')).toThrow(DomainValidationError);

    // Artifacts and verification are both activity-producing evidence records.
    service.recordArtifact(agent, task.id, 'file', 'src/core/memoryService.ts');
    service.recordVerification(agent, task.id, 'Verified', ['npm test passed']);
    const review = service.requestReview(agent, task.id, 'Ready for review');
    expect(() => service.completeTask(agent, task.id, 'Finished')).toThrow(DomainValidationError);
    const done = service.completeTask(reviewTool, task.id, 'Finished');

    // The event stream proves the service is writing meaningful activity for
    // later UI surfaces such as review queues and timelines.
    expect(review.status).toBe('review');
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(service.listEvents(project.id).map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'task.created',
        'artifact.recorded',
        'verification.recorded',
        'task.review_requested',
        'task.completed',
      ]),
    );
  });

  it('treats archived status as terminal', () => {
    const service = createInMemoryKanbanService();
    const project = createProject(service);
    const task = service.createTask({ actor: human, projectId: project.id, title: 'Archive me' });

    service.updateTaskStatus(human, task.id, 'archived');

    // Archived tasks are historical records. Bringing them back would require a
    // separate future workflow that rechecks dependencies and claims.
    expect(() => service.updateTaskStatus(human, task.id, 'ready')).toThrow(DomainValidationError);
  });

  it('prevents status updates from bypassing completion evidence', () => {
    const service = createInMemoryKanbanService();
    const project = createProject(service);
    const task = service.createTask({ actor: human, projectId: project.id, title: 'Complete me' });

    // Generic status movement cannot be used to bypass completeTask's evidence
    // requirement.
    expect(() => service.updateTaskStatus(human, task.id, 'done')).toThrow(DomainValidationError);
  });

  it('rejects skipped status transitions', () => {
    const service = createInMemoryKanbanService();
    const project = createProject(service);
    const task = service.createTask({ actor: human, projectId: project.id, title: 'Do not skip', status: 'ready' });

    expect(() => service.updateTaskStatus(agent, task.id, 'review')).toThrow(DomainValidationError);

    const inProgress = service.updateTaskStatus(agent, task.id, 'in_progress');
    const review = service.requestReview(agent, task.id, 'Ready for review');

    expect(inProgress.status).toBe('in_progress');
    expect(review.status).toBe('review');
  });

  it('requires a human or review tool to approve review completion', () => {
    const service = createInMemoryKanbanService();
    const project = createProject(service);
    const task = service.createTask({ actor: human, projectId: project.id, title: 'Approve me', status: 'in_progress' });
    service.recordVerification(agent, task.id, 'Verified', ['npm test passed']);
    service.requestReview(agent, task.id, 'Ready for review');

    expect(() => service.completeTask(agent, task.id, 'Finished')).toThrow(DomainValidationError);
    expect(service.completeTask(human, task.id, 'Approved').status).toBe('done');
  });
});
