import {
  type Actor,
  type ArtifactKind,
  type DependencyStatus,
  type EventType,
  type Project,
  type ProjectContext,
  type Task,
  type TaskArtifact,
  type TaskClaim,
  type TaskDependency,
  type TaskEvent,
  type TaskStatus,
  type TaskVerification,
  type TaskWithRelations,
} from './domain.ts';
import type {
  CreateProjectInput,
  CreateTaskInput,
  ListTasksInput,
  LocalAgentKanbanService,
  SplitTaskInput,
  UpdateTaskInput,
} from './services.ts';
import {
  createTaskBaseSchema,
  invariant,
  nonEmptyTrimmedString,
  projectContextInputSchema,
  replacementTaskSchema,
  taskStatusSchema,
  updateTaskBaseSchema,
  verificationEvidenceSchema,
} from './validation.ts';

type SequenceName = 'project' | 'task' | 'dependency' | 'claim' | 'event' | 'artifact' | 'verification';

/**
 * Project context is created alongside every project so agents can always call
 * getProjectContext immediately after createProject. Empty fields are meaningful:
 * they say "no instruction has been provided yet" without forcing adapters to
 * special-case missing records.
 */
const defaultContext = (projectId: string, now: Date): ProjectContext => ({
  projectId,
  overviewMarkdown: '',
  agentInstructionsMarkdown: '',
  repoPath: null,
  defaultBranch: null,
  packageManager: null,
  installCommand: null,
  testCommand: null,
  buildCommand: null,
  lintCommand: null,
  codingConventionsMarkdown: '',
  updatedAt: now,
});

/**
 * InMemoryKanbanService is the executable Phase 1 specification.
 *
 * It is not the final persistence layer. Its job is to make the domain model and
 * workflow rules concrete before SQLite exists. Phase 2 repositories should
 * preserve the behavior tested against this service while replacing the maps
 * with durable storage and transactions.
 */
export class InMemoryKanbanService implements LocalAgentKanbanService {
  /**
   * Each map mirrors a future table or repository collection. Keeping them split
   * instead of nesting everything under tasks makes accidental denormalization
   * visible during Phase 1.
   */
  private readonly projects = new Map<string, Project>();
  private readonly contexts = new Map<string, ProjectContext>();
  private readonly tasks = new Map<string, Task>();
  private readonly dependencies = new Map<string, TaskDependency>();
  private readonly claims = new Map<string, TaskClaim>();
  private readonly events: TaskEvent[] = [];
  private readonly artifacts = new Map<string, TaskArtifact>();
  private readonly verifications = new Map<string, TaskVerification>();
  private readonly sequences = new Map<SequenceName, number>();

  listProjects(): Project[] {
    // Return a snapshot array so callers cannot mutate the map directly.
    return [...this.projects.values()];
  }

  createProject(input: CreateProjectInput): Project {
    // The service validates input even though MCP schemas also validate it.
    // That keeps this method safe for HTTP and tests, not just MCP callers.
    const name = nonEmptyTrimmedString.max(120).parse(input.name);
    const now = new Date();
    const project: Project = {
      id: this.nextId('project'),
      name,
      description: input.description?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    };

    this.projects.set(project.id, project);
    this.contexts.set(project.id, defaultContext(project.id, now));
    // Project creation is a significant mutation, so it writes immutable history
    // immediately. Future database implementations must make this transactional.
    this.writeEvent(input.actor, project.id, null, 'project.created', `Project created: ${project.name}`, {});
    return project;
  }

  getProjectContext(projectId: string): ProjectContext {
    this.requireProject(projectId);
    // The fallback protects older in-memory test fixtures; normal project
    // creation eagerly inserts the context record.
    return this.contexts.get(projectId) ?? defaultContext(projectId, new Date());
  }

