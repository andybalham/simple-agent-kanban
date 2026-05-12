/**
 * Domain constants and TypeScript types for Local Agent Kanban.
 *
 * This file deliberately contains no persistence, HTTP, MCP, or UI concerns.
 * It is the shared language that every boundary depends on. Keeping the
 * vocabulary here makes later SQLite repositories, MCP tools, HTTP routes, and
 * React views describe the same workflow without copying business rules.
 */

/**
 * Task status is the board lifecycle. Claims are intentionally not represented
 * here because a claim is a lease on work, not a board state.
 */
export const taskStatuses = [
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'review',
  'done',
  'archived',
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export const allowedTaskStatusTransitions = {
  backlog: ['ready', 'blocked', 'archived'],
  ready: ['in_progress', 'blocked', 'archived'],
  in_progress: ['ready', 'blocked', 'review', 'archived'],
  blocked: ['ready', 'in_progress', 'archived'],
  review: ['in_progress', 'archived'],
  done: ['archived'],
  archived: [],
} satisfies Record<TaskStatus, TaskStatus[]>;

/**
 * Most board queries should hide archived tasks unless the caller is explicitly
 * asking for history. Splitting uses archive/supersede behavior rather than a
 * parent-child hierarchy, so this helper keeps active board columns clear.
 */
export const activeTaskStatuses = taskStatuses.filter((status) => status !== 'archived');

/**
 * Priorities are intentionally named and finite. Labels remain free-form below,
 * but priority is a workflow signal that should sort consistently across MCP,
 * HTTP, and UI consumers.
 */
export const taskPriorities = ['low', 'medium', 'high', 'urgent'] as const;

export type TaskPriority = (typeof taskPriorities)[number];

/**
 * These are suggestions, not a taxonomy. V1 should never reject a task because
 * a useful label is not in this list.
 */
export const suggestedLabels = [
  'frontend',
  'backend',
  'db',
  'mcp',
  'docs',
  'test',
  'bug',
  'feature',
  'refactor',
] as const;

export type ActorType = 'agent' | 'human' | 'system';

/**
 * Actor identity travels with mutations and events. The app is local and trusted
 * in V1, so this is accountability and traceability rather than authorization.
 */
export type Actor = {
  type: ActorType;
  id: string;
};

export type DependencyStatus = 'unblocked' | 'blocked_by_tasks' | 'blocked_external';
export type ProjectLifecycleStatus = 'active' | 'completed';

/**
 * A project is one local body of work. Rich project instructions live in
 * ProjectContext so the basic project row can stay small and durable.
 */
export type Project = {
  id: string;
  name: string;
  description: string;
  repoPath: string;
  projectDbPath: string;
  lifecycleStatus: ProjectLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectContext = {
  projectId: string;
  overviewMarkdown: string;
  agentInstructionsMarkdown: string;
  repoPath: string | null;
  defaultBranch: string | null;
  packageManager: string | null;
  installCommand: string | null;
  testCommand: string | null;
  buildCommand: string | null;
  lintCommand: string | null;
  codingConventionsMarkdown: string;
  updatedAt: Date;
};

/**
 * Task is the flat unit of work shown on the board and operated on by agents.
 *
 * Key workflow fields:
 * - needsGrooming distinguishes trusted agent-created work from human-approved
 *   work without blocking agents from capturing useful tasks.
 * - sourceTaskId and splitReason preserve traceability after splitting while
 *   keeping the board flat.
 * - completedAt and archivedAt are separate because completion and archival are
 *   different product actions.
 */
export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  status: TaskStatus;
  priority: TaskPriority;
  labels: string[];
  createdBy: Actor;
  needsGrooming: boolean;
  dependencyStatus: DependencyStatus;
  sourceTaskId: string | null;
  splitReason: string | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Dependencies are stored as first-class relational edges. This keeps the future
 * SQLite/Postgres model honest and avoids hiding workflow ordering in task JSON.
 */
export type TaskDependency = {
  id: string;
  projectId: string;
  taskId: string;
  dependsOnTaskId: string;
  createdBy: Actor;
  createdAt: Date;
};

/**
 * TaskWithRelations is a read model produced by services. It keeps storage types
 * simple while still giving agents and future HTTP routes the derived facts they
 * need to choose work safely.
 */
export type TaskWithRelations = Task & {
  prerequisiteTaskIds: string[];
  dependentTaskIds: string[];
  blockingPrerequisites: Array<Pick<Task, 'id' | 'title' | 'status'>>;
  activeClaim: TaskClaim | null;
  isClaimable: boolean;
};

/**
 * A claim is a temporary lease. Expiration and release live here instead of on
 * Task so claim state can go stale without pretending task work changed status.
 */
export type TaskClaim = {
  id: string;
  taskId: string;
  agentId: string;
  claimedAt: Date;
  expiresAt: Date;
  lastHeartbeatAt: Date;
  releasedAt: Date | null;
};

/**
 * Event types are the immutable activity vocabulary. Mutating workflows should
 * write these events so the later UI can explain what happened and why.
 */
export const eventTypes = [
  'project.created',
  'project.context_updated',
  'task.created',
  'task.updated',
  'task.dependency_added',
  'task.dependency_removed',
  'task.dependency_rewired',
  'task.split',
  'task.claimed',
  'task.heartbeat',
  'task.claim_released',
  'task.status_changed',
  'task.note_added',
  'task.blocked',
  'task.review_requested',
  'task.completed',
  'task.archived',
  'artifact.recorded',
  'verification.recorded',
] as const;

export type EventType = (typeof eventTypes)[number];

/**
 * Events are append-only records. Metadata is intentionally an escape hatch for
 * extra context, not the source of truth for core task state.
 */
export type TaskEvent = {
  id: string;
  projectId: string;
  taskId: string | null;
  actor: Actor;
  eventType: EventType;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

/**
 * Artifacts capture evidence of work without overloading the task row. Examples
 * include changed files, branches, commits, test output, and links.
 */
export const artifactKinds = ['file', 'branch', 'commit', 'test', 'build', 'lint', 'link', 'note'] as const;

export type ArtifactKind = (typeof artifactKinds)[number];

/**
 * Artifact values are intentionally simple strings at the domain boundary. Later
 * layers can attach structured provider-specific fields in metadata.
 */
export type TaskArtifact = {
  id: string;
  taskId: string;
  kind: ArtifactKind;
  value: string;
  metadata: Record<string, unknown>;
  createdBy: Actor;
  createdAt: Date;
};

/**
 * Verification is separate from artifacts because completion requires evidence,
 * and the app should be able to distinguish "things produced" from "proof that
 * the work was checked."
 */
export type TaskVerification = {
  id: string;
  taskId: string;
  summary: string;
  evidence: string[];
  createdBy: Actor;
  createdAt: Date;
};
