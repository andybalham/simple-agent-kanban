import { createHttpServer } from './httpServer.ts';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4000);

const server = createHttpServer();

server.listen(port, host, () => {
  console.log(`Local Agent Kanban API listening at http://${host}:${port}`);
});