  updateProjectContext(
    actor: Actor,
    projectId: string,
    context: Partial<Omit<ProjectContext, 'projectId' | 'updatedAt'>>,
  ): ProjectContext {
    this.requireProject(projectId);
    const existing = this.getProjectContext(projectId);
    // partial() lets callers update one context field at a time while still
    // validating field-level shape and nullability.
    const parsed = projectContextInputSchema.partial().parse(context);
    const updated = {
      ...existing,
      ...parsed,
      projectId,
      updatedAt: new Date(),
    };
    this.contexts.set(projectId, updated);
    this.writeEvent(actor, projectId, null, 'project.context_updated', 'Project context updated', {
      fields: Object.keys(parsed),
    });
    return updated;
  }

  listTasks(input: ListTasksInput = {}): TaskWithRelations[] {
    // listTasks returns a read model with derived dependency and claim facts.
    // Adapters should not have to recalculate claimability on their own.
    return [...this.tasks.values()]
      .filter((task) => !input.projectId || task.projectId === input.projectId)
      .filter((task) => !input.status || task.status === input.status)
      .map((task) => this.withRelations(task, input.now))
      .filter((task) => !input.claimableOnly || task.isClaimable);
  }

  createTask(input: CreateTaskInput): TaskWithRelations {
    const parsed = createTaskBaseSchema.parse(input);
    this.requireProject(parsed.projectId);

    const now = new Date();
    const task: Task = {
      id: this.nextId('task'),
      projectId: parsed.projectId,
      title: parsed.title,
      description: parsed.description,
      acceptanceCriteria: parsed.acceptanceCriteria,
      status: parsed.status,
      priority: parsed.priority,
      labels: [...new Set(parsed.labels)],
      createdBy: input.actor,
      // Human-created tasks are considered already groomed. Agent-created tasks
      // are trusted to exist, but flagged for later human review by default.
      needsGrooming: parsed.needsGrooming ?? input.actor.type === 'agent',
      dependencyStatus: 'unblocked',
      sourceTaskId: null,
      splitReason: null,
      completedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);
    // Dependencies are created through the same helper used by dependency
    // updates so creation and later rewiring share DAG validation.
    this.replaceDependencies(input.actor, task.id, parsed.prerequisiteTaskIds);
    this.writeEvent(input.actor, task.projectId, task.id, 'task.created', `Task created: ${task.title}`, {});
    return this.withRelations(task);
  }

  updateTask(actor: Actor, taskId: string, input: UpdateTaskInput): TaskWithRelations {
    const current = this.requireTask(taskId);
    const parsed = updateTaskBaseSchema.parse(input);
    const updated = this.touchTask(taskId, {
      ...parsed,
      labels: parsed.labels ? [...new Set(parsed.labels)] : current.labels,
      acceptanceCriteria: parsed.acceptanceCriteria ?? current.acceptanceCriteria,
    });
    this.writeEvent(actor, updated.projectId, taskId, 'task.updated', `Task updated: ${updated.title}`, {
      fields: Object.keys(parsed),
    });
    return this.withRelations(updated);
  }

  updateTaskDependencies(actor: Actor, taskId: string, prerequisiteTaskIds: string[]): TaskWithRelations {
    this.requireTask(taskId);
    this.replaceDependencies(actor, taskId, prerequisiteTaskIds);
    const updated = this.touchTask(taskId, { dependencyStatus: this.deriveDependencyStatus(taskId) });
    return this.withRelations(updated);
  }

