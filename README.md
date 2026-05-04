# Local Agent Kanban

A personal, local-first Kanban console for trusted coding agents.

## Phase 0

This repository is scaffolded with:

- React and Vite web app shell.
- Node HTTP API shell with `/health` and `/api/health`.
- MCP stdio entrypoint with a `ping` tool.
- Shared `src/core` and `src/db` boundaries.
- TypeScript, ESLint, Prettier, and Vitest configuration.
- Local environment example in `.env.example`.

## Local Setup

Install dependencies:

```bash
npm install
```

Run the local web app and API:

```bash
npm run dev
```

Run the MCP server entrypoint:

```bash
npm run dev:mcp
```

Run checks:

```bash
npm run lint
npm run test
npm run build
```

Run the dependency-free Phase 0 scaffold check:

```bash
npm run check:phase0
```

## Ports

- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:4000`
- Health: `http://127.0.0.1:4000/health`
