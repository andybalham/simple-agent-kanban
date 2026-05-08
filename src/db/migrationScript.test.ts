import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createSqliteKanbanService } from './sqliteService.ts';

describe('single database migration script', () => {
  it('copies legacy project workflow rows into registry plus repository-local databases', () => {
    const directory = mkdtempSync(join(tmpdir(), 'local-agent-kanban-migrate-'));
    const legacyPath = join(directory, 'legacy.sqlite');
    const registryPath = join(directory, 'registry.sqlite');
    const repoPath = join(directory, 'repo');
    const projectDbPath = join(repoPath, '.local-agent-kanban', 'project.sqlite');
    mkdirSync(repoPath, { recursive: true });

    try {
      const legacy = new Database(legacyPath);
      legacy.exec(readFileSync(resolve('src/db/migrations/0000_phase2_sqlite_persistence.sql'), 'utf8'));
      legacy
        .prepare('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('project_legacy', 'Legacy Project', 'Migrated data', 1, 2);
      legacy
        .prepare(
          `
            INSERT INTO project_contexts (
              project_id, overview_markdown, agent_instructions_markdown, repo_path,
              coding_conventions_markdown, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run('project_legacy', 'Overview', '', repoPath, '', 2);
      legacy
        .prepare(
          `
            INSERT INTO tasks (
              id, project_id, title, description, acceptance_criteria_json, status, priority,
              labels_json, created_by_type, created_by_id, needs_grooming, dependency_status,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run('task_legacy', 'project_legacy', 'Legacy task', '', '[]', 'ready', 'medium', '[]', 'agent', 'agent-a', 1, 'unblocked', 3, 4);
      legacy
        .prepare('INSERT INTO task_claims (id, task_id, agent_id, claimed_at, expires_at, last_heartbeat_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('claim_legacy', 'task_legacy', 'agent-a', 5, 65, 5);
      legacy
        .prepare(
          `
            INSERT INTO task_events (
              id, project_id, task_id, actor_type, actor_id, event_type, message, metadata_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run('event_legacy', 'project_legacy', 'task_legacy', 'agent', 'agent-a', 'task.created', 'Task created', '{}', 6);
      legacy
        .prepare(
          'INSERT INTO task_verifications (id, task_id, summary, evidence_json, created_by_type, created_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('verification_legacy', 'task_legacy', 'Verified', '["legacy evidence"]', 'agent', 'agent-a', 7);
      legacy.close();

      execFileSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('tools/migrate-single-db-to-project-dbs.ts'), legacyPath, registryPath], {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      const registry = new Database(registryPath, { readonly: true });
      expect(registry.prepare('SELECT project_id, repo_path, project_db_path FROM project_registry').get()).toEqual({
        project_id: 'project_legacy',
        repo_path: repoPath,
        project_db_path: projectDbPath,
      });
      registry.close();

      const projectDb = new Database(projectDbPath, { readonly: true });
      expect(projectDb.prepare('SELECT id, repo_path FROM projects').get()).toEqual({
        id: 'project_legacy',
        repo_path: repoPath,
      });
      expect((projectDb.prepare('SELECT id FROM tasks').get() as { id: string }).id).toBe('task_legacy');
      expect((projectDb.prepare('SELECT id FROM task_claims').get() as { id: string }).id).toBe('claim_legacy');
      expect((projectDb.prepare('SELECT id FROM task_events').get() as { id: string }).id).toBe('event_legacy');
      expect((projectDb.prepare('SELECT id FROM task_verifications').get() as { id: string }).id).toBe('verification_legacy');
      projectDb.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails clearly before writing when a legacy project has no repo path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'local-agent-kanban-migrate-invalid-'));
    const legacyPath = join(directory, 'legacy.sqlite');
    const registryPath = join(directory, 'registry.sqlite');

    try {
      const legacy = new Database(legacyPath);
      legacy.exec(readFileSync(resolve('src/db/migrations/0000_phase2_sqlite_persistence.sql'), 'utf8'));
      legacy
        .prepare('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('project_missing_repo', 'Missing Repo', '', 1, 2);
      legacy.close();

      expect(() =>
        execFileSync(
          process.execPath,
          [resolve('node_modules/tsx/dist/cli.mjs'), resolve('tools/migrate-single-db-to-project-dbs.ts'), legacyPath, registryPath],
          { cwd: process.cwd(), stdio: 'pipe' },
        ),
      ).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('Phase 8 local data scripts', () => {
  it('sanity-checks registry and repository-local databases after migrations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'local-agent-kanban-phase8-check-'));
    const registryPath = join(directory, 'registry.sqlite');
    const repoPath = join(directory, 'repo');

    try {
      const service = createService(registryPath);
      const project = service.createProject({
        actor: { type: 'human', id: 'phase8-test' },
        name: 'Phase 8 Check',
        repoPath,
      });
      service.createTask({ actor: { type: 'human', id: 'phase8-test' }, projectId: project.id, title: 'Check migrations' });
      service.close();

      const output = execFileSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('tools/check-phase8.ts'), registryPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(output).toContain('Phase 8 database sanity check passed');
      expect(output).toContain('Registered projects checked: 1');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('exports the registry database and recovery manifest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'local-agent-kanban-phase8-backup-'));
    const registryPath = join(directory, 'registry.sqlite');
    const repoPath = join(directory, 'repo');
    const backupDirectory = join(directory, 'backups');

    try {
      const service = createService(registryPath);
      const project = service.createProject({
        actor: { type: 'human', id: 'phase8-test' },
        name: 'Phase 8 Backup',
        repoPath,
      });
      service.close();

      const output = execFileSync(
        process.execPath,
        [resolve('node_modules/tsx/dist/cli.mjs'), resolve('tools/backup-registry.ts'), registryPath, backupDirectory],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
        },
      );

      const sqlitePath = output.match(/Registry backup written: (.+\.sqlite)/)?.[1]?.trim();
      const manifestPath = output.match(/Registry manifest written: (.+\.json)/)?.[1]?.trim();
      expect(sqlitePath && existsSync(sqlitePath)).toBe(true);
      expect(manifestPath && existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(readFileSync(manifestPath!, 'utf8')) as { projects: Array<{ projectId: string }> };
      expect(manifest.projects.map((entry) => entry.projectId)).toContain(project.id);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function createService(registryPath: string) {
  return createSqliteKanbanService(registryPath);
}
