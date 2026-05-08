import Database from 'better-sqlite3';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import {
  type Actor,
  type ArtifactKind,
  type DependencyStatus,
  type EventType,
  type Project,
  type ProjectContext,
  type ProjectLifecycleStatus,
  type Task,
  type TaskArtifact,
  type TaskClaim,
  type TaskDependency,
  type TaskEvent,
  type TaskStatus,
  type TaskVerification,
  type TaskWithRelations,
} from '../core/domain.ts';
import type {
  CreateProjectInput,
  CreateTaskInput,
  ListClaimsInput,
  ListTasksInput,
  LocalAgentKanbanService,
  RegisterProjectInput,
  SplitTaskInput,
  UpdateTaskInput,
} from '../core/services.ts';
import {
  createTaskBaseSchema,
  invariant,
  nonEmptyTrimmedString,
  projectContextInputSchema,
  replacementTaskSchema,
  taskStatusSchema,
  updateTaskBaseSchema,
  verificationEvidenceSchema,
} from '../core/validation.ts';
import * as schema from './schema.ts';
import {
  projectContexts,
  projectRegistry,
  projects,
  taskArtifacts,
  taskClaims,
  taskDependencies,
  taskEvents,
  taskVerifications,
  tasks,
  type ProjectContextRow,
  type ProjectRegistryRow,
  type ProjectRow,
  type TaskArtifactRow,
  type TaskClaimRow,
  type TaskDependencyRow,
  type TaskEventRow,
  type TaskRow,
  type TaskVerificationRow,
} from './schema.ts';

type DrizzleDatabase = BetterSQLite3Database<typeof schema>;

type JsonObject = Record<string, unknown>;

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
 * Factory options are deliberately small for Phase 2. Tests usually use the
 * defaults, the local app can opt into seed data, and future MCP/HTTP adapters
 * can pass an explicit filename from environment configuration.
 */
export type SqliteKanbanOptions = {
  migrate?: boolean;
  seed?: boolean;
};

/**
 * Applies the checked-in SQL migration file. Drizzle owns the schema typing,
 * while this tiny runner keeps local startup dependency-free until a fuller
 * migration CLI workflow is needed.
 */
export function applyProjectSqliteMigrations(sqlite: Database.Database): void {
  sqlite.pragma('foreign_keys = ON');
  const currentFile = fileURLToPath(import.meta.url);
  const migrationPath = join(dirname(currentFile), 'migrations', 'project', '0000_project_workflow.sql');
  sqlite.exec(readFileSync(migrationPath, 'utf8'));
}

export function applyRegistrySqliteMigrations(sqlite: Database.Database): void {
  sqlite.pragma('foreign_keys = ON');
  const currentFile = fileURLToPath(import.meta.url);
  const migrationPath = join(dirname(currentFile), 'migrations', 'registry', '0000_registry.sql');
  sqlite.exec(readFileSync(migrationPath, 'utf8'));
}

export function createSqliteKanbanService(
  filename = process.env.LOCAL_AGENT_KANBAN_REGISTRY_DB ?? './local-agent-kanban-registry.sqlite',
  options: SqliteKanbanOptions = {},
): SqliteKanbanService {
  const service = new SqliteKanbanService(filename, options);
  if (options.seed ?? false) {
    seedSqliteKanbanService(service);
  }
  return service;
}

/**
 * Seed data is implemented through the public service interface, not direct
 * inserts. That means the same validation and event-writing paths are exercised
 * for local demo data that MCP and HTTP workflows will use later.
 */
export function seedSqliteKanbanService(service: LocalAgentKanbanService): Project {
  const actor: Actor = { type: 'human', id: 'local-seed' };
  const existing = service.listProjects().find((project) => project.name === 'Local Agent Kanban');
  if (existing) {
    return existing;
  }
  const project = service.createProject({
    actor,
    name: 'Local Agent Kanban',
    description: 'Seed project for local development.',
    repoPath: process.cwd(),
  });
  service.updateProjectContext(actor, project.id, {
    overviewMarkdown: 'A local-first Kanban console for trusted coding agents.',
    repoPath: process.cwd(),
    packageManager: 'npm',
    installCommand: 'npm install',
    testCommand: 'npm run test',
    buildCommand: 'npm run build',
    lintCommand: 'npm run lint',
  });
  service.createTask({
    actor,
    projectId: project.id,
    title: 'Review the seeded board',
    description: 'Confirm SQLite persistence is working locally.',
    status: 'ready',
    priority: 'medium',
    labels: ['db'],
  });
  return project;
}

export class SqliteKanbanService implements LocalAgentKanbanService {
  private readonly sqlite: Database.Database;
  private readonly database: DrizzleDatabase;
  private readonly resolver: ProjectDatabaseResolver;

  constructor(filename: string, options: SqliteKanbanOptions = {}) {
    this.sqlite = new Database(filename);
    this.sqlite.pragma('foreign_keys = ON');
    if (options.migrate ?? true) {
      applyRegistrySqliteMigrations(this.sqlite);
    }
    this.database = drizzle(this.sqlite, { schema });
    this.resolver = new ProjectDatabaseResolver(this.database);
  }

  close(): void {
    this.resolver.close();
    this.sqlite.close();
  }

  listProjects(): Project[] {
    return this.database.select().from(projectRegistry).orderBy(asc(projectRegistry.registeredAt)).all().map(toRegistryProject);
  }