  splitTask(input: SplitTaskInput): { archivedTask: Task; replacementTasks: TaskWithRelations[] } {
    const original = this.requireTask(input.taskId);
    const reason = nonEmptyTrimmedString.parse(input.reason);
    invariant(input.replacements.length >= 2, 'split_requires_replacements', 'Splitting a task requires at least two replacements.');

    const originalPrerequisites = this.prerequisiteIds(original.id);
    const originalDependents = this.dependentIds(original.id);
    const hasDependencyEdges = originalPrerequisites.length > 0 || originalDependents.length > 0;
    // Splitting a connected task can change execution order for multiple tasks.
    // Requiring explicit dependencyHandling makes agents acknowledge that rewrite
    // instead of silently dropping blockers or dependents.
    invariant(
      !hasDependencyEdges || input.dependencyHandling !== undefined,
      'split_requires_dependency_handling',
      'Splitting a task with prerequisites or dependents requires dependency handling instructions.',
    );

    // Replacement tasks are created as normal flat tasks, not as children. The
    // traceability link is sourceTaskId plus splitReason, which lets the board
    // remain a simple flat Kanban.
    const replacementTasks = input.replacements.map((replacement) => {
      const parsed = replacementTaskSchema.parse(replacement);
      const now = new Date();
      const task: Task = {
        id: this.nextId('task'),
        projectId: original.projectId,
        title: parsed.title,
        description: parsed.description,
        acceptanceCriteria: parsed.acceptanceCriteria,
        status: parsed.status,
        priority: parsed.priority,
        labels: [...new Set(parsed.labels)],
        createdBy: input.actor,
        // Replacement tasks from an accepted split are considered groomed because
        // the split workflow itself is the review/acceptance point.
        needsGrooming: false,
        dependencyStatus: 'unblocked',
        sourceTaskId: original.id,
        splitReason: reason,
        completedAt: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.tasks.set(task.id, task);
      return { task, prerequisiteTaskIds: parsed.prerequisiteTaskIds };
    });

    const inheritOriginalPrerequisites = input.dependencyHandling?.moveOriginalPrerequisitesToReplacements ?? true;
    for (const replacement of replacementTasks) {
      // By default, replacements keep the original prerequisites so they cannot
      // become claimable before the original task would have been claimable.
      const prerequisiteTaskIds = [
        ...(inheritOriginalPrerequisites ? originalPrerequisites : []),
        ...(replacement.prerequisiteTaskIds ?? []),
      ];
      this.replaceDependencies(input.actor, replacement.task.id, prerequisiteTaskIds);
      this.writeEvent(input.actor, original.projectId, replacement.task.id, 'task.created', `Replacement task created: ${replacement.task.title}`, {
        sourceTaskId: original.id,
      });
    }

    const dependentTargets = input.dependencyHandling?.moveOriginalDependentsToReplacementIds ?? replacementTasks.map(({ task }) => task.id);
    for (const dependentId of originalDependents) {
      // Any task that depended on the original now depends on replacement tasks.
      // This preserves ordering while removing the archived original from active
      // board flow.
      const existing = this.prerequisiteIds(dependentId).filter((id) => id !== original.id);
      this.replaceDependencies(input.actor, dependentId, [...existing, ...dependentTargets]);
      this.writeEvent(input.actor, original.projectId, dependentId, 'task.dependency_rewired', 'Dependency rewired after task split', {
        fromTaskId: original.id,
        toTaskIds: dependentTargets,
      });
    }

    // The original leaves the active board after a successful split. It remains
    // queryable as history and traceability, but should not be worked directly.
    this.removeDependenciesForTask(original.id);
    const archivedTask = this.touchTask(original.id, {
      status: 'archived',
      archivedAt: new Date(),
      dependencyStatus: 'unblocked',
    });
    this.writeEvent(input.actor, original.projectId, original.id, 'task.split', `Task split: ${reason}`, {
      replacementTaskIds: replacementTasks.map(({ task }) => task.id),
    });
    this.writeEvent(input.actor, original.projectId, original.id, 'task.archived', 'Original task archived after split', {});

    return {
      archivedTask,
      replacementTasks: replacementTasks.map(({ task }) => this.withRelations(this.requireTask(task.id))),
    };
  }

  claimTask(agentId: string, taskId: string, leaseSeconds = 1800, now = new Date()): TaskClaim {
    const task = this.requireTask(taskId);
    const taskWithRelations = this.withRelations(task, now);
    // Claimability is derived in one place: ready status, no active unexpired
    // claim, and completed prerequisites. This prevents adapters from accepting
    // work out of order.
    invariant(taskWithRelations.isClaimable, 'task_not_claimable', 'Task is not claimable.');

    const claim: TaskClaim = {
      id: this.nextId('claim'),
      taskId,
      agentId: nonEmptyTrimmedString.parse(agentId),
      claimedAt: now,
      expiresAt: this.addSeconds(now, leaseSeconds),
      lastHeartbeatAt: now,
      releasedAt: null,
    };

    this.claims.set(claim.id, claim);
    this.writeEvent({ type: 'agent', id: claim.agentId }, task.projectId, task.id, 'task.claimed', `Task claimed by ${claim.agentId}`, {
      claimId: claim.id,
      expiresAt: claim.expiresAt.toISOString(),
    });
    return claim;
  }

  listClaims(input: { projectId?: string; taskId?: string; state?: 'active' | 'stale' | 'released' | 'all'; now?: Date } = {}): TaskClaim[] {
    const now = input.now ?? new Date();
    return [...this.claims.values()]
      .filter((claim) => !input.taskId || claim.taskId === input.taskId)
      .filter((claim) => {
        if (!input.projectId) {
          return true;
        }
        return this.requireTask(claim.taskId).projectId === input.projectId;
      })
      .filter((claim) => {
        const state = input.state ?? 'all';
        if (state === 'all') {
          return true;
        }
        if (state === 'released') {
          return claim.releasedAt !== null;
        }
        if (claim.releasedAt !== null) {
          return false;
        }
        return state === 'active' ? claim.expiresAt.getTime() > now.getTime() : claim.expiresAt.getTime() <= now.getTime();
      });
  }

  heartbeatClaim(agentId: string, claimId: string, leaseSeconds = 1800, now = new Date()): TaskClaim {
    const claim = this.requireClaim(claimId);
    // Only the owning agent can extend its lease. Human override is modeled as
    // releaseClaim, not heartbeat on behalf of an agent.
    invariant(claim.agentId === agentId, 'claim_agent_mismatch', 'Only the claiming agent can heartbeat this claim.');
    invariant(claim.releasedAt === null, 'claim_released', 'Released claims cannot be heartbeated.');
    const task = this.requireTask(claim.taskId);
    const updated = {
      ...claim,
      lastHeartbeatAt: now,
      expiresAt: this.addSeconds(now, leaseSeconds),
    };
    this.claims.set(claim.id, updated);
    this.writeEvent({ type: 'agent', id: agentId }, task.projectId, task.id, 'task.heartbeat', `Claim heartbeat from ${agentId}`, {
      claimId,
      expiresAt: updated.expiresAt.toISOString(),
    });
    return updated;
  }

  releaseClaim(actor: Actor, claimId: string, now = new Date()): TaskClaim {
    const claim = this.requireClaim(claimId);
    invariant(claim.releasedAt === null, 'claim_already_released', 'Claim is already released.');
    const task = this.requireTask(claim.taskId);
    // Releasing a claim does not change the task status. The product treats
    // assignment/lease and board state as separate facts.
    const updated = { ...claim, releasedAt: now };
    this.claims.set(claim.id, updated);
    this.writeEvent(actor, task.projectId, task.id, 'task.claim_released', `Claim released by ${actor.id}`, { claimId });
    return updated;
  }

  updateTaskStatus(actor: Actor, taskId: string, status: TaskStatus): TaskWithRelations {
    const parsedStatus = taskStatusSchema.parse(status);
    const current = this.requireTask(taskId);
    this.validateStatusTransition(current.status, parsedStatus);

    const now = new Date();
    // This path is for ordinary board moves. Completion itself must go through
    // completeTask so summary and verification evidence cannot be skipped.
    const updated = this.touchTask(taskId, {
      status: parsedStatus,
      completedAt: parsedStatus === 'done' ? (current.completedAt ?? now) : current.completedAt,
      archivedAt: parsedStatus === 'archived' ? (current.archivedAt ?? now) : current.archivedAt,
    });

    const eventType: EventType = parsedStatus === 'archived' ? 'task.archived' : 'task.status_changed';
    this.writeEvent(actor, updated.projectId, taskId, eventType, `Task status changed to ${parsedStatus}`, {
      fromStatus: current.status,
      toStatus: parsedStatus,
    });
    return this.withRelations(updated);
  }

  addTaskNote(actor: Actor, taskId: string, note: string): TaskEvent {
    const task = this.requireTask(taskId);
    return this.writeEvent(actor, task.projectId, task.id, 'task.note_added', nonEmptyTrimmedString.parse(note), {});
  }

  recordArtifact(
    actor: Actor,
    taskId: string,
    kind: ArtifactKind,
    value: string,
    metadata: Record<string, unknown> = {},
  ): TaskArtifact {
    const task = this.requireTask(taskId);
    // Artifacts are evidence of work, not state transitions by themselves. They
    // still write events so the activity feed can show what changed over time.
    const artifact: TaskArtifact = {
      id: this.nextId('artifact'),
      taskId,
      kind,
      value: nonEmptyTrimmedString.parse(value),
      metadata,
      createdBy: actor,
      createdAt: new Date(),
    };
    this.artifacts.set(artifact.id, artifact);
    this.writeEvent(actor, task.projectId, task.id, 'artifact.recorded', `Artifact recorded: ${kind}`, {
      artifactId: artifact.id,
    });
    return artifact;
  }

  listArtifacts(taskId: string): TaskArtifact[] {
    // HTTP task-detail routes need evidence rows, but they should still ask the
    // service for them instead of reading persistence collections directly.
    this.requireTask(taskId);
    return [...this.artifacts.values()].filter((artifact) => artifact.taskId === taskId);
  }

  recordVerification(actor: Actor, taskId: string, summary: string, evidence: string[]): TaskVerification {
    const task = this.requireTask(taskId);
    // Verification is recorded separately so completeTask can either accept new
    // evidence inline or rely on evidence recorded earlier in the workflow.
    const verification: TaskVerification = {
      id: this.nextId('verification'),
      taskId,
      summary: nonEmptyTrimmedString.parse(summary),
      evidence: verificationEvidenceSchema.parse(evidence),
      createdBy: actor,
      createdAt: new Date(),
    };
    this.verifications.set(verification.id, verification);
    this.writeEvent(actor, task.projectId, task.id, 'verification.recorded', 'Verification recorded', {
      verificationId: verification.id,
    });
    return verification;
  }

  listVerifications(taskId: string): TaskVerification[] {
    this.requireTask(taskId);
    return [...this.verifications.values()].filter((verification) => verification.taskId === taskId);
  }

  requestReview(actor: Actor, taskId: string, summary: string): TaskWithRelations {
    // A review request is both a note for humans and a status move. The explicit
    // review event makes it easy for the later review queue to find these tasks.
    this.addTaskNote(actor, taskId, `Review requested: ${summary}`);
    const task = this.updateTaskStatus(actor, taskId, 'review');
    this.writeEvent(actor, task.projectId, taskId, 'task.review_requested', nonEmptyTrimmedString.parse(summary), {});
    return task;
  }

  completeTask(actor: Actor, taskId: string, summary: string, evidence?: string[]): TaskWithRelations {
    const task = this.requireTask(taskId);
    const parsedSummary = nonEmptyTrimmedString.parse(summary);
    if (evidence !== undefined) {
      // Inline evidence is convenient for agents that finish and verify in one
      // tool call. Agents can also record verification first, then complete.
      this.recordVerification(actor, taskId, parsedSummary, evidence);
    }
    const verificationExists = [...this.verifications.values()].some((verification) => verification.taskId === taskId);
    invariant(verificationExists, 'completion_requires_verification', 'Completion requires verification evidence.');
    const completed = this.touchTask(taskId, {
      status: 'done',
      completedAt: new Date(),
    });
    this.writeEvent(actor, task.projectId, taskId, 'task.completed', parsedSummary, {});
    return this.withRelations(completed);
  }

  listEvents(projectId?: string): TaskEvent[] {
    // Event history is append-only from the caller's perspective. Phase 2 should
    // preserve this ordering with an indexed created_at/id query.
    return this.events.filter((event) => !projectId || event.projectId === projectId);
  }

  private replaceDependencies(actor: Actor, taskId: string, prerequisiteTaskIds: string[]): void {
    const task = this.requireTask(taskId);
    const uniqueIds = [...new Set(prerequisiteTaskIds)];
    // De-duplicate IDs before validation so callers can safely send repeated
    // dependencies without creating duplicate graph edges.
    invariant(!uniqueIds.includes(taskId), 'dependency_self_reference', 'A task cannot depend on itself.');

    for (const prerequisiteId of uniqueIds) {
      const prerequisite = this.requireTask(prerequisiteId);
      // Dependencies are same-project only. Cross-project ordering would require
      // additional context and UI affordances that are outside V1.
      invariant(
        prerequisite.projectId === task.projectId,
        'dependency_cross_project',
        'Task dependencies must stay within the same project.',
      );
    }

    const previousIds = this.prerequisiteIds(taskId);
    const previousDependencies = [...this.dependencies.entries()];
    // The in-memory implementation simulates a transaction by saving the prior
    // dependency set, applying the change, checking for cycles, and rolling back
    // if the new graph is invalid. SQLite should use a real transaction here.
    this.removeDependenciesForTask(taskId);
    for (const prerequisiteId of uniqueIds) {
      const dependency: TaskDependency = {
        id: this.nextId('dependency'),
        projectId: task.projectId,
        taskId,
        dependsOnTaskId: prerequisiteId,
        createdBy: actor,
        createdAt: new Date(),
      };
      this.dependencies.set(dependency.id, dependency);
    }

    if (this.hasDependencyCycle(task.projectId)) {
      // Roll back the attempted rewrite before throwing so callers do not observe
      // a partially-mutated graph after a validation failure.
      this.dependencies.clear();
      for (const [id, dependency] of previousDependencies) {
        this.dependencies.set(id, dependency);
      }
      invariant(false, 'dependency_cycle', 'Task dependencies must form a directed acyclic graph.');
    }

    for (const removedId of previousIds.filter((id) => !uniqueIds.includes(id))) {
      // Dependency events are emitted only after the graph is known to be valid.
      this.writeEvent(actor, task.projectId, taskId, 'task.dependency_removed', 'Task dependency removed', {
        dependsOnTaskId: removedId,
      });
    }
    for (const addedId of uniqueIds.filter((id) => !previousIds.includes(id))) {
      this.writeEvent(actor, task.projectId, taskId, 'task.dependency_added', 'Task dependency added', {
        dependsOnTaskId: addedId,
      });
    }
    this.touchTask(taskId, { dependencyStatus: this.deriveDependencyStatus(taskId) });
  }

  private removeDependenciesForTask(taskId: string): void {
    for (const [id, dependency] of this.dependencies) {
      if (dependency.taskId === taskId) {
        this.dependencies.delete(id);
      }
    }
  }

  private withRelations(task: Task, now = new Date()): TaskWithRelations {
    // This method builds the service read model. It intentionally centralizes
    // derived fields so claim_task, list_tasks, MCP, HTTP, and tests all agree.
    const blockingPrerequisites = this.prerequisiteIds(task.id)
      .map((id) => this.requireTask(id))
      .filter((prerequisite) => prerequisite.status !== 'done')
      .map(({ id, title, status }) => ({ id, title, status }));
    const dependencyStatus = this.deriveDependencyStatus(task.id);
    const activeClaim = this.activeClaimForTask(task.id, now);
    // Claimable means "an agent may safely start this now." Ready alone is not
    // enough because dependencies or an active lease can still block work.
    const isClaimable =
      task.status === 'ready' &&
      activeClaim === null &&
      dependencyStatus === 'unblocked' &&
      blockingPrerequisites.length === 0;

    return {
      ...task,
      dependencyStatus,
      prerequisiteTaskIds: this.prerequisiteIds(task.id),
      dependentTaskIds: this.dependentIds(task.id),
      blockingPrerequisites,
      activeClaim,
      isClaimable,
    };
  }

  private deriveDependencyStatus(taskId: string): DependencyStatus {
    const task = this.requireTask(taskId);
    // External blockers are manually asserted and should not be overwritten by
    // the derived internal dependency calculation.
    if (task.dependencyStatus === 'blocked_external') {
      return 'blocked_external';
    }
    return this.prerequisiteIds(taskId).some((id) => this.requireTask(id).status !== 'done') ? 'blocked_by_tasks' : 'unblocked';
  }

  private prerequisiteIds(taskId: string): string[] {
    return [...this.dependencies.values()]
      .filter((dependency) => dependency.taskId === taskId)
      .map((dependency) => dependency.dependsOnTaskId);
  }

  private dependentIds(taskId: string): string[] {
    return [...this.dependencies.values()]
      .filter((dependency) => dependency.dependsOnTaskId === taskId)
      .map((dependency) => dependency.taskId);
  }

  private activeClaimForTask(taskId: string, now: Date): TaskClaim | null {
    // Expired claims stay in history but no longer block a new claim. This is the
    // key difference between "active claim" and "all claims ever recorded."
    return (
      [...this.claims.values()].find(
        (claim) => claim.taskId === taskId && claim.releasedAt === null && claim.expiresAt.getTime() > now.getTime(),
      ) ?? null
    );
  }

  private hasDependencyCycle(projectId: string): boolean {
    // Standard depth-first search with a "visiting" set. Re-entering a visiting
    // node means the dependency graph contains a cycle.
    const dependencies = [...this.dependencies.values()].filter((dependency) => dependency.projectId === projectId);
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (taskId: string): boolean => {
      if (visiting.has(taskId)) {
        return true;
      }
      if (visited.has(taskId)) {
        return false;
      }
      visiting.add(taskId);
      for (const nextId of dependencies.filter((dependency) => dependency.taskId === taskId).map((dependency) => dependency.dependsOnTaskId)) {
        if (visit(nextId)) {
          return true;
        }
      }
      visiting.delete(taskId);
      visited.add(taskId);
      return false;
    };

    return [...this.tasks.values()].filter((task) => task.projectId === projectId).some((task) => visit(task.id));
  }

  private validateStatusTransition(fromStatus: TaskStatus, toStatus: TaskStatus): void {
    // Archived is terminal for active board workflows. Historical resurrection
    // would need a deliberate future workflow so dependencies can be checked.
    invariant(fromStatus !== 'archived' || toStatus === 'archived', 'archived_status_is_terminal', 'Archived tasks cannot return to the active board.');
    // Done is special because it requires evidence. Callers must use completeTask
    // instead of a generic status update.
    invariant(toStatus !== 'done', 'completion_requires_complete_task', 'Use completeTask so completion includes a summary and verification evidence.');
  }

  private touchTask(taskId: string, changes: Partial<Task>): Task {
    // touchTask is the single helper that updates task timestamps for mutations.
    const existing = this.requireTask(taskId);
    const updated = { ...existing, ...changes, updatedAt: new Date() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  private requireProject(projectId: string): Project {
    const project = this.projects.get(projectId);
    invariant(project !== undefined, 'project_not_found', `Project not found: ${projectId}`);
    return project;
  }

  private requireTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    invariant(task !== undefined, 'task_not_found', `Task not found: ${taskId}`);
    return task;
  }

  private requireClaim(claimId: string): TaskClaim {
    const claim = this.claims.get(claimId);
    invariant(claim !== undefined, 'claim_not_found', `Claim not found: ${claimId}`);
    return claim;
  }

  private writeEvent(
    actor: Actor,
    projectId: string,
    taskId: string | null,
    eventType: EventType,
    message: string,
    metadata: Record<string, unknown>,
  ): TaskEvent {
    // Event writing is intentionally tiny in memory, but it marks an important
    // transactional boundary for Phase 2: state changes and their events must
    // commit or roll back together.
    const event: TaskEvent = {
      id: this.nextId('event'),
      projectId,
      taskId,
      actor,
      eventType,
      message,
      metadata,
      createdAt: new Date(),
    };
    this.events.push(event);
    return event;
  }

  private addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1000);
  }

  private nextId(sequence: SequenceName): string {
    // Human-readable IDs make tests and example output easier to understand.
    // Durable storage can swap this for UUIDs or another strategy later.
    const next = (this.sequences.get(sequence) ?? 0) + 1;
    this.sequences.set(sequence, next);
    return `${sequence}_${next}`;
  }
}

export function createInMemoryKanbanService(): LocalAgentKanbanService {
  return new InMemoryKanbanService();
}
