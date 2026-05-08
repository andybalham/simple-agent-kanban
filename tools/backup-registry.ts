import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

type RegistryProjectExport = {
  projectId: string;
  name: string;
  description: string;
  repoPath: string;
  projectDbPath: string;
  lifecycleStatus: string;
  registeredAt: number;
  lastOpenedAt: number | null;
  updatedAt: number;
};

const registryPath = resolve(process.argv[2] ?? process.env.LOCAL_AGENT_KANBAN_REGISTRY_DB ?? './local-agent-kanban-registry.sqlite');
const outputDirectory = resolve(process.argv[3] ?? './backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = join(outputDirectory, `${basename(registryPath, '.sqlite')}-${timestamp}.sqlite`);
const manifestPath = join(outputDirectory, `${basename(registryPath, '.sqlite')}-${timestamp}.json`);

mkdirSync(outputDirectory, { recursive: true });

const registry = new Database(registryPath, { readonly: true, fileMustExist: true });
try {
  assertQuickCheck(registry, registryPath);
  await registry.backup(backupPath);
  const projects = registry
    .prepare(
      `
        SELECT
          project_id AS projectId,
          name,
          description,
          repo_path AS repoPath,
          project_db_path AS projectDbPath,
          lifecycle_status AS lifecycleStatus,
          registered_at AS registeredAt,
          last_opened_at AS lastOpenedAt,
          updated_at AS updatedAt
        FROM project_registry
        ORDER BY registered_at
      `,
    )
    .all() as RegistryProjectExport[];

  // The JSON manifest is an export aid for recovery: it names every registered
  // project database, while the SQLite file remains the exact registry backup.
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        registryPath,
        backupPath,
        projects,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  registry.close();
}

console.log(`Registry backup written: ${backupPath}`);
console.log(`Registry manifest written: ${manifestPath}`);

function assertQuickCheck(database: Database.Database, label: string): void {
  const result = database.pragma('quick_check') as Array<{ quick_check: string }>;
  if (result[0]?.quick_check !== 'ok') {
    throw new Error(`SQLite quick_check failed for ${label}: ${JSON.stringify(result)}`);
  }
}
