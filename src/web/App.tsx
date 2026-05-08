import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import './App.css';

type Actor = { type: 'human' | 'agent' | 'system'; id: string };
type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'blocked' | 'review' | 'done' | 'archived';
type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

type Project = {
  id: string;
  name: string;
  description: string;
  repoPath: string;
  projectDbPath: string;
  lifecycleStatus: 'active' | 'completed';
};

type TaskClaim = {
  id: string;
  taskId: string;
  agentId: string;
  claimedAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
  releasedAt: string | null;
};

type Task = {
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
  dependencyStatus: 'unblocked' | 'blocked_by_tasks' | 'blocked_external';
  prerequisiteTaskIds: string[];
  dependentTaskIds: string[];
  blockingPrerequisites: Array<{ id: string; title: string; status: TaskStatus }>;
  activeClaim: TaskClaim | null;
  isClaimable: boolean;
  updatedAt: string;
};

type TaskEvent = {
  id: string;
  taskId: string | null;
  actor: Actor;
  eventType: string;
  message: string;
  createdAt: string;
};

type TaskArtifact = {
  id: string;
  kind: string;
  value: string;
  createdBy: Actor;
  createdAt: string;
};

type TaskVerification = {
  id: string;
  summary: string;
  evidence: string[];
  createdBy: Actor;
  createdAt: string;
};

type TaskDetail = {
  task: Task;
  artifacts: TaskArtifact[];
  verifications: TaskVerification[];
  events: TaskEvent[];
};

type TaskFormState = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  labels: string;
  acceptanceCriteria: string;
  needsGrooming: boolean;
};

type CompletionFormState = {
  summary: string;
  evidence: string;
};

const columns: Array<{ status: TaskStatus; label: string }> = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'ready', label: 'Ready' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
];

const priorities: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const movableStatuses: TaskStatus[] = ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'archived'];
const humanActor: Actor = { type: 'human', id: 'local-ui' };

const emptyTaskForm: TaskFormState = {
  title: '',
  description: '',
  status: 'backlog',
  priority: 'medium',
  labels: '',
  acceptanceCriteria: '',
  needsGrooming: false,
};

