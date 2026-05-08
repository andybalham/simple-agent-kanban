PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project_registry (
  project_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  repo_path TEXT NOT NULL,
  project_db_path TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'completed')),
  registered_at INTEGER NOT NULL,
  last_opened_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS project_registry_repo_path_idx ON project_registry(repo_path);
CREATE INDEX IF NOT EXISTS project_registry_lifecycle_idx ON project_registry(lifecycle_status);