  createProject(input: CreateProjectInput): Project {
    const repoPath = normalizeRepoPath(input.repoPath);
    const projectDbPath = deriveProjectDbPath(repoPath);
    mkdirSync(dirname(projectDbPath), { recursive: true });
    const store = this.resolver.openProjectDb(projectDbPath);
    invariant(
      store.listProjects().length === 0,
      'project_database_already_initialized',
      `Project database already contains a canonical project row: ${projectDbPath}`,
    );
    const project = store.createProject({ ...input, repoPath });
    this.upsertRegistry(project);
    return project;
  }

  registerProject(input: RegisterProjectInput): Project {
    const repoPath = normalizeRepoPath(input.repoPath);
    const projectDbPath = deriveProjectDbPath(repoPath);
    invariant(existsSync(projectDbPath), 'project_database_not_found', `Project database not found: ${projectDbPath}`);
    const store = this.resolver.openProjectDb(projectDbPath);
    const projectsInDb = store.listProjects();
    invariant(
      projectsInDb.length === 1,
      'project_database_invalid',
      'A repository project database must contain exactly one canonical project row.',
    );
    const project = { ...projectsInDb[0], repoPath, projectDbPath };
    this.upsertRegistry(project);
    return project;
  }

  unregisterProject(_actor: Actor, projectId: string): { projectId: string; unregistered: true } {
    const row = this.requireRegistryProject(projectId);
    this.database.delete(projectRegistry).where(eq(projectRegistry.projectId, row.projectId)).run();
    this.resolver.forget(row.projectDbPath);
    return { projectId, unregistered: true };
  }

  updateProjectLifecycle(_actor: Actor, projectId: string, lifecycleStatus: ProjectLifecycleStatus): Project {
    const row = this.requireRegistryProject(projectId);
    const now = new Date();
    this.database
      .update(projectRegistry)
      .set({ lifecycleStatus, updatedAt: now })
      .where(eq(projectRegistry.projectId, projectId))
      .run();
    const store = this.resolver.openProjectDb(row.projectDbPath);
    store.updateProjectMetadata(projectId, { lifecycleStatus });
    return { ...toRegistryProject(row), lifecycleStatus, updatedAt: now };
  }

  getProjectContext(projectId: string): ProjectContext {
    return this.resolver.resolveByProjectId(projectId).getProjectContext(projectId);
  }

  updateProjectContext(
    actor: Actor,
    projectId: string,
    context: Partial<Omit<ProjectContext, 'projectId' | 'updatedAt'>>,
  ): ProjectContext {
    return this.resolver.resolveByProjectId(projectId).updateProjectContext(actor, projectId, context);
  }

  listTasks(input: ListTasksInput = {}): TaskWithRelations[] {
    if (input.projectId) {
      return this.resolver.resolveByProjectId(input.projectId).listTasks(input);
    }
    return this.resolver.allStores().flatMap((store) => store.listTasks(input));
  }

  createTask(input: CreateTaskInput): TaskWithRelations {
    return this.resolver.resolveByProjectId(input.projectId).createTask(input);
  }

  updateTask(actor: Actor, taskId: string, input: UpdateTaskInput): TaskWithRelations {
    return this.resolver.resolveByTaskId(taskId).updateTask(actor, taskId, input);
  }

  updateTaskDependencies(actor: Actor, taskId: string, prerequisiteTaskIds: string[]): TaskWithRelations {
    return this.resolver.resolveByTaskId(taskId).updateTaskDependencies(actor, taskId, prerequisiteTaskIds);
  }

  splitTask(input: SplitTaskInput): { archivedTask: Task; replacementTasks: TaskWithRelations[] } {
    return this.resolver.resolveByTaskId(input.taskId).splitTask(input);
  }

  updateTaskStatus(actor: Actor, taskId: string, status: TaskStatus): TaskWithRelations {
    return this.resolver.resolveByTaskId(taskId).updateTaskStatus(actor, taskId, status);
  }

  addTaskNote(actor: Actor, taskId: string, note: string): TaskEvent {
    return this.resolver.resolveByTaskId(taskId).addTaskNote(actor, taskId, note);
  }

  requestReview(actor: Actor, taskId: string, summary: string): TaskWithRelations {
    return this.resolver.resolveByTaskId(taskId).requestReview(actor, taskId, summary);
  }

  completeTask(actor: Actor, taskId: string, summary: string, evidence?: string[]): TaskWithRelations {
    return this.resolver.resolveByTaskId(taskId).completeTask(actor, taskId, summary, evidence);
  }

  listClaims(input: ListClaimsInput = {}): TaskClaim[] {
    if (input.projectId) {
      return this.resolver.resolveByProjectId(input.projectId).listClaims(input);
    }
    if (input.taskId) {
      return this.resolver.resolveByTaskId(input.taskId).listClaims(input);
    }
    return this.resolver.allStores().flatMap((store) => store.listClaims(input));
  }

  claimTask(agentId: string, taskId: string, leaseSeconds?: number, now?: Date): TaskClaim {
    return this.resolver.resolveByTaskId(taskId).claimTask(agentId, taskId, leaseSeconds, now);
  }

  heartbeatClaim(agentId: string, claimId: string, leaseSeconds?: number, now?: Date): TaskClaim {
    return this.resolver.resolveByClaimId(claimId).heartbeatClaim(agentId, claimId, leaseSeconds, now);
  }

  releaseClaim(actor: Actor, claimId: string, now?: Date): TaskClaim {
    return this.resolver.resolveByClaimId(claimId).releaseClaim(actor, claimId, now);
  }

  listArtifacts(taskId: string): TaskArtifact[] {
    return this.resolver.resolveByTaskId(taskId).listArtifacts(taskId);
  }

