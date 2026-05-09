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

type ProjectContext = {
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
  updatedAt: string;
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
  metadata?: Record<string, unknown>;
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

type SidePanelMode = 'context' | 'create' | 'detail';

type ProjectContextFormState = {
  overviewMarkdown: string;
  agentInstructionsMarkdown: string;
  repoPath: string;
  defaultBranch: string;
  packageManager: string;
  installCommand: string;
  testCommand: string;
  buildCommand: string;
  lintCommand: string;
  codingConventionsMarkdown: string;
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

const emptyContextForm: ProjectContextFormState = {
  overviewMarkdown: '',
  agentInstructionsMarkdown: '',
  repoPath: '',
  defaultBranch: '',
  packageManager: '',
  installCommand: '',
  testCommand: '',
  buildCommand: '',
  lintCommand: '',
  codingConventionsMarkdown: '',
};

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);
  const [contextForm, setContextForm] = useState<ProjectContextFormState>(emptyContextForm);
  const [projectEvents, setProjectEvents] = useState<TaskEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [claims, setClaims] = useState<TaskClaim[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [sidePanelMode, setSidePanelMode] = useState<SidePanelMode>('context');
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(true);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [createForm, setCreateForm] = useState<TaskFormState>(emptyTaskForm);
  const [editForm, setEditForm] = useState<TaskFormState>(emptyTaskForm);
  const [completionForm, setCompletionForm] = useState<CompletionFormState>(emptyCompletionForm);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectRepoPath, setNewProjectRepoPath] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isBoardLoading, setIsBoardLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  // Claims are leases, not task statuses. The board keeps a separate claim
  // read model so stale work can be highlighted without moving cards between
  // columns or duplicating the service's workflow rules in React.
  const staleClaimIds = useMemo(() => new Set(claims.filter(isStaleClaim).map((claim) => claim.id)), [claims]);
  const activeClaims = useMemo(() => claims.filter((claim) => !isStaleClaim(claim)), [claims]);
  const staleClaims = useMemo(() => claims.filter(isStaleClaim), [claims]);
  const staleClaimsByTask = useMemo(() => groupClaimsByTask(claims.filter(isStaleClaim)), [claims]);
  const reviewTasks = useMemo(() => tasks.filter((task) => task.status === 'review'), [tasks]);
  const groomingTasks = useMemo(() => tasks.filter((task) => task.needsGrooming), [tasks]);
  const recentActivity = useMemo(() => [...projectEvents].slice(-12).reverse(), [projectEvents]);
  const contextEvents = useMemo(
    () => projectEvents.filter((event) => event.eventType === 'project.context_updated').slice(-3).reverse(),
    [projectEvents],
  );

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
    setIsBoardLoading(true);
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
    } finally {
      setIsBoardLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditingText =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (event.key === 'Escape' && selectedTaskId && !isEditingText) {
        setSelectedTaskId(null);
        setSidePanelMode('context');
      }
      if ((event.key === 'r' || event.key === 'R') && !isEditingText && selectedProjectId) {
        void refreshBoard(selectedProjectId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [refreshBoard, selectedProjectId, selectedTaskId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectContext(null);
      setContextForm(emptyContextForm);
      setProjectEvents([]);
      setTasks([]);
      setClaims([]);
      setSelectedTaskId(null);
      setSidePanelMode('context');
      setIsSidePanelOpen(true);
      return;
    }
    setSelectedTaskId(null);
    setSidePanelMode('context');
    setIsSidePanelOpen(true);
    void loadProjectContext(selectedProjectId);
    void loadProjectEvents(selectedProjectId);
    void refreshBoard(selectedProjectId);
  }, [selectedProjectId, refreshBoard]);

  useEffect(() => {
    if (!selectedTaskId) {
      setDetail(null);
      return;
    }
    setSidePanelMode('detail');
    setIsSidePanelOpen(true);
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

  async function loadProjectContext(projectId: string) {
    try {
      const data = await api<{ context: ProjectContext }>(`/api/projects/${projectId}/context`);
      setProjectContext(data.context);
      setContextForm(contextToForm(data.context));
    } catch (apiError) {
      setError(errorMessage(apiError));
    }
  }

  async function loadProjectEvents(projectId: string) {
    try {
      const data = await api<{ events: TaskEvent[] }>(`/api/projects/${projectId}/events`);
      setProjectEvents(data.events);
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
      const data = await api<{ task: Task }>(`/api/projects/${selectedProjectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ actor: humanActor, ...formToTaskPayload(createForm) }),
      });
      setCreateForm(emptyTaskForm);
      setSelectedTaskId(data.task.id);
      setSidePanelMode('detail');
      await refreshBoard();
      await loadProjectEvents(selectedProjectId);
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
      await loadProjectEvents(selectedProjectId);
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
      await loadProjectEvents(task.projectId);
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
      await loadProjectEvents(selectedProjectId);
      await loadTaskDetail(selectedTaskId);
    });
  }

  async function saveProjectContext(event: FormEvent) {
    event.preventDefault();
    if (!selectedProjectId) {
      return;
    }
    await mutate(async () => {
      const data = await api<{ context: ProjectContext }>(`/api/projects/${selectedProjectId}/context`, {
        method: 'PUT',
        body: JSON.stringify({ actor: humanActor, context: formToProjectContextPayload(contextForm) }),
      });
      setProjectContext(data.context);
      setContextForm(contextToForm(data.context));
      await loadProjectEvents(selectedProjectId);
    });
  }

  async function releaseClaim(claimId: string) {
    await mutate(async () => {
      await api(`/api/claims/${claimId}/release`, {
        method: 'POST',
        body: JSON.stringify({ actor: humanActor }),
      });
      await refreshBoard();
      await loadProjectEvents(selectedProjectId);
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

  function openCreateTaskPanel() {
    setSelectedTaskId(null);
    setSidePanelMode('create');
    setIsSidePanelOpen(true);
  }

  function openContextPanel() {
    setSidePanelMode('context');
    setIsSidePanelOpen(true);
  }

  function openTaskPanel(taskId: string) {
    setSelectedTaskId(taskId);
    setSidePanelMode('detail');
    setIsSidePanelOpen(true);
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
            <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)} disabled={projects.length === 0}>
              {projects.length === 0 && <option value="">No registered projects</option>}
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

      {error && (
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void recoverFromError()} disabled={isSaving}>
            Retry
          </button>
        </div>
      )}

      <section className="workspace" aria-label="Kanban workspace">
        <section className="board-surface" aria-label="Task board">
          <div className="board-header">
            <div>
              <h2>{selectedProject?.name ?? 'No project selected'}</h2>
              <p>{boardSubtitle(isLoading || isBoardLoading, projects.length, tasks.length, claims.filter(isStaleClaim).length)}</p>
              {selectedProject && <p className="project-path">{selectedProject.repoPath}</p>}
            </div>
            <div className="board-actions">
              <button type="button" onClick={openContextPanel} disabled={!selectedProjectId}>
                Context
              </button>
              <button type="button" onClick={openCreateTaskPanel} disabled={!selectedProjectId || isSaving}>
                New Task
              </button>
              <button type="button" onClick={() => void refreshBoard()} disabled={!selectedProjectId || isSaving || isBoardLoading}>
                {isBoardLoading ? 'Refreshing' : 'Refresh'}
              </button>
            </div>
          </div>

          {isLoading ? (
            <LoadingBoard />
          ) : projects.length === 0 ? (
            <EmptyProjectState onCreate={() => setIsCreatingProject(true)} />
          ) : (
            <>
              <OperationsConsole
                activeClaims={activeClaims}
                staleClaims={staleClaims}
                reviewTasks={reviewTasks}
                groomingTasks={groomingTasks}
                events={recentActivity}
                taskById={taskById}
                selectedTaskId={selectedTaskId}
                disabled={isSaving}
                onSelectTask={openTaskPanel}
                onReleaseClaim={(claimId) => void releaseClaim(claimId)}
              />

              <div className={isBoardLoading ? 'columns columns--loading' : 'columns'} aria-busy={isBoardLoading}>
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
                            onSelect={() => openTaskPanel(task.id)}
                            onMove={(status) => void moveTask(task, status)}
                          />
                        ))}
                        {columnTasks.length === 0 && <div className="empty-column">No tasks</div>}
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <aside className={isSidePanelOpen ? 'side-panel' : 'side-panel side-panel--closed'} aria-label="Task controls">
          <section className="panel-section panel-section--single">
            <div className="panel-toolbar">
              <div className="panel-toolbar__top">
                <div>
                  <span className="panel-toolbar__eyebrow">Workspace panel</span>
                  <h2>{panelTitle(sidePanelMode, selectedTask)}</h2>
                </div>
                <button type="button" className="panel-close" onClick={() => setIsSidePanelOpen(false)} aria-label="Close panel">
                  Close
                </button>
              </div>
              <div className="panel-tabs" role="tablist" aria-label="Panel mode">
                <button
                  type="button"
                  className={sidePanelMode === 'context' ? 'panel-tab panel-tab--active' : 'panel-tab'}
                  onClick={openContextPanel}
                >
                  Context
                </button>
                <button
                  type="button"
                  className={sidePanelMode === 'create' ? 'panel-tab panel-tab--active' : 'panel-tab'}
                  onClick={openCreateTaskPanel}
                  disabled={!selectedProjectId}
                >
                  Create
                </button>
                {selectedTask && (
                  <button
                    type="button"
                    className={sidePanelMode === 'detail' ? 'panel-tab panel-tab--active' : 'panel-tab'}
                    onClick={() => openTaskPanel(selectedTask.id)}
                  >
                    Detail
                  </button>
                )}
              </div>
            </div>

            <div className="panel-content">
              {sidePanelMode === 'context' && (
                <ProjectContextEditor
                  form={contextForm}
                  context={projectContext}
                  events={contextEvents}
                  disabled={!selectedProjectId || isSaving}
                  onChange={setContextForm}
                  onSubmit={saveProjectContext}
                />
              )}

              {sidePanelMode === 'create' && (
                <TaskForm
                  form={createForm}
                  submitLabel="Create Task"
                  includeStatus
                  disabled={!selectedProjectId || isSaving}
                  onChange={setCreateForm}
                  onSubmit={createTask}
                />
              )}

              {sidePanelMode === 'detail' &&
                (selectedTask ? (
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
                      <CompletionForm form={completionForm} disabled={isSaving} onChange={setCompletionForm} onSubmit={completeTask} />
                    )}
                    <TaskEvidence detail={detail} />
                  </>
                ) : (
                  <p className="panel-empty">Select a task to edit details, inspect evidence, or release a claim.</p>
                ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );

  async function recoverFromError() {
    if (selectedProjectId) {
      await Promise.all([refreshBoard(selectedProjectId), loadProjectContext(selectedProjectId), loadProjectEvents(selectedProjectId)]);
      return;
    }
    await loadProjects();
  }
}

function OperationsConsole({
  activeClaims,
  staleClaims,
  reviewTasks,
  groomingTasks,
  events,
  taskById,
  selectedTaskId,
  disabled,
  onSelectTask,
  onReleaseClaim,
}: {
  activeClaims: TaskClaim[];
  staleClaims: TaskClaim[];
  reviewTasks: Task[];
  groomingTasks: Task[];
  events: TaskEvent[];
  taskById: Map<string, Task>;
  selectedTaskId: string | null;
  disabled: boolean;
  onSelectTask: (taskId: string) => void;
  onReleaseClaim: (claimId: string) => void;
}) {
  return (
    <section className="operations-console" aria-label="Agent operations console">
      <div className="ops-strip" aria-label="Project operations summary">
        <MetricTile label="Review" value={reviewTasks.length} tone={reviewTasks.length > 0 ? 'attention' : 'neutral'} />
        <MetricTile label="Active claims" value={activeClaims.length} tone="good" />
        <MetricTile label="Stale claims" value={staleClaims.length} tone={staleClaims.length > 0 ? 'danger' : 'neutral'} />
        <MetricTile label="Needs grooming" value={groomingTasks.length} tone={groomingTasks.length > 0 ? 'attention' : 'neutral'} />
      </div>

      <div className="ops-grid">
        <section className="ops-panel" aria-label="Review queue">
          <PanelHeading title="Review Queue" count={reviewTasks.length} />
          <TaskQueue
            tasks={reviewTasks}
            selectedTaskId={selectedTaskId}
            emptyText="No tasks waiting for review."
            onSelectTask={onSelectTask}
          />
        </section>

        <section className="ops-panel" aria-label="Stale claims">
          <PanelHeading title="Stale Claims" count={staleClaims.length} />
          <ClaimQueue
            claims={staleClaims}
            taskById={taskById}
            tone="stale"
            emptyText="No expired leases."
            disabled={disabled}
            onSelectTask={onSelectTask}
            onReleaseClaim={onReleaseClaim}
          />
        </section>

        <section className="ops-panel" aria-label="Active claims">
          <PanelHeading title="Active Claims" count={activeClaims.length} />
          <ClaimQueue
            claims={activeClaims}
            taskById={taskById}
            tone="active"
            emptyText="No agents currently hold a lease."
            disabled={disabled}
            onSelectTask={onSelectTask}
            onReleaseClaim={onReleaseClaim}
          />
        </section>

        <section className="ops-panel" aria-label="Recent activity">
          <PanelHeading title="Activity" count={events.length} />
          <ActivityFeed events={events} taskById={taskById} onSelectTask={onSelectTask} />
        </section>
      </div>

      {groomingTasks.length > 0 && (
        <section className="grooming-band" aria-label="Tasks needing grooming">
          <PanelHeading title="Needs Grooming" count={groomingTasks.length} />
          <TaskQueue tasks={groomingTasks} selectedTaskId={selectedTaskId} emptyText="" onSelectTask={onSelectTask} compact />
        </section>
      )}
    </section>
  );
}

function LoadingBoard() {
  return (
    <div className="loading-board" aria-label="Loading board">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div className="loading-column" key={item}>
          <span />
          <strong />
          <p />
          <p />
        </div>
      ))}
    </div>
  );
}

function EmptyProjectState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="empty-state" aria-label="No registered projects">
      <h2>No registered projects</h2>
      <p>Create a local project database here, or register an existing repository through the HTTP API or MCP.</p>
      <button type="button" onClick={onCreate}>
        New Project
      </button>
    </section>
  );
}

function MetricTile({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'good' | 'attention' | 'danger' }) {
  return (
    <div className={`metric-tile metric-tile--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="panel-heading">
      <h3>{title}</h3>
      <span>{count}</span>
    </div>
  );
}

function TaskQueue({
  tasks,
  selectedTaskId,
  emptyText,
  compact = false,
  onSelectTask,
}: {
  tasks: Task[];
  selectedTaskId: string | null;
  emptyText: string;
  compact?: boolean;
  onSelectTask: (taskId: string) => void;
}) {
  if (tasks.length === 0) {
    return <p className="ops-empty">{emptyText}</p>;
  }

  return (
    <div className={compact ? 'task-queue task-queue--compact' : 'task-queue'}>
      {tasks.map((task) => (
        <button
          className={selectedTaskId === task.id ? 'queue-item queue-item--selected' : 'queue-item'}
          type="button"
          key={task.id}
          onClick={() => onSelectTask(task.id)}
        >
          <span className={`priority priority--${task.priority}`}>{task.priority}</span>
          <strong>{task.title}</strong>
          {task.needsGrooming && <span className="queue-note">agent-created</span>}
        </button>
      ))}
    </div>
  );
}

function ClaimQueue({
  claims,
  taskById,
  tone,
  emptyText,
  disabled,
  onSelectTask,
  onReleaseClaim,
}: {
  claims: TaskClaim[];
  taskById: Map<string, Task>;
  tone: 'active' | 'stale';
  emptyText: string;
  disabled: boolean;
  onSelectTask: (taskId: string) => void;
  onReleaseClaim: (claimId: string) => void;
}) {
  if (claims.length === 0) {
    return <p className="ops-empty">{emptyText}</p>;
  }

  return (
    <div className="claim-queue">
      {claims.map((claim) => {
        const task = taskById.get(claim.taskId);
        return (
          <div className={`claim-card claim-card--${tone}`} key={claim.id}>
            <button type="button" onClick={() => onSelectTask(claim.taskId)}>
              <strong>{task?.title ?? claim.taskId}</strong>
              <span>{claim.agentId}</span>
            </button>
            <div>
              <span>{tone === 'stale' ? `Expired ${relativeTime(claim.expiresAt)}` : `Heartbeat ${relativeTime(claim.lastHeartbeatAt)}`}</span>
              <button type="button" onClick={() => onReleaseClaim(claim.id)} disabled={disabled}>
                Release
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActivityFeed({
  events,
  taskById,
  onSelectTask,
}: {
  events: TaskEvent[];
  taskById: Map<string, Task>;
  onSelectTask: (taskId: string) => void;
}) {
  if (events.length === 0) {
    return <p className="ops-empty">No activity recorded yet.</p>;
  }

  return (
    <div className="activity-feed">
      {events.map((event) => {
        const task = event.taskId ? taskById.get(event.taskId) : null;
        return (
          <article className="activity-row" key={event.id}>
            <div>
              <span>{formatDateTime(event.createdAt)}</span>
              <strong>{event.message}</strong>
              <small>
                {event.eventType} by {event.actor.id}
              </small>
            </div>
            {event.taskId && (
              <button type="button" onClick={() => onSelectTask(event.taskId!)}>
                {task?.title ?? 'Open task'}
              </button>
            )}
          </article>
        );
      })}
    </div>
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

function ProjectContextEditor({
  form,
  context,
  events,
  disabled,
  onChange,
  onSubmit,
}: {
  form: ProjectContextFormState;
  context: ProjectContext | null;
  events: TaskEvent[];
  disabled: boolean;
  onChange: (form: ProjectContextFormState) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="context-form" onSubmit={onSubmit}>
      <label className="field">
        <span>Overview</span>
        <textarea
          value={form.overviewMarkdown}
          onChange={(event) => onChange({ ...form, overviewMarkdown: event.target.value })}
          placeholder="Markdown summary agents should read first"
          rows={4}
        />
      </label>
      <label className="field">
        <span>Agent Instructions</span>
        <textarea
          value={form.agentInstructionsMarkdown}
          onChange={(event) => onChange({ ...form, agentInstructionsMarkdown: event.target.value })}
          placeholder="Repository workflow, expectations, and limits"
          rows={4}
        />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Repo Path</span>
          <input value={form.repoPath} onChange={(event) => onChange({ ...form, repoPath: event.target.value })} />
        </label>
        <label className="field">
          <span>Default Branch</span>
          <input value={form.defaultBranch} onChange={(event) => onChange({ ...form, defaultBranch: event.target.value })} />
        </label>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Package Manager</span>
          <input value={form.packageManager} onChange={(event) => onChange({ ...form, packageManager: event.target.value })} />
        </label>
        <label className="field">
          <span>Install Command</span>
          <input value={form.installCommand} onChange={(event) => onChange({ ...form, installCommand: event.target.value })} />
        </label>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Test Command</span>
          <input value={form.testCommand} onChange={(event) => onChange({ ...form, testCommand: event.target.value })} />
        </label>
        <label className="field">
          <span>Build Command</span>
          <input value={form.buildCommand} onChange={(event) => onChange({ ...form, buildCommand: event.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>Lint Command</span>
        <input value={form.lintCommand} onChange={(event) => onChange({ ...form, lintCommand: event.target.value })} />
      </label>
      <label className="field">
        <span>Coding Conventions</span>
        <textarea
          value={form.codingConventionsMarkdown}
          onChange={(event) => onChange({ ...form, codingConventionsMarkdown: event.target.value })}
          placeholder="Markdown conventions agents should preserve"
          rows={4}
        />
      </label>
      <button type="submit" disabled={disabled}>
        Save Context
      </button>
      <AgentContextPreview context={context} />
      <ContextActivity events={events} />
    </form>
  );
}

function AgentContextPreview({ context }: { context: ProjectContext | null }) {
  if (!context) {
    return <p className="panel-empty">Select a project to preview agent context.</p>;
  }

  return (
    <div className="context-preview">
      <h3>Agent Preview</h3>
      <pre>{JSON.stringify(context, null, 2)}</pre>
    </div>
  );
}

function ContextActivity({ events }: { events: TaskEvent[] }) {
  return (
    <div className="context-activity">
      <h3>Context Activity</h3>
      {events.length === 0 ? (
        <p className="panel-empty">No context updates recorded yet.</p>
      ) : (
        events.map((event) => (
          <div className="event-row" key={event.id}>
            <span>{formatDateTime(event.createdAt)}</span>
            <strong>{event.message}</strong>
          </div>
        ))
      )}
    </div>
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
              <div>
                <strong>{artifact.kind}</strong>
                <span>{artifact.value}</span>
              </div>
              <small>
                {artifact.createdBy.id} | {formatDateTime(artifact.createdAt)}
              </small>
            </div>
          ))}
          {detail.verifications.map((verification) => (
            <div className="evidence-row" key={verification.id}>
              <div>
                <strong>verification</strong>
                <span>{verification.summary}</span>
                {verification.evidence.length > 0 && (
                  <ul>
                    {verification.evidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
              <small>
                {verification.createdBy.id} | {formatDateTime(verification.createdAt)}
              </small>
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
  const text = await response.text();
  let data: ({ ok: boolean; error?: { message: string; details?: string[] } } & T) | null = null;
  try {
    data = text ? (JSON.parse(text) as { ok: boolean; error?: { message: string; details?: string[] } } & T) : null;
  } catch {
    throw new Error(`Request returned non-JSON response (${response.status}). Confirm the local API is running on port 4000.`);
  }
  if (!response.ok || data?.ok === false) {
    const details = data?.error?.details?.length ? ` ${data.error.details.join(' ')}` : '';
    throw new Error(`${data?.error?.message ?? `Request failed with ${response.status}`}${details}`);
  }
  if (data === null) {
    throw new Error(`Request returned an empty response (${response.status}).`);
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

function contextToForm(context: ProjectContext): ProjectContextFormState {
  return {
    overviewMarkdown: context.overviewMarkdown,
    agentInstructionsMarkdown: context.agentInstructionsMarkdown,
    repoPath: context.repoPath ?? '',
    defaultBranch: context.defaultBranch ?? '',
    packageManager: context.packageManager ?? '',
    installCommand: context.installCommand ?? '',
    testCommand: context.testCommand ?? '',
    buildCommand: context.buildCommand ?? '',
    lintCommand: context.lintCommand ?? '',
    codingConventionsMarkdown: context.codingConventionsMarkdown,
  };
}

function formToProjectContextPayload(form: ProjectContextFormState): Omit<ProjectContext, 'projectId' | 'updatedAt'> {
  return {
    overviewMarkdown: form.overviewMarkdown,
    agentInstructionsMarkdown: form.agentInstructionsMarkdown,
    repoPath: nullableTrimmed(form.repoPath),
    defaultBranch: nullableTrimmed(form.defaultBranch),
    packageManager: nullableTrimmed(form.packageManager),
    installCommand: nullableTrimmed(form.installCommand),
    testCommand: nullableTrimmed(form.testCommand),
    buildCommand: nullableTrimmed(form.buildCommand),
    lintCommand: nullableTrimmed(form.lintCommand),
    codingConventionsMarkdown: form.codingConventionsMarkdown,
  };
}

function nullableTrimmed(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function panelTitle(mode: SidePanelMode, selectedTask: Task | null): string {
  if (mode === 'create') {
    return 'Create Task';
  }
  if (mode === 'detail') {
    return selectedTask?.title ?? 'Task Detail';
  }
  return 'Project Context';
}

function boardSubtitle(isLoading: boolean, projectCount: number, taskCount: number, staleCount: number): string {
  if (isLoading) {
    return 'Loading local board state from the HTTP API.';
  }
  if (projectCount === 0) {
    return 'No projects are registered in the local registry yet.';
  }
  if (taskCount === 0) {
    return 'No active tasks yet. Create one here or through MCP.';
  }
  return `${taskCount} active tasks, ${staleCount} stale claims.`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function relativeTime(value: string): string {
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const deltaMilliseconds = new Date(value).getTime() - Date.now();
  const deltaMinutes = Math.round(deltaMilliseconds / 60_000);
  if (Math.abs(deltaMinutes) < 60) {
    return formatter.format(deltaMinutes, 'minute');
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 48) {
    return formatter.format(deltaHours, 'hour');
  }
  return formatter.format(Math.round(deltaHours / 24), 'day');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
