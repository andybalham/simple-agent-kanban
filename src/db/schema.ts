import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { artifactKinds, eventTypes, taskPriorities, taskStatuses } from '../core/domain.ts';

export const projectRegistry = sqliteTable('project_registry', {
  projectId: text('project_id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  repoPath: text('repo_path').notNull(),
  projectDbPath: text('project_db_path').notNull(),
  lifecycleStatus: text('lifecycle_status', { enum: ['active', 'completed'] }).notNull().default('active'),
  registeredAt: integer('registered_at', { mode: 'timestamp_ms' }).notNull(),
  lastOpenedAt: integer('last_opened_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Drizzle schema files are the typed bridge between the domain model and SQL.
 *
 * Keep this file declarative: table names, columns, relationships, and indexes
 * belong here. Workflow rules such as "a task is claimable only when..." belong
 * in services, because MCP and HTTP callers must share those rules.
 */

/**
 * Many records need actor attribution. The columns are duplicated in SQL tables
 * rather than normalized into an actors table because V1 is a local trusted tool:
 * actor identity is audit context, not an authorization model.
 */
const actorColumns = {
  actorType: text('actor_type', { enum: ['agent', 'human', 'system'] }).notNull(),
  actorId: text('actor_id').notNull(),
} as const;

/**
 * Projects are intentionally small. Rich instructions and commands live in the
 * one-to-one project_contexts table so board queries do not pull large markdown
 * blobs unless an MCP tool or UI screen asks for context.
 */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  repoPath: text('repo_path').notNull().default(''),
  projectDbPath: text('project_db_path').notNull().default(''),
  lifecycleStatus: text('lifecycle_status', { enum: ['active', 'completed'] }).notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const projectContexts = sqliteTable('project_contexts', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  overviewMarkdown: text('overview_markdown').notNull().default(''),
  agentInstructionsMarkdown: text('agent_instructions_markdown').notNull().default(''),
  repoPath: text('repo_path'),
  defaultBranch: text('default_branch'),
  packageManager: text('package_manager'),
  installCommand: text('install_command'),
  testCommand: text('test_command'),
  buildCommand: text('build_command'),
  lintCommand: text('lint_command'),
  codingConventionsMarkdown: text('coding_conventions_markdown').notNull().default(''),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * SQLite stores arrays as JSON strings here because SQLite has no native array
 * type. These fields remain "escape hatches" around the relational model:
 * dependencies, claims, artifacts, verification, and events all have their own
 * tables instead of being buried in task metadata JSON.
 */
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  acceptanceCriteriaJson: text('acceptance_criteria_json').notNull().default('[]'),
  status: text('status', { enum: taskStatuses }).notNull(),
  priority: text('priority', { enum: taskPriorities }).notNull(),
  labelsJson: text('labels_json').notNull().default('[]'),
  createdByType: text('created_by_type', { enum: ['agent', 'human', 'system'] }).notNull(),
  createdById: text('created_by_id').notNull(),
  needsGrooming: integer('needs_grooming', { mode: 'boolean' }).notNull(),
  dependencyStatus: text('dependency_status', {
    enum: ['unblocked', 'blocked_by_tasks', 'blocked_external'],
  }).notNull(),
  sourceTaskId: text('source_task_id'),
  splitReason: text('split_reason'),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Dependencies are first-class edges in a relational table. That lets services
 * validate same-project DAG rules, query prerequisites/dependents efficiently,
 * and later port the schema to Postgres without changing the domain contract.
 */
export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: text('depends_on_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    createdByType: text('created_by_type', { enum: ['agent', 'human', 'system'] }).notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('task_dependencies_unique_edge').on(table.taskId, table.dependsOnTaskId)],
);

/**
 * Claims are append-only-ish lease records. Releasing a claim sets released_at
 * rather than deleting the row, so activity history and stale lease diagnosis
 * remain possible even after another agent claims the task.
 */
export const taskClaims = sqliteTable('task_claims', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull(),
  claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  lastHeartbeatAt: integer('last_heartbeat_at', { mode: 'timestamp_ms' }).notNull(),
  releasedAt: integer('released_at', { mode: 'timestamp_ms' }),
});

/**
 * Events are immutable activity history. task_id is nullable with SET NULL so a
 * project timeline can survive future task deletion/archival workflows.
 */
export const taskEvents = sqliteTable('task_events', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  ...actorColumns,
  eventType: text('event_type', { enum: eventTypes }).notNull(),
  message: text('message').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Artifacts and verification are separated on purpose. Artifacts describe what
 * changed or was produced; verification records why completion is trustworthy.
 */
export const taskArtifacts = sqliteTable('task_artifacts', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: artifactKinds }).notNull(),
  value: text('value').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdByType: text('created_by_type', { enum: ['agent', 'human', 'system'] }).notNull(),
  createdById: text('created_by_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const taskVerifications = sqliteTable('task_verifications', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  evidenceJson: text('evidence_json').notNull().default('[]'),
  createdByType: text('created_by_type', { enum: ['agent', 'human', 'system'] }).notNull(),
  createdById: text('created_by_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Row types are exported so repository/service code can map database records
 * back into domain objects without hand-writing parallel TypeScript interfaces.
 */
export type ProjectRow = typeof projects.$inferSelect;
export type ProjectRegistryRow = typeof projectRegistry.$inferSelect;
export type ProjectContextRow = typeof projectContexts.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TaskDependencyRow = typeof taskDependencies.$inferSelect;
export type TaskClaimRow = typeof taskClaims.$inferSelect;
export type TaskEventRow = typeof taskEvents.$inferSelect;
export type TaskArtifactRow = typeof taskArtifacts.$inferSelect;
export type TaskVerificationRow = typeof taskVerifications.$inferSelect;