  recordArtifact(actor: Actor, taskId: string, kind: ArtifactKind, value: string, metadata?: JsonObject): TaskArtifact {
    return this.resolver.resolveByTaskId(taskId).recordArtifact(actor, taskId, kind, value, metadata);
  }

  listVerifications(taskId: string): TaskVerification[] {
    return this.resolver.resolveByTaskId(taskId).listVerifications(taskId);
  }

  recordVerification(actor: Actor, taskId: string, summary: string, evidence: string[]): TaskVerification {
    return this.resolver.resolveByTaskId(taskId).recordVerification(actor, taskId, summary, evidence);
  }

  listEvents(projectId?: string): TaskEvent[] {
    if (projectId) {
      return this.resolver.resolveByProjectId(projectId).listEvents(projectId);
    }
    return this.resolver.allStores().flatMap((store) => store.listEvents());
  }

  private upsertRegistry(project: Project): void {
    const now = new Date();
    this.database
      .insert(projectRegistry)
      .values({
        projectId: project.id,
        name: project.name,
        description: project.description,
        repoPath: project.repoPath,
        projectDbPath: project.projectDbPath,
        lifecycleStatus: project.lifecycleStatus,
        registeredAt: now,
        lastOpenedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projectRegistry.projectId,
        set: {
          name: project.name,
          description: project.description,
          repoPath: project.repoPath,
          projectDbPath: project.projectDbPath,
          lifecycleStatus: project.lifecycleStatus,
          lastOpenedAt: now,
          updatedAt: now,
        },
      })
      .run();
  }

  private requireRegistryProject(projectId: string): ProjectRegistryRow {
    const row = this.database.select().from(projectRegistry).where(eq(projectRegistry.projectId, projectId)).get();
    invariant(row !== undefined, 'project_not_found', `Project not found: ${projectId}`);
    return row;
  }
}

class ProjectDatabaseResolver {
  private readonly cache = new Map<string, ProjectSqliteKanbanService>();

  constructor(private readonly registryDatabase: DrizzleDatabase) {}

  resolveByProjectId(projectId: string): ProjectSqliteKanbanService {
    const row = this.registryDatabase.select().from(projectRegistry).where(eq(projectRegistry.projectId, projectId)).get();
    invariant(row !== undefined, 'project_not_found', `Project not found: ${projectId}`);
    return this.openProjectDb(row.projectDbPath);
  }

  resolveByTaskId(taskId: string): ProjectSqliteKanbanService {
    const store = this.allStores().find((candidate) => candidate.hasTask(taskId));
    invariant(store !== undefined, 'task_not_found', `Task not found: ${taskId}`);
    return store;
  }

  resolveByClaimId(claimId: string): ProjectSqliteKanbanService {
    const store = this.allStores().find((candidate) => candidate.hasClaim(claimId));
    invariant(store !== undefined, 'claim_not_found', `Claim not found: ${claimId}`);
    return store;
  }

  allStores(): ProjectSqliteKanbanService[] {
    return this.registryDatabase
      .select()
      .from(projectRegistry)
      .all()
      .map((row) => this.openProjectDb(row.projectDbPath));
  }

  openProjectDb(projectDbPath: string): ProjectSqliteKanbanService {
    const normalizedPath = resolve(projectDbPath);
    const cached = this.cache.get(normalizedPath);
    if (cached) {
      return cached;
    }
    const sqlite = new Database(normalizedPath);
    sqlite.pragma('foreign_keys = ON');
    applyProjectSqliteMigrations(sqlite);
    const store = new ProjectSqliteKanbanService(sqlite);
    this.cache.set(normalizedPath, store);
    return store;
  }

  forget(projectDbPath: string): void {
    const normalizedPath = resolve(projectDbPath);
    const store = this.cache.get(normalizedPath);
    if (store) {
      store.close();
      this.cache.delete(normalizedPath);
    }
  }

  close(): void {
    for (const store of this.cache.values()) {
      store.close();
    }
    this.cache.clear();
  }
}

class ProjectSqliteKanbanService {
  private readonly database: DrizzleDatabase;

  constructor(private readonly sqlite: Database.Database) {
    this.database = drizzle(sqlite, { schema });
  }

  close(): void {
    this.sqlite.close();
  }

  listProjects(): Project[] {
    return this.database.select().from(projects).orderBy(asc(projects.createdAt)).all().map(toProject);
  }

  createProject(input: CreateProjectInput): Project {
    return this.transaction(() => {
      const name = nonEmptyTrimmedString.max(120).parse(input.name);
      const repoPath = normalizeRepoPath(input.repoPath);
      const now = new Date();
      const project: Project = {
        id: nextId('project'),
        name,
        description: input.description?.trim() ?? '',
        repoPath,
        projectDbPath: deriveProjectDbPath(repoPath),
        lifecycleStatus: 'active',
        createdAt: now,
        updatedAt: now,
      };
      this.database.insert(projects).values(project).run();
      // Create the context row with the project so getProjectContext can always
      // return a full shape. That is friendlier for MCP callers than "missing"
      // context responses with many optional fields.
      this.database
        .insert(projectContexts)
        .values({
          projectId: project.id,
          overviewMarkdown: '',
          agentInstructionsMarkdown: '',
          repoPath,
          defaultBranch: null,
          packageManager: null,
          installCommand: null,
          testCommand: null,
          buildCommand: null,
          lintCommand: null,
          codingConventionsMarkdown: '',
          updatedAt: now,
        })
        .run();
      this.writeEvent(input.actor, project.id, null, 'project.created', `Project created: ${project.name}`, {});
      return project;
    });
  }

