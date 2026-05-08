import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyProjectSqliteMigrations, applyRegistrySqliteMigrations } from '../src/db/index.ts';

type RegistryRow = {
  project_id: string;
  name: string;
  repo_path: string;
  project_db_path: string;
};

const registryPath = resolve(process.argv[2] ?? process.env.LOCAL_AGENT_KANBAN_REGISTRY_DB ?? './local-agent-kanban-registry.sqlite');

const registry = new Database(registryPath);
try {
  applyRegistrySqliteMigrations(registry);
  assertQuickCheck(registry, registryPath);
  assertTables(registry, registryPath, ['project_registry']);

  const projects = registry
    .prepare('SELECT project_id, name, repo_path, project_db_path FROM project_registry ORDER BY registered_at')
    .all() as RegistryRow[];

  for (const project of projects) {
    if (!existsSync(project.project_db_path)) {
      throw new Error(`Registered project database is missing for ${project.name}: ${project.project_db_path}`);
    }

    const projectDb = new Database(project.project_db_path);
    try {
      // Phase 8 uses this as a startup/recovery smoke check: migrations must be
      // safe to re-run against existing repository-local databases.
      applyProjectSqliteMigrations(projectDb);
      assertQuickCheck(projectDb, project.project_db_path);
      assertTables(projectDb, project.project_db_path, [
        'projects',
        'project_contexts',
        'tasks',
        'task_dependencies',
        'task_claims',
        'task_events',
        'task_artifacts',
        'task_verifications',
      ]);

      const canonicalRows = projectDb.prepare('SELECT COUNT(*) AS count FROM projects WHERE id = ?').get(project.project_id) as {
        count: number;
      };
      if (canonicalRows.count !== 1) {
        throw new Error(`Project database ${project.project_db_path} does not contain canonical project ${project.project_id}.`);
      }
    } finally {
      projectDb.close();
    }
  }

  console.log(`Phase 8 database sanity check passed for ${registryPath}.`);
  console.log(`Registered projects checked: ${projects.length}.`);
} finally {
  registry.close();
}

function assertQuickCheck(database: Database.Database, label: string): void {
  const result = database.pragma('quick_check') as Array<{ quick_check: string }>;
  if (result[0]?.quick_check !== 'ok') {
    throw new Error(`SQLite quick_check failed for ${label}: ${JSON.stringify(result)}`);
  }
}

function assertTables(database: Database.Database, label: string, tableNames: string[]): void {
  const existing = new Set(
    (
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
  const missing = tableNames.filter((tableName) => !existing.has(tableName));
  if (missing.length > 0) {
    throw new Error(`Missing expected tables in ${label}: ${missing.join(', ')}`);
  }
}
