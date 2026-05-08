import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { applyProjectSqliteMigrations, applyRegistrySqliteMigrations, deriveProjectDbPath } from '../src/db/sqliteService.ts';

type LegacyProject = {
  id: string;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
  repo_path: string | null;
};

const [legacyPathArg, registryPathArg] = process.argv.slice(2);

if (!legacyPathArg || !registryPathArg) {
  console.error('Usage: tsx tools/migrate-single-db-to-project-dbs.ts <legacy-db-path> <target-registry-db-path>');
  process.exit(1);
}

const legacyPath = resolve(legacyPathArg);
const registryPath = resolve(registryPathArg);

if (!existsSync(legacyPath)) {
  console.error(`Legacy database does not exist: ${legacyPath}`);
  process.exit(1);
}

const legacy = new Database(legacyPath, { readonly: true });
legacy.pragma('foreign_keys = ON');

try {
  const projects = legacy
    .prepare(
      `
        SELECT p.id, p.name, p.description, p.created_at, p.updated_at, pc.repo_path
        FROM projects p
        LEFT JOIN project_contexts pc ON pc.project_id = p.id
        ORDER BY p.created_at
      `,
    )
    .all() as LegacyProject[];

  const blockingErrors = validateProjects(projects);
  blockingErrors.push(...validateRegistryTarget(registryPath));
  if (blockingErrors.length > 0) {
    console.error('Migration blocked:');
    for (const error of blockingErrors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const targets = projects.map((project) => ({
    ...project,
    repo_path: resolve(project.repo_path as string),
    project_db_path: deriveProjectDbPath(project.repo_path as string),
  }));

  mkdirSync(dirname(registryPath), { recursive: true });
  const registry = new Database(registryPath);
  registry.pragma('foreign_keys = ON');
  applyRegistrySqliteMigrations(registry);

  try {
    registry.transaction(() => {
      for (const target of targets) {
        mkdirSync(dirname(target.project_db_path), { recursive: true });
        const projectDb = new Database(target.project_db_path);
        projectDb.pragma('foreign_keys = ON');
        applyProjectSqliteMigrations(projectDb);
        try {
          copyProject(legacy, projectDb, target);
        } finally {
          projectDb.close();
        }

        registry
          .prepare(
            `
              INSERT INTO project_registry (
                project_id, name, description, repo_path, project_db_path,
                lifecycle_status, registered_at, last_opened_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
              ON CONFLICT(project_id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                repo_path = excluded.repo_path,
                project_db_path = excluded.project_db_path,
                lifecycle_status = excluded.lifecycle_status,
                last_opened_at = excluded.last_opened_at,
                updated_at = excluded.updated_at
            `,
          )
          .run(
            target.id,
            target.name,
            target.description,
            target.repo_path,
            target.project_db_path,
            Date.now(),
            Date.now(),
            Date.now(),
          );
      }
    })();
  } finally {
    registry.close();
  }

  console.log(`Migrated ${targets.length} project(s).`);
  for (const target of targets) {
    console.log(`- ${target.name} (${target.id})`);
    console.log(`  repo: ${target.repo_path}`);
    console.log(`  db:   ${target.project_db_path}`);
  }
} finally {
  legacy.close();
}

function validateRegistryTarget(targetRegistryPath: string): string[] {
  if (!existsSync(targetRegistryPath)) {
    return [];
  }
  const target = new Database(targetRegistryPath, { readonly: true });
  try {
    if (!tableExists(target, 'project_registry')) {
      return [];
    }
    const count = (target.prepare('SELECT COUNT(*) AS count FROM project_registry').get() as { count: number }).count;
    return count > 0 ? [`Target registry already contains project registrations: ${targetRegistryPath}`] : [];
  } finally {
    target.close();
  }
}

function validateProjects(projects: LegacyProject[]): string[] {
  const errors: string[] = [];
  const repoPaths = new Map<string, string>();

  for (const project of projects) {
    if (!project.repo_path || project.repo_path.trim().length === 0) {
      errors.push(`Project ${project.id} (${project.name}) has no usable project_contexts.repo_path.`);
      continue;
    }

    const repoPath = resolve(project.repo_path);
    const previousProjectId = repoPaths.get(repoPath);
    if (previousProjectId) {
      errors.push(`Projects ${previousProjectId} and ${project.id} resolve to the same repo path: ${repoPath}`);
    }
    repoPaths.set(repoPath, project.id);

    const projectDbPath = deriveProjectDbPath(repoPath);
    if (existsSync(projectDbPath)) {
      const targetDb = new Database(projectDbPath, { readonly: true });
      try {
        const projectCount = tableExists(targetDb, 'projects')
          ? ((targetDb.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number }).count ?? 0)
          : 0;
        if (projectCount > 0) {
          errors.push(`Target project database already contains project data: ${projectDbPath}`);
        }
      } finally {
        targetDb.close();
      }
    }
  }

  return errors;
}

function copyProject(legacy: Database.Database, target: Database.Database, project: LegacyProject & { repo_path: string; project_db_path: string }): void {
  target.transaction(() => {
    target
      .prepare(
        `
          INSERT INTO projects (
            id, name, description, repo_path, project_db_path, lifecycle_status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `,
      )
      .run(project.id, project.name, project.description, project.repo_path, project.project_db_path, project.created_at, project.updated_at);

    copyRows(legacy, target, 'project_contexts', 'project_id = ?', [project.id], {
      repo_path: project.repo_path,
    });
    copyRows(legacy, target, 'tasks', 'project_id = ?', [project.id]);
    copyRows(legacy, target, 'task_dependencies', 'project_id = ?', [project.id]);
    copyRows(legacy, target, 'task_claims', `task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, [project.id]);
    copyRows(legacy, target, 'task_events', 'project_id = ?', [project.id]);
    copyRows(legacy, target, 'task_artifacts', `task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, [project.id]);
    copyRows(legacy, target, 'task_verifications', `task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, [project.id]);
  })();
}

function copyRows(
  source: Database.Database,
  target: Database.Database,
  table: string,
  whereClause: string,
  parameters: unknown[],
  overrides: Record<string, unknown> = {},
): void {
  const rows = source.prepare(`SELECT * FROM ${table} WHERE ${whereClause}`).all(...parameters) as Record<string, unknown>[];
  for (const row of rows) {
    const copied = { ...row, ...overrides };
    const columns = Object.keys(copied);
    const placeholders = columns.map(() => '?').join(', ');
    target.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...columns.map((column) => copied[column]));
  }
}

function tableExists(database: Database.Database, table: string): boolean {
  return (
    database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined
  );
}