  updateProjectMetadata(
    projectId: string,
    changes: Partial<Pick<Project, 'name' | 'description' | 'repoPath' | 'projectDbPath' | 'lifecycleStatus'>>,
  ): Project {
    return this.transaction(() => {
      const current = this.requireProject(projectId);
      const updated = { ...current, ...changes, updatedAt: new Date() };
      this.database
        .update(projects)
        .set({
          name: updated.name,
          description: updated.description,
          repoPath: updated.repoPath,
          projectDbPath: updated.projectDbPath,
          lifecycleStatus: updated.lifecycleStatus,
          updatedAt: updated.updatedAt,
        })
        .where(eq(projects.id, projectId))
        .run();
      return updated;
    });
  }

  hasTask(taskId: string): boolean {
    return this.database.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get() !== undefined;
  }

  hasClaim(claimId: string): boolean {
    return this.database.select({ id: taskClaims.id }).from(taskClaims).where(eq(taskClaims.id, claimId)).get() !== undefined;
  }

  getProjectContext(projectId: string): ProjectContext {
    this.requireProject(projectId);
    const row = this.database.select().from(projectContexts).where(eq(projectContexts.projectId, projectId)).get();
    return row ? toProjectContext(row) : defaultContext(projectId, new Date());
  }

  updateProjectContext(
    actor: Actor,
    projectId: string,
    context: Partial<Omit<ProjectContext, 'projectId' | 'updatedAt'>>,
  ): ProjectContext {
    return this.transaction(() => {
      this.requireProject(projectId);
      const existing = this.getProjectContext(projectId);
      const parsed = projectContextInputSchema.partial().parse(context);
      const updated: ProjectContext = { ...existing, ...parsed, projectId, updatedAt: new Date() };
      this.database
        .update(projectContexts)
        .set({
          overviewMarkdown: updated.overviewMarkdown,
          agentInstructionsMarkdown: updated.agentInstructionsMarkdown,
          repoPath: updated.repoPath,
          defaultBranch: updated.defaultBranch,
          packageManager: updated.packageManager,
          installCommand: updated.installCommand,
          testCommand: updated.testCommand,
          buildCommand: updated.buildCommand,
          lintCommand: updated.lintCommand,
          codingConventionsMarkdown: updated.codingConventionsMarkdown,
          updatedAt: updated.updatedAt,
        })
        .where(eq(projectContexts.projectId, projectId))
        .run();
      this.writeEvent(actor, projectId, null, 'project.context_updated', 'Project context updated', {
        fields: Object.keys(parsed),
      });
      return updated;
    });
  }

  listTasks(input: ListTasksInput = {}): TaskWithRelations[] {
    // Phase 2 favors a clear read-model derivation over clever SQL. The service
    // loads task rows, maps them to domain objects, then adds dependency and
    // claim facts in withRelations. Later phases can optimize this behind the
    // same service contract if board queries become large.
    return this.database
      .select()
      .from(tasks)
      .orderBy(asc(tasks.createdAt))
      .all()
      .map(toTask)
      .filter((task) => !input.projectId || task.projectId === input.projectId)
      .filter((task) => !input.status || task.status === input.status)
      .map((task) => this.withRelations(task, input.now))
      .filter((task) => !input.claimableOnly || task.isClaimable);
  }

