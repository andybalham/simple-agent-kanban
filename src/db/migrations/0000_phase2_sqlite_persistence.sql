PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_contexts (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  overview_markdown TEXT NOT NULL DEFAULT '',
  agent_instructions_markdown TEXT NOT NULL DEFAULT '',
  repo_path TEXT,
  default_branch TEXT,
  package_manager TEXT,
  install_command TEXT,
  test_command TEXT,
  build_command TEXT,
  lint_command TEXT,
  coding_conventions_markdown TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('backlog', 'ready', 'in_progress', 'blocked', 'review', 'done', 'archived')),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  labels_json TEXT NOT NULL DEFAULT '[]',
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('agent', 'human', 'system')),
  created_by_id TEXT NOT NULL,
  needs_grooming INTEGER NOT NULL CHECK (needs_grooming IN (0, 1)),
  dependency_status TEXT NOT NULL CHECK (dependency_status IN ('unblocked', 'blocked_by_tasks', 'blocked_external')),
  source_task_id TEXT,
  split_reason TEXT,
  completed_at INTEGER,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('agent', 'human', 'system')),
  created_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS task_claims (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL,
  released_at INTEGER
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'human', 'system')),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'branch', 'commit', 'test', 'build', 'lint', 'link', 'note')),
  value TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('agent', 'human', 'system')),
  created_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_verifications (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('agent', 'human', 'system')),
  created_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS task_project_status_idx ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS task_dependencies_task_idx ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS task_dependencies_depends_on_idx ON task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS task_claims_task_idx ON task_claims(task_id);
CREATE INDEX IF NOT EXISTS task_events_project_created_idx ON task_events(project_id, created_at);