const emptyCompletionForm: CompletionFormState = {
  summary: '',
  evidence: '',
};

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [claims, setClaims] = useState<TaskClaim[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [createForm, setCreateForm] = useState<TaskFormState>(emptyTaskForm);
  const [editForm, setEditForm] = useState<TaskFormState>(emptyTaskForm);
  const [completionForm, setCompletionForm] = useState<CompletionFormState>(emptyCompletionForm);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectRepoPath, setNewProjectRepoPath] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  // Claims are leases, not task statuses. The board keeps a separate claim
  // read model so stale work can be highlighted without moving cards between
  // columns or duplicating the service's workflow rules in React.
  const staleClaimIds = useMemo(() => new Set(claims.filter(isStaleClaim).map((claim) => claim.id)), [claims]);
  const staleClaimsByTask = useMemo(() => groupClaimsByTask(claims.filter(isStaleClaim)), [claims]);

  useEffect(() => {
    void loadProjects();
  }, []);

  async function loadProjects() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api<{ projects: Project[] }>('/api/projects');
      setProjects(data.projects);
      setSelectedProjectId((current) => current || data.projects[0]?.id || '');
    } catch (apiError) {
      setError(errorMessage(apiError));
    } finally {
      setIsLoading(false);
    }
  }

  const refreshBoard = useCallback(async (projectId = selectedProjectId) => {
    if (!projectId) {
      return;
    }
    setError(null);
    try {
      const [taskData, claimData] = await Promise.all([
        api<{ tasks: Task[] }>(`/api/projects/${projectId}/tasks`),
        api<{ claims: TaskClaim[] }>(`/api/projects/${projectId}/claims?state=all`),
      ]);
      // Archived tasks are still durable history, but Phase 5's board is the
      // active control surface. Split originals therefore stay out of columns
      // while the HTTP/MCP services remain the source of truth.
      setTasks(taskData.tasks.filter((task) => task.status !== 'archived'));
      setClaims(claimData.claims.filter((claim) => claim.releasedAt === null));
    } catch (apiError) {
      setError(errorMessage(apiError));
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setTasks([]);
      setClaims([]);
      return;
    }
    void refreshBoard(selectedProjectId);
  }, [selectedProjectId, refreshBoard]);

  useEffect(() => {
    if (!selectedTaskId) {
      setDetail(null);
      return;
    }
    void loadTaskDetail(selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedTask) {
      return;
    }
    setEditForm(taskToForm(selectedTask));
    setCompletionForm(emptyCompletionForm);
  }, [selectedTask]);

  async function loadTaskDetail(taskId: string) {
    try {
      const data = await api<TaskDetail>(`/api/tasks/${taskId}`);
      setDetail(data);
    } catch (apiError) {
      setError(errorMessage(apiError));
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!newProjectName.trim() || !newProjectRepoPath.trim()) {
      return;
    }
    await mutate(async () => {
      const data = await api<{ project: Project }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ actor: humanActor, name: newProjectName, repoPath: newProjectRepoPath }),
      });
      setProjects((current) => [...current, data.project]);
      setSelectedProjectId(data.project.id);
      setNewProjectName('');
      setNewProjectRepoPath('');
      setIsCreatingProject(false);
    });
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!selectedProjectId || !createForm.title.trim()) {
      return;
    }
    await mutate(async () => {
      await api(`/api/projects/${selectedProjectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ actor: humanActor, ...formToTaskPayload(createForm) }),
      });
      setCreateForm(emptyTaskForm);
      await refreshBoard();
    });
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault();
    if (!selectedTaskId || !editForm.title.trim()) {
      return;
    }
    await mutate(async () => {
      const taskPayload = formToTaskPayload(editForm);
      await api(`/api/tasks/${selectedTaskId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          actor: humanActor,
          task: {
            title: taskPayload.title,
            description: taskPayload.description,
            priority: taskPayload.priority,
            labels: taskPayload.labels,
            acceptanceCriteria: taskPayload.acceptanceCriteria,
            needsGrooming: taskPayload.needsGrooming,
          },
        }),
      });
      await refreshBoard();
      await loadTaskDetail(selectedTaskId);
    });
  }

  async function moveTask(task: Task, status: TaskStatus) {
    if (status === task.status) {
      return;
    }
    await mutate(async () => {
      await api(`/api/tasks/${task.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ actor: humanActor, status }),
      });
      await refreshBoard();
      if (selectedTaskId === task.id) {
        await loadTaskDetail(task.id);
      }
    });
  }

  async function completeTask(event: FormEvent) {
    event.preventDefault();
    if (!selectedTaskId || !completionForm.summary.trim()) {
      return;
    }
    await mutate(async () => {
      await api(`/api/tasks/${selectedTaskId}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          actor: humanActor,
          summary: completionForm.summary.trim(),
          evidence: splitLines(completionForm.evidence),
        }),
      });
      setCompletionForm(emptyCompletionForm);
      await refreshBoard();
      await loadTaskDetail(selectedTaskId);
    });
  }

  async function releaseClaim(claimId: string) {
    await mutate(async () => {
      await api(`/api/claims/${claimId}/release`, {
        method: 'POST',
        body: JSON.stringify({ actor: humanActor }),
      });
      await refreshBoard();
      if (selectedTaskId) {
        await loadTaskDetail(selectedTaskId);
      }
    });
  }

  async function mutate(work: () => Promise<void>) {
    setIsSaving(true);
    setError(null);
    try {
      await work();
    } catch (apiError) {
      setError(errorMessage(apiError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__eyebrow">Local agent console</span>
          <h1 className="brand__name">Local Agent Kanban</h1>
        </div>

        <div className="project-tools">
          <label className="field field--inline">
            <span>Project</span>
            <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setIsCreatingProject((value) => !value)}>
            New Project
          </button>
        </div>
      </header>

      {isCreatingProject && (
        <form className="project-create" onSubmit={createProject}>
          <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Project name" />
          <input
            value={newProjectRepoPath}
            onChange={(event) => setNewProjectRepoPath(event.target.value)}
            placeholder="Repository path"
          />
          <button type="submit" disabled={isSaving}>
            Create
          </button>
        </form>
      )}

      {error && <div className="notice notice--error">{error}</div>}

      <section className="workspace" aria-label="Kanban workspace">
        <section className="board-surface" aria-label="Task board">
          <div className="board-header">
            <div>
              <h2>{selectedProject?.name ?? 'No project selected'}</h2>
              <p>{boardSubtitle(isLoading, tasks.length, claims.filter(isStaleClaim).length)}</p>
              {selectedProject && <p className="project-path">{selectedProject.repoPath}</p>}
            </div>
            <button type="button" onClick={() => void refreshBoard()} disabled={!selectedProjectId || isSaving}>
              Refresh
            </button>
          </div>

          <div className="columns">
            {columns.map((column) => {
              const columnTasks = tasks.filter((task) => task.status === column.status);
              return (
                <section className="column" key={column.status} aria-label={`${column.label} column`}>
                  <h2 className="column__title">
                    {column.label}
                    <span className="column__count">{columnTasks.length}</span>
                  </h2>
                  <div className="column__body">
                    {columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        staleClaims={staleClaimsByTask.get(task.id) ?? []}
                        isSelected={task.id === selectedTaskId}
                        onSelect={() => setSelectedTaskId(task.id)}
                        onMove={(status) => void moveTask(task, status)}
                      />
                    ))}
                    {columnTasks.length === 0 && <div className="empty-column">No tasks</div>}
                  </div>
                </section>
              );
            })}
          </div>
        </section>

        <aside className="side-panel" aria-label="Task controls">
          <section className="panel-section">
            <h2>Create Task</h2>
            <TaskForm
              form={createForm}
              submitLabel="Create Task"
              includeStatus
              disabled={!selectedProjectId || isSaving}
              onChange={setCreateForm}
              onSubmit={createTask}
            />
          </section>

          <section className="panel-section">
            <h2>Task Detail</h2>
            {selectedTask ? (
              <>
                <TaskForm form={editForm} submitLabel="Save Task" disabled={isSaving} onChange={setEditForm} onSubmit={saveTask} />
                <TaskRelations task={selectedTask} />
                <div className="claim-list">
                  {[selectedTask.activeClaim, ...(staleClaimsByTask.get(selectedTask.id) ?? [])].filter(isTaskClaim).map((claim) => (
                    <div className={staleClaimIds.has(claim.id) ? 'claim-row claim-row--stale' : 'claim-row'} key={claim.id}>
                      <div>
                        <strong>{claim.agentId}</strong>
                        <span>{staleClaimIds.has(claim.id) ? 'Stale claim' : 'Active claim'}</span>
                      </div>
                      <button type="button" onClick={() => void releaseClaim(claim.id)} disabled={isSaving}>
                        Release
                      </button>
                    </div>
                  ))}
                </div>
                {selectedTask.status !== 'done' && selectedTask.status !== 'archived' && (
                  <CompletionForm
                    form={completionForm}
                    disabled={isSaving}
                    onChange={setCompletionForm}
                    onSubmit={completeTask}
                  />
                )}
                <TaskEvidence detail={detail} />
              </>
            ) : (
              <p className="panel-empty">Select a task to edit details, inspect evidence, or release a claim.</p>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}

function TaskCard({
  task,
  staleClaims,
  isSelected,
  onSelect,
  onMove,
}: {
  task: Task;
  staleClaims: TaskClaim[];
  isSelected: boolean;
  onSelect: () => void;
  onMove: (status: TaskStatus) => void;
}) {
  return (
    <article className={isSelected ? 'task-card task-card--selected' : 'task-card'}>
      <button className="task-card__main" type="button" onClick={onSelect}>
        <div className="task-card__topline">
          <span className={`priority priority--${task.priority}`}>{task.priority}</span>
          {task.needsGrooming && <span className="flag flag--grooming">Needs grooming</span>}
          {staleClaims.length > 0 && <span className="flag flag--stale">Stale</span>}
        </div>
        <h3>{task.title}</h3>
        {task.description && <p>{task.description}</p>}
        <div className="task-meta">
          {task.labels.map((label) => (
            <span className="tag" key={label}>
              {label}
            </span>
          ))}
          {task.activeClaim && <span className="tag tag--claim">Claimed: {task.activeClaim.agentId}</span>}
          {task.blockingPrerequisites.length > 0 && <span className="tag tag--blocked">Blocked by {task.blockingPrerequisites.length}</span>}
        </div>
      </button>
      <label className="move-control">
        <span>Move</span>
        <select value={task.status} onChange={(event) => onMove(event.target.value as TaskStatus)}>
          {movableStatuses.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
          {task.status === 'done' && <option value="done">Done</option>}
        </select>
      </label>
    </article>
  );
}

function TaskRelations({ task }: { task: Task }) {
  return (
    <div className="relation-panel" aria-label="Task dependency context">
      <div>
        <span>Prerequisites</span>
        <strong>{task.prerequisiteTaskIds.length}</strong>
      </div>
      <div>
        <span>Dependents</span>
        <strong>{task.dependentTaskIds.length}</strong>
      </div>
      <div>
        <span>Claimable</span>
        <strong>{task.isClaimable ? 'Yes' : 'No'}</strong>
      </div>
      {task.blockingPrerequisites.length > 0 && (
        <div className="relation-panel__wide">
          <span>Blocking</span>
          <strong>{task.blockingPrerequisites.map((prerequisite) => prerequisite.title).join(', ')}</strong>
        </div>
      )}
    </div>
  );
}

function TaskForm({
  form,
  submitLabel,
  includeStatus = false,
  disabled,
  onChange,
  onSubmit,
}: {
  form: TaskFormState;
  submitLabel: string;
  includeStatus?: boolean;
  disabled: boolean;
  onChange: (form: TaskFormState) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="task-form" onSubmit={onSubmit}>
      <label className="field">
        <span>Title</span>
        <input value={form.title} onChange={(event) => onChange({ ...form, title: event.target.value })} />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} rows={3} />
      </label>
      <div className="form-grid">
        {includeStatus && (
          <label className="field">
            <span>Status</span>
            <select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as TaskStatus })}>
              {columns.map((column) => (
                <option key={column.status} value={column.status}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Priority</span>
          <select value={form.priority} onChange={(event) => onChange({ ...form, priority: event.target.value as TaskPriority })}>
            {priorities.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Labels</span>
        <input value={form.labels} onChange={(event) => onChange({ ...form, labels: event.target.value })} placeholder="frontend, bug" />
      </label>
      <label className="field">
        <span>Acceptance</span>
        <textarea
          value={form.acceptanceCriteria}
          onChange={(event) => onChange({ ...form, acceptanceCriteria: event.target.value })}
          placeholder="One acceptance criterion per line"
          rows={3}
        />
      </label>
      <label className="check-field">
        <input
          type="checkbox"
          checked={form.needsGrooming}
          onChange={(event) => onChange({ ...form, needsGrooming: event.target.checked })}
        />
        <span>Needs grooming</span>
      </label>
      <button type="submit" disabled={disabled}>
        {submitLabel}
      </button>
    </form>
  );
}

function CompletionForm({
  form,
  disabled,
  onChange,
  onSubmit,
}: {
  form: CompletionFormState;
  disabled: boolean;
  onChange: (form: CompletionFormState) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="completion-form" onSubmit={onSubmit}>
      <h3>Complete Task</h3>
      <label className="field">
        <span>Summary</span>
        <textarea value={form.summary} onChange={(event) => onChange({ ...form, summary: event.target.value })} rows={3} />
      </label>
      <label className="field">
        <span>Verification</span>
        <textarea
          value={form.evidence}
          onChange={(event) => onChange({ ...form, evidence: event.target.value })}
          placeholder="One verification result per line"
          rows={3}
        />
      </label>
      <button type="submit" disabled={disabled || !form.summary.trim()}>
        Complete
      </button>
    </form>
  );
}

function TaskEvidence({ detail }: { detail: TaskDetail | null }) {
  if (!detail) {
    return <p className="panel-empty">Loading task detail...</p>;
  }

  return (
    <div className="evidence">
      <h3>Evidence</h3>
      {detail.artifacts.length === 0 && detail.verifications.length === 0 ? (
        <p className="panel-empty">No artifacts or verification recorded yet.</p>
      ) : (
        <>
          {detail.artifacts.map((artifact) => (
            <div className="evidence-row" key={artifact.id}>
              <strong>{artifact.kind}</strong>
              <span>{artifact.value}</span>
            </div>
          ))}
          {detail.verifications.map((verification) => (
            <div className="evidence-row" key={verification.id}>
              <strong>verification</strong>
              <span>{verification.summary}</span>
            </div>
          ))}
        </>
      )}
      <h3>Recent Events</h3>
      <div className="event-list">
        {detail.events.slice(-5).map((event) => (
          <div className="event-row" key={event.id}>
            <span>{event.eventType}</span>
            <strong>{event.message}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // The Vite dev server proxies /api to the local Node server. Keeping this
  // helper small and fetch-based makes the architectural boundary visible:
  // React renders workflow state, while HTTP/core services decide validity.
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const data = (await response.json()) as { ok: boolean; error?: { message: string } } & T;
  if (!response.ok || data.ok === false) {
    throw new Error(data.error?.message ?? `Request failed with ${response.status}`);
  }
  return data;
}

function formToTaskPayload(form: TaskFormState) {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    status: form.status,
    priority: form.priority,
    labels: splitLinesOrCommas(form.labels),
    acceptanceCriteria: splitLines(form.acceptanceCriteria),
    needsGrooming: form.needsGrooming,
  };
}

function taskToForm(task: Task): TaskFormState {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    labels: task.labels.join(', '),
    acceptanceCriteria: task.acceptanceCriteria.join('\n'),
    needsGrooming: task.needsGrooming,
  };
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLinesOrCommas(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isStaleClaim(claim: TaskClaim): boolean {
  return claim.releasedAt === null && new Date(claim.expiresAt).getTime() <= Date.now();
}

function isTaskClaim(claim: TaskClaim | null): claim is TaskClaim {
  return claim !== null;
}

function groupClaimsByTask(claims: TaskClaim[]): Map<string, TaskClaim[]> {
  const grouped = new Map<string, TaskClaim[]>();
  for (const claim of claims) {
    grouped.set(claim.taskId, [...(grouped.get(claim.taskId) ?? []), claim]);
  }
  return grouped;
}

function statusLabel(status: TaskStatus): string {
  return columns.find((column) => column.status === status)?.label ?? status;
}

function boardSubtitle(isLoading: boolean, taskCount: number, staleCount: number): string {
  if (isLoading) {
    return 'Loading local board state from the HTTP API.';
  }
  if (taskCount === 0) {
    return 'No active tasks yet. Create one here or through MCP.';
  }
  return `${taskCount} active tasks, ${staleCount} stale claims.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