  createTask(input: CreateTaskInput): TaskWithRelations {
    return this.transaction(() => {
      // Services parse inputs even if MCP schemas already did. HTTP routes,
      // tests, seed data, and future scripts all get the same validation rules.
      const parsed = createTaskBaseSchema.parse(input);
      this.requireProject(parsed.projectId);
      const now = new Date();
      const task: Task = {
        id: nextId('task'),
        projectId: parsed.projectId,
        title: parsed.title,
        description: parsed.description,
        acceptanceCriteria: parsed.acceptanceCriteria,
        status: parsed.status,
        priority: parsed.priority,
        labels: [...new Set(parsed.labels)],
        createdBy: input.actor,
        needsGrooming: parsed.needsGrooming ?? input.actor.type === 'agent',
        dependencyStatus: 'unblocked',
        sourceTaskId: null,
        splitReason: null,
        completedAt: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.insertTask(task);
      // Dependency replacement also performs same-project and cycle validation.
      // Because this is inside a SQLite transaction, task insertion, dependency
      // insertion, and dependency events commit or roll back together.
      this.replaceDependencies(input.actor, task.id, parsed.prerequisiteTaskIds);
      this.writeEvent(input.actor, task.projectId, task.id, 'task.created', `Task created: ${task.title}`, {});
      return this.withRelations(this.requireTask(task.id));
    });
  }

  updateTask(actor: Actor, taskId: string, input: UpdateTaskInput): TaskWithRelations {
    return this.transaction(() => {
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
    });
  }

  updateTaskDependencies(actor: Actor, taskId: string, prerequisiteTaskIds: string[]): TaskWithRelations {
    return this.transaction(() => {
      this.requireTask(taskId);
      this.replaceDependencies(actor, taskId, prerequisiteTaskIds);
      const updated = this.touchTask(taskId, { dependencyStatus: this.deriveDependencyStatus(taskId) });
      return this.withRelations(updated);
    });
  }

  splitTask(input: SplitTaskInput): { archivedTask: Task; replacementTasks: TaskWithRelations[] } {
    return this.transaction(() => {
      const original = this.requireTask(input.taskId);
      const reason = nonEmptyTrimmedString.parse(input.reason);
      invariant(input.replacements.length >= 2, 'split_requires_replacements', 'Splitting a task requires at least two replacements.');

      const originalPrerequisites = this.prerequisiteIds(original.id);
      const originalDependents = this.dependentIds(original.id);
      const hasDependencyEdges = originalPrerequisites.length > 0 || originalDependents.length > 0;
      // Connected tasks require explicit dependency handling because splitting
      // can silently change the work order for agents. For MCP, this produces a
      // clear validation error instead of surprising board state.
      invariant(
        !hasDependencyEdges || input.dependencyHandling !== undefined,
        'split_requires_dependency_handling',
        'Splitting a task with prerequisites or dependents requires dependency handling instructions.',
      );

      const replacementTasks = input.replacements.map((replacement) => {
        const parsed = replacementTaskSchema.parse(replacement);
        const now = new Date();
        const task: Task = {
          id: nextId('task'),
          projectId: original.projectId,
          title: parsed.title,
          description: parsed.description,
          acceptanceCriteria: parsed.acceptanceCriteria,
          status: parsed.status,
          priority: parsed.priority,
          labels: [...new Set(parsed.labels)],
          createdBy: input.actor,
          // Replacements from an accepted split are treated as already groomed:
          // the split workflow itself is the review point.
          needsGrooming: false,
          dependencyStatus: 'unblocked',
          sourceTaskId: original.id,
          splitReason: reason,
          completedAt: null,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        this.insertTask(task);
        return { task, prerequisiteTaskIds: parsed.prerequisiteTaskIds };
      });

      const inheritOriginalPrerequisites = input.dependencyHandling?.moveOriginalPrerequisitesToReplacements ?? true;
      for (const replacement of replacementTasks) {
        // By default, replacements inherit the original prerequisites so they do
        // not become claimable earlier than the original task would have been.
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
        // Dependents that used to wait on the original are rewired to the chosen
        // replacement tasks. The original is then archived so the board remains
        // flat rather than turning splits into parent/child containers.
        const existing = this.prerequisiteIds(dependentId).filter((id) => id !== original.id);
        this.replaceDependencies(input.actor, dependentId, [...existing, ...dependentTargets]);
        this.writeEvent(input.actor, original.projectId, dependentId, 'task.dependency_rewired', 'Dependency rewired after task split', {
          fromTaskId: original.id,
          toTaskIds: dependentTargets,
        });
      }

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
    });
  }

  claimTask(agentId: string, taskId: string, leaseSeconds = 1800, now = new Date()): TaskClaim {
    return this.transaction(() => {
      const task = this.requireTask(taskId);
      const taskWithRelations = this.withRelations(task, now);
      // Claimability is derived from current task state, dependencies, and active
      // unexpired leases. Keeping this check in the shared service prevents MCP
      // and HTTP adapters from accepting work out of order.
      invariant(taskWithRelations.isClaimable, 'task_not_claimable', 'Task is not claimable.');
      const claim: TaskClaim = {
        id: nextId('claim'),
        taskId,
        agentId: nonEmptyTrimmedString.parse(agentId),
        claimedAt: now,
        expiresAt: addSeconds(now, leaseSeconds),
        lastHeartbeatAt: now,
        releasedAt: null,
      };
      this.database.insert(taskClaims).values(claim).run();
      this.writeEvent({ type: 'agent', id: claim.agentId }, task.projectId, task.id, 'task.claimed', `Task claimed by ${claim.agentId}`, {
        claimId: claim.id,
        expiresAt: claim.expiresAt.toISOString(),
      });
      return claim;
    });
  }

  listClaims(input: ListClaimsInput = {}): TaskClaim[] {
    const now = input.now ?? new Date();
    return this.database
      .select()
      .from(taskClaims)
      .orderBy(asc(taskClaims.claimedAt))
      .all()
      .map(toTaskClaim)
      .filter((claim) => !input.taskId || claim.taskId === input.taskId)
      .filter((claim) => !input.projectId || this.requireTask(claim.taskId).projectId === input.projectId)
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
    return this.transaction(() => {
      const claim = this.requireClaim(claimId);
      invariant(claim.agentId === agentId, 'claim_agent_mismatch', 'Only the claiming agent can heartbeat this claim.');
      invariant(claim.releasedAt === null, 'claim_released', 'Released claims cannot be heartbeated.');
      const task = this.requireTask(claim.taskId);
      const updated = {
        ...claim,
        lastHeartbeatAt: now,
        expiresAt: addSeconds(now, leaseSeconds),
      };
      this.database
        .update(taskClaims)
        .set({ lastHeartbeatAt: updated.lastHeartbeatAt, expiresAt: updated.expiresAt })
        .where(eq(taskClaims.id, claim.id))
        .run();
      this.writeEvent({ type: 'agent', id: agentId }, task.projectId, task.id, 'task.heartbeat', `Claim heartbeat from ${agentId}`, {
        claimId,
        expiresAt: updated.expiresAt.toISOString(),
      });
      return updated;
    });
  }

  releaseClaim(actor: Actor, claimId: string, now = new Date()): TaskClaim {
    return this.transaction(() => {
      const claim = this.requireClaim(claimId);
      invariant(claim.releasedAt === null, 'claim_already_released', 'Claim is already released.');
      const task = this.requireTask(claim.taskId);
      const updated = { ...claim, releasedAt: now };
      this.database.update(taskClaims).set({ releasedAt: now }).where(eq(taskClaims.id, claim.id)).run();
      this.writeEvent(actor, task.projectId, task.id, 'task.claim_released', `Claim released by ${actor.id}`, { claimId });
      return updated;
    });
  }

  updateTaskStatus(actor: Actor, taskId: string, status: TaskStatus): TaskWithRelations {
    return this.transaction(() => {
      const parsedStatus = taskStatusSchema.parse(status);
      const current = this.requireTask(taskId);
      this.validateStatusTransition(current.status, parsedStatus);
      const now = new Date();
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
    });
  }

  addTaskNote(actor: Actor, taskId: string, note: string): TaskEvent {
    return this.transaction(() => {
      const task = this.requireTask(taskId);
      return this.writeEvent(actor, task.projectId, task.id, 'task.note_added', nonEmptyTrimmedString.parse(note), {});
    });
  }

  recordArtifact(actor: Actor, taskId: string, kind: ArtifactKind, value: string, metadata: JsonObject = {}): TaskArtifact {
    return this.transaction(() => {
      const task = this.requireTask(taskId);
      const artifact: TaskArtifact = {
        id: nextId('artifact'),
        taskId,
        kind,
        value: nonEmptyTrimmedString.parse(value),
        metadata,
        createdBy: actor,
        createdAt: new Date(),
      };
      this.database
        .insert(taskArtifacts)
        .values({
          id: artifact.id,
          taskId: artifact.taskId,
          kind: artifact.kind,
          value: artifact.value,
          metadataJson: JSON.stringify(artifact.metadata),
          createdByType: actor.type,
          createdById: actor.id,
          createdAt: artifact.createdAt,
        })
        .run();
      this.writeEvent(actor, task.projectId, task.id, 'artifact.recorded', `Artifact recorded: ${kind}`, {
        artifactId: artifact.id,
      });
      return artifact;
    });
  }

  listArtifacts(taskId: string): TaskArtifact[] {
    this.requireTask(taskId);
    return this.database
      .select()
      .from(taskArtifacts)
      .where(eq(taskArtifacts.taskId, taskId))
      .orderBy(asc(taskArtifacts.createdAt))
      .all()
      .map(toTaskArtifact);
  }

  recordVerification(actor: Actor, taskId: string, summary: string, evidence: string[]): TaskVerification {
    return this.transaction(() => {
      const task = this.requireTask(taskId);
      const verification: TaskVerification = {
        id: nextId('verification'),
        taskId,
        summary: nonEmptyTrimmedString.parse(summary),
        evidence: verificationEvidenceSchema.parse(evidence),
        createdBy: actor,
        createdAt: new Date(),
      };
      this.database
        .insert(taskVerifications)
        .values({
          id: verification.id,
          taskId,
          summary: verification.summary,
          evidenceJson: JSON.stringify(verification.evidence),
          createdByType: actor.type,
          createdById: actor.id,
          createdAt: verification.createdAt,
        })
        .run();
      this.writeEvent(actor, task.projectId, task.id, 'verification.recorded', 'Verification recorded', {
        verificationId: verification.id,
      });
      return verification;
    });
  }

  listVerifications(taskId: string): TaskVerification[] {
    this.requireTask(taskId);
    return this.database
      .select()
      .from(taskVerifications)
      .where(eq(taskVerifications.taskId, taskId))
      .orderBy(asc(taskVerifications.createdAt))
      .all()
      .map(toTaskVerification);
  }

  requestReview(actor: Actor, taskId: string, summary: string): TaskWithRelations {
    return this.transaction(() => {
      // requestReview intentionally writes both a human-readable note and a
      // machine-readable review event. The future UI can show the note in task
      // detail and query review events for a review queue.
      this.addTaskNote(actor, taskId, `Review requested: ${summary}`);
      const task = this.updateTaskStatus(actor, taskId, 'review');
      this.writeEvent(actor, task.projectId, taskId, 'task.review_requested', nonEmptyTrimmedString.parse(summary), {});
      return task;
    });
  }

  completeTask(actor: Actor, taskId: string, summary: string, evidence?: string[]): TaskWithRelations {
    return this.transaction(() => {
      const task = this.requireTask(taskId);
      const parsedSummary = nonEmptyTrimmedString.parse(summary);
      if (evidence !== undefined) {
        // Agents can finish and verify in one MCP call, or record verification
        // earlier and call completeTask later. Both paths satisfy the same rule.
        this.recordVerification(actor, taskId, parsedSummary, evidence);
      }
      const verificationExists =
        this.database.select().from(taskVerifications).where(eq(taskVerifications.taskId, taskId)).get() !== undefined;
      invariant(verificationExists, 'completion_requires_verification', 'Completion requires verification evidence.');
      const completed = this.touchTask(taskId, {
        status: 'done',
        completedAt: new Date(),
      });
      this.writeEvent(actor, task.projectId, taskId, 'task.completed', parsedSummary, {});
      return this.withRelations(completed);
    });
  }

  listEvents(projectId?: string): TaskEvent[] {
    return this.database
      .select()
      .from(taskEvents)
      .orderBy(asc(taskEvents.createdAt))
      .all()
      .map(toTaskEvent)
      .filter((event) => !projectId || event.projectId === projectId);
  }

  private transaction<T>(work: () => T): T {
    // better-sqlite3 transactions roll back when the callback throws. Domain
    // validation errors therefore protect both state rows and the activity event
    // rows that would otherwise describe a mutation that did not actually land.
    return this.sqlite.transaction(work)();
  }

  private insertTask(task: Task): void {
    // The database row is intentionally close to the domain Task shape, with
    // only SQLite-specific conversions such as arrays-to-JSON handled here.
    this.database
      .insert(tasks)
      .values({
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        description: task.description,
        acceptanceCriteriaJson: JSON.stringify(task.acceptanceCriteria),
        status: task.status,
        priority: task.priority,
        labelsJson: JSON.stringify(task.labels),
        createdByType: task.createdBy.type,
        createdById: task.createdBy.id,
        needsGrooming: task.needsGrooming,
        dependencyStatus: task.dependencyStatus,
        sourceTaskId: task.sourceTaskId,
        splitReason: task.splitReason,
        completedAt: task.completedAt,
        archivedAt: task.archivedAt,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })
      .run();
  }

  private replaceDependencies(actor: Actor, taskId: string, prerequisiteTaskIds: string[]): void {
    const task = this.requireTask(taskId);
    const uniqueIds = [...new Set(prerequisiteTaskIds)];
    invariant(!uniqueIds.includes(taskId), 'dependency_self_reference', 'A task cannot depend on itself.');
    for (const prerequisiteId of uniqueIds) {
      const prerequisite = this.requireTask(prerequisiteId);
      invariant(
        prerequisite.projectId === task.projectId,
        'dependency_cross_project',
        'Task dependencies must stay within the same project.',
      );
    }

    const previousIds = this.prerequisiteIds(taskId);
    // Replacing the full prerequisite set keeps dependency updates simple for
    // MCP callers: they send the desired list, and the service computes added
    // and removed edges for events after the new graph is validated.
    this.removeDependenciesForTask(taskId);
    for (const prerequisiteId of uniqueIds) {
      this.database
        .insert(taskDependencies)
        .values({
          id: nextId('dependency'),
          projectId: task.projectId,
          taskId,
          dependsOnTaskId: prerequisiteId,
          createdByType: actor.type,
          createdById: actor.id,
          createdAt: new Date(),
        })
        .run();
    }

    // If this throws, the surrounding SQLite transaction restores the previous
    // dependency rows and suppresses the would-be dependency events.
    invariant(!this.hasDependencyCycle(task.projectId), 'dependency_cycle', 'Task dependencies must form a directed acyclic graph.');

    for (const removedId of previousIds.filter((id) => !uniqueIds.includes(id))) {
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
    this.database.delete(taskDependencies).where(eq(taskDependencies.taskId, taskId)).run();
  }

  private withRelations(task: Task, now = new Date()): TaskWithRelations {
    // TaskWithRelations is the adapter-facing read model. MCP tools can expose
    // dependency and claimability facts directly instead of forcing agents to
    // reconstruct graph state from raw tables.
    const blockingPrerequisites = this.prerequisiteIds(task.id)
      .map((id) => this.requireTask(id))
      .filter((prerequisite) => prerequisite.status !== 'done')
      .map(({ id, title, status }) => ({ id, title, status }));
    const dependencyStatus = this.deriveDependencyStatus(task.id);
    const activeClaim = this.activeClaimForTask(task.id, now);
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
    if (task.dependencyStatus === 'blocked_external') {
      return 'blocked_external';
    }
    return this.prerequisiteIds(taskId).some((id) => this.requireTask(id).status !== 'done') ? 'blocked_by_tasks' : 'unblocked';
  }

  private prerequisiteIds(taskId: string): string[] {
    return this.database
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, taskId))
      .orderBy(asc(taskDependencies.createdAt))
      .all()
      .map((dependency) => dependency.dependsOnTaskId);
  }

  private dependentIds(taskId: string): string[] {
    return this.database
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.dependsOnTaskId, taskId))
      .orderBy(asc(taskDependencies.createdAt))
      .all()
      .map((dependency) => dependency.taskId);
  }

  private activeClaimForTask(taskId: string, now: Date): TaskClaim | null {
    // Expired claims stay in the database as history, but this query ignores
    // them so another agent can reclaim the task after the lease window passes.
    const row = this.database
      .select()
      .from(taskClaims)
      .where(and(eq(taskClaims.taskId, taskId), isNull(taskClaims.releasedAt), gt(taskClaims.expiresAt, now)))
      .orderBy(asc(taskClaims.claimedAt))
      .get();
    return row ? toTaskClaim(row) : null;
  }

  private hasDependencyCycle(projectId: string): boolean {
    const dependencies = this.database
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.projectId, projectId))
      .all()
      .map(toTaskDependency);
    const projectTasks = this.database.select().from(tasks).where(eq(tasks.projectId, projectId)).all().map(toTask);
    const visiting = new Set<string>();
    const visited = new Set<string>();

    // Standard depth-first search: seeing a node already in the current
    // recursion stack means the directed dependency graph contains a cycle.
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

    return projectTasks.some((task) => visit(task.id));
  }

  private validateStatusTransition(fromStatus: TaskStatus, toStatus: TaskStatus): void {
    invariant(fromStatus !== 'archived' || toStatus === 'archived', 'archived_status_is_terminal', 'Archived tasks cannot return to the active board.');
    invariant(toStatus !== 'done', 'completion_requires_complete_task', 'Use completeTask so completion includes a summary and verification evidence.');
  }

  private touchTask(taskId: string, changes: Partial<Task>): Task {
    // Centralizing task updates ensures updatedAt changes consistently whenever
    // a workflow mutates a task row.
    const existing = this.requireTask(taskId);
    const updated = { ...existing, ...changes, updatedAt: new Date() };
    this.database
      .update(tasks)
      .set({
        title: updated.title,
        description: updated.description,
        acceptanceCriteriaJson: JSON.stringify(updated.acceptanceCriteria),
        status: updated.status,
        priority: updated.priority,
        labelsJson: JSON.stringify(updated.labels),
        needsGrooming: updated.needsGrooming,
        dependencyStatus: updated.dependencyStatus,
        sourceTaskId: updated.sourceTaskId,
        splitReason: updated.splitReason,
        completedAt: updated.completedAt,
        archivedAt: updated.archivedAt,
        updatedAt: updated.updatedAt,
      })
      .where(eq(tasks.id, taskId))
      .run();
    return updated;
  }

  private requireProject(projectId: string): Project {
    const row = this.database.select().from(projects).where(eq(projects.id, projectId)).get();
    invariant(row !== undefined, 'project_not_found', `Project not found: ${projectId}`);
    return toProject(row);
  }

  private requireTask(taskId: string): Task {
    const row = this.database.select().from(tasks).where(eq(tasks.id, taskId)).get();
    invariant(row !== undefined, 'task_not_found', `Task not found: ${taskId}`);
    return toTask(row);
  }

  private requireClaim(claimId: string): TaskClaim {
    const row = this.database.select().from(taskClaims).where(eq(taskClaims.id, claimId)).get();
    invariant(row !== undefined, 'claim_not_found', `Claim not found: ${claimId}`);
    return toTaskClaim(row);
  }

  private writeEvent(
    actor: Actor,
    projectId: string,
    taskId: string | null,
    eventType: EventType,
    message: string,
    metadata: JsonObject,
  ): TaskEvent {
    // Events are append-only from the domain perspective. Callers do not update
    // or delete them; future UI screens can build activity feeds directly from
    // this table.
    const event: TaskEvent = {
      id: nextId('event'),
      projectId,
      taskId,
      actor,
      eventType,
      message,
      metadata,
      createdAt: new Date(),
    };
    this.database
      .insert(taskEvents)
      .values({
        id: event.id,
        projectId,
        taskId,
        actorType: actor.type,
        actorId: actor.id,
        eventType,
        message,
        metadataJson: JSON.stringify(metadata),
        createdAt: event.createdAt,
      })
      .run();
    return event;
  }
}

