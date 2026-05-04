import './App.css';

const columns = ['Backlog', 'Ready', 'In Progress', 'Blocked', 'Review', 'Done'] as const;

const phaseTasks = [
  {
    title: 'Phase 1 contract work',
    body: 'Define project, task, claim, event, artifact, and verification schemas.',
    tags: ['MCP first', 'Ready soon'],
  },
];

const activity = [
  ['HTTP API', 'Health endpoint ready at /api/health.'],
  ['MCP', 'Stdio entrypoint exposes a ping tool.'],
  ['Persistence', 'SQLite boundary reserved for Phase 2.'],
];

export function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__eyebrow">Personal local server</span>
          <h1 className="brand__name">Local Agent Kanban</h1>
        </div>
        <div className="status-strip" aria-label="Phase 0 status">
          <span className="status-pill">React shell</span>
          <span className="status-pill">Node API</span>
          <span className="status-pill">MCP ping</span>
        </div>
      </header>

      <section className="workspace" aria-label="Kanban workspace preview">
        <div className="board-preview">
          <div className="board-header">
            <div>
              <h2>Agent Work Board</h2>
              <p>The board surface is scaffolded. Task workflows arrive after the MCP contract.</p>
            </div>
          </div>

          <div className="columns">
            {columns.map((column) => (
              <section className="column" key={column} aria-label={`${column} column`}>
                <h2 className="column__title">
                  {column}
                  <span className="column__count">
                    {column === 'Ready' ? phaseTasks.length : 0}
                  </span>
                </h2>
                {column === 'Ready' &&
                  phaseTasks.map((task) => (
                    <article className="task-card" key={task.title}>
                      <h3>{task.title}</h3>
                      <p>{task.body}</p>
                      <div className="task-meta">
                        {task.tags.map((tag) => (
                          <span className="tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                        <span className="tag tag--alert">Needs schemas</span>
                      </div>
                    </article>
                  ))}
              </section>
            ))}
          </div>
        </div>

        <aside className="side-panel" aria-label="Foundation activity">
          <h2>Foundation</h2>
          <p>Phase 0 creates the paths the real product will travel.</p>
          <div className="activity-list">
            {activity.map(([title, description]) => (
              <div className="activity-item" key={title}>
                <strong>{title}</strong>
                <span>{description}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
