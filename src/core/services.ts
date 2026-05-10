import type {
  Actor,
  ArtifactKind,
  Project,
  ProjectContext,
  ProjectLifecycleStatus,
  Task,
  TaskArtifact,
  TaskClaim,
  TaskEvent,
  TaskPriority,
  TaskStatus,
  TaskVerification,
  TaskWithRelations,
} from './domain.ts';

/**
 * Service interfaces define the boundary between adapters and domain behavior.
 *
 * Phase 1 uses an in-memory implementation to prove workflow rules. Phase 2 can
 * add SQLite-backed repositories under src/db while keeping MCP and HTTP callers
 * pointed at these same service methods.
 */

export type CreateProjectInput = {
  actor: Actor;
  name: string;
  repoPath: string;
  description?: string;
};

export type RegisterProjectInput = {
  actor: Actor;
  repoPath: string;
};

/**
 * CreateTaskInput models caller-provided task data. The service owns generated
 * fields, grooming defaults, dependency validation, and event writing.
 */
export type CreateTaskInput = {
  actor: Actor;
  projectId: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  prerequisiteTaskIds?: string[];
  needsGrooming?: boolean;
};

export type UpdateTaskInput = Partial<
  Pick<CreateTaskInput, 'title' | 'description' | 'acceptanceCriteria' | 'priority' | 'labels' | 'needsGrooming'>
>;

/**
 * now is injectable for claimability queries so tests and future deterministic
 * adapters can evaluate stale claims without waiting for real time to pass.
 */
export type ListTasksInput = {
  projectId?: string;
  status?: TaskStatus;
  query?: string;
  priority?: TaskPriority;
  label?: string;
  needsGrooming?: boolean;
  claimableOnly?: boolean;
  now?: Date;
};

export type ListClaimsInput = {
  projectId?: string;
  taskId?: string;
  state?: 'active' | 'stale' | 'released' | 'all';
  now?: Date;
};

/**
 * Replacement tasks belong to the original task's project and actor workflow.
 * They intentionally cannot set needsGrooming because accepted split output is
 * considered part of a controlled workflow.
 */
export type ReplacementTaskInput = Omit<CreateTaskInput, 'actor' | 'projectId' | 'needsGrooming'> & {
  prerequisiteTaskIds?: string[];
};

/**
 * Splitting keeps the board flat. Dependency handling is explicit because an
 * original task may have both prerequisites and dependents that must be rewired
 * when the original leaves active board flow.
 */
export type SplitTaskInput = {
  actor: Actor;
  taskId: string;
  reason: string;
  replacements: ReplacementTaskInput[];
  dependencyHandling?: {
    moveOriginalPrerequisitesToReplacements?: boolean;
    moveOriginalDependentsToReplacementIds?: string[];
  };
};

/**
 * ProjectWorkflow owns project records and the agent-facing context document.
 */
export type ProjectWorkflow = {
  listProjects(): Project[];
  createProject(input: CreateProjectInput): Project;
  registerProject(input: RegisterProjectInput): Project;
  unregisterProject(actor: Actor, projectId: string): { projectId: string; unregistered: true };
  updateProjectLifecycle(actor: Actor, projectId: string, lifecycleStatus: ProjectLifecycleStatus): Project;
  getProjectContext(projectId: string): ProjectContext;
  updateProjectContext(actor: Actor, projectId: string, context: Partial<Omit<ProjectContext, 'projectId' | 'updatedAt'>>): ProjectContext;
};

/**
 * TaskWorkflow owns board state and task-level mutations. Completion is a
 * separate method from updateTaskStatus because done requires summary and
 * verification evidence.
 */
export type TaskWorkflow = {
  listTasks(input?: ListTasksInput): TaskWithRelations[];
  createTask(input: CreateTaskInput): TaskWithRelations;
  updateTask(actor: Actor, taskId: string, input: UpdateTaskInput): TaskWithRelations;
  markTaskGroomed(actor: Actor, taskId: string): TaskWithRelations;
  updateTaskDependencies(actor: Actor, taskId: string, prerequisiteTaskIds: string[]): TaskWithRelations;
  splitTask(input: SplitTaskInput): { archivedTask: Task; replacementTasks: TaskWithRelations[] };
  updateTaskStatus(actor: Actor, taskId: string, status: TaskStatus): TaskWithRelations;
  addTaskNote(actor: Actor, taskId: string, note: string): TaskEvent;
  requestReview(actor: Actor, taskId: string, summary: string): TaskWithRelations;
  completeTask(actor: Actor, taskId: string, summary: string, evidence?: string[]): TaskWithRelations;
};

/**
 * ClaimWorkflow owns temporary leases. Claims remain separate from task status
 * so a task can stay in progress even if an agent lease expires.
 */
export type ClaimWorkflow = {
  listClaims(input?: ListClaimsInput): TaskClaim[];
  claimTask(agentId: string, taskId: string, leaseSeconds?: number, now?: Date): TaskClaim;
  heartbeatClaim(agentId: string, claimId: string, leaseSeconds?: number, now?: Date): TaskClaim;
  releaseClaim(actor: Actor, claimId: string, now?: Date): TaskClaim;
};

/**
 * ArtifactWorkflow captures work evidence and verification evidence. These are
 * separate records so the app can later show "what changed" and "how it was
 * checked" as different concepts.
 */
export type ArtifactWorkflow = {
  listArtifacts(taskId: string): TaskArtifact[];
  recordArtifact(actor: Actor, taskId: string, kind: ArtifactKind, value: string, metadata?: Record<string, unknown>): TaskArtifact;
  listVerifications(taskId: string): TaskVerification[];
  recordVerification(actor: Actor, taskId: string, summary: string, evidence: string[]): TaskVerification;
};

/**
 * EventWorkflow exposes immutable activity history for future activity feeds,
 * review views, and debugging of agent actions.
 */
export type EventWorkflow = {
  listEvents(projectId?: string): TaskEvent[];
};

/**
 * Single composed service type used by adapters. Keeping this type in core
 * prevents MCP and HTTP from accidentally growing separate workflow APIs.
 */
export type LocalAgentKanbanService = ProjectWorkflow & TaskWorkflow & ClaimWorkflow & ArtifactWorkflow & EventWorkflow;

export function taskMatchesListFilters(task: Task, input: ListTasksInput): boolean {
  return (
    (!input.projectId || task.projectId === input.projectId) &&
    (!input.status || task.status === input.status) &&
    (!input.priority || task.priority === input.priority) &&
    (input.needsGrooming === undefined || task.needsGrooming === input.needsGrooming) &&
    matchesLabelFilter(task, input.label) &&
    matchesTextQuery(task, input.query)
  );
}

function matchesLabelFilter(task: Task, label: string | undefined): boolean {
  const normalizedLabel = label?.trim().toLowerCase();
  if (!normalizedLabel) {
    return true;
  }
  return task.labels.some((taskLabel) => taskLabel.toLowerCase() === normalizedLabel);
}

function matchesTextQuery(task: Task, query: string | undefined): boolean {
  const normalizedQuery = query?.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return [task.title, task.description, ...task.acceptanceCriteria, ...task.labels].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}
