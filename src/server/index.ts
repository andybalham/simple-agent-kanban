import { createSqliteKanbanService } from '../db/index.ts';
import { createHttpServer } from './httpServer.ts';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4000);

const service = createSqliteKanbanService(process.env.LOCAL_AGENT_KANBAN_REGISTRY_DB, {
  seed: process.env.LOCAL_AGENT_KANBAN_SEED === 'true',
});
const server = createHttpServer(service);

server.listen(port, host, () => {
  console.log(`Local Agent Kanban API listening at http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      service.close();
      process.exit(0);
    });
  });
}