function nextId(prefix: string): string {
  // UUID-backed IDs avoid coordinating per-table counters between memory,
  // SQLite, and future Postgres implementations while keeping the type as a
  // simple string for MCP callers.
  return `${prefix}_${randomUUID()}`;
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function normalizeRepoPath(repoPath: string): string {
  return resolve(nonEmptyTrimmedString.parse(repoPath));
}

export function deriveProjectDbPath(repoPath: string): string {
  return join(normalizeRepoPath(repoPath), '.local-agent-kanban', 'project.sqlite');
}

function parseStringArray(value: string): string[] {
  // JSON parsing is deliberately defensive. Corrupt optional metadata should not
  // crash a board query; core relational fields still enforce stricter shape.
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function parseJsonObject(value: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    repoPath: row.repoPath,
    projectDbPath: row.projectDbPath,
    lifecycleStatus: row.lifecycleStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRegistryProject(row: ProjectRegistryRow): Project {
  return {
    id: row.projectId,
    name: row.name,
    description: row.description,
    repoPath: row.repoPath,
    projectDbPath: row.projectDbPath,
    lifecycleStatus: row.lifecycleStatus,
    createdAt: row.registeredAt,
    updatedAt: row.updatedAt,
  };
}

function toProjectContext(row: ProjectContextRow): ProjectContext {
  return {
    projectId: row.projectId,
    overviewMarkdown: row.overviewMarkdown,
    agentInstructionsMarkdown: row.agentInstructionsMarkdown,
    repoPath: row.repoPath,
    defaultBranch: row.defaultBranch,
    packageManager: row.packageManager,
    installCommand: row.installCommand,
    testCommand: row.testCommand,
    buildCommand: row.buildCommand,
    lintCommand: row.lintCommand,
    codingConventionsMarkdown: row.codingConventionsMarkdown,
    updatedAt: row.updatedAt,
  };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    acceptanceCriteria: parseStringArray(row.acceptanceCriteriaJson),
    status: row.status,
    priority: row.priority,
    labels: parseStringArray(row.labelsJson),
    createdBy: { type: row.createdByType, id: row.createdById },
    needsGrooming: row.needsGrooming,
    dependencyStatus: row.dependencyStatus,
    sourceTaskId: row.sourceTaskId,
    splitReason: row.splitReason,
    completedAt: row.completedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTaskDependency(row: TaskDependencyRow): TaskDependency {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    dependsOnTaskId: row.dependsOnTaskId,
    createdBy: { type: row.createdByType, id: row.createdById },
    createdAt: row.createdAt,
  };
}

function toTaskClaim(row: TaskClaimRow): TaskClaim {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    claimedAt: row.claimedAt,
    expiresAt: row.expiresAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    releasedAt: row.releasedAt,
  };
}

function toTaskEvent(row: TaskEventRow): TaskEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    actor: { type: row.actorType, id: row.actorId },
    eventType: row.eventType,
    message: row.message,
    metadata: parseJsonObject(row.metadataJson),
    createdAt: row.createdAt,
  };
}

export function toTaskArtifact(row: TaskArtifactRow): TaskArtifact {
  return {
    id: row.id,
    taskId: row.taskId,
    kind: row.kind,
    value: row.value,
    metadata: parseJsonObject(row.metadataJson),
    createdBy: { type: row.createdByType, id: row.createdById },
    createdAt: row.createdAt,
  };
}

export function toTaskVerification(row: TaskVerificationRow): TaskVerification {
  return {
    id: row.id,
    taskId: row.taskId,
    summary: row.summary,
    evidence: parseStringArray(row.evidenceJson),
    createdBy: { type: row.createdByType, id: row.createdById },
    createdAt: row.createdAt,
  };
}
