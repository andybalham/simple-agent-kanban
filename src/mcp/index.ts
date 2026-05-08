import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createSqliteKanbanService } from '../db/index.ts';
import { createKanbanMcpServer } from './tools.ts';

const service = createSqliteKanbanService(process.env.LOCAL_AGENT_KANBAN_REGISTRY_DB, {
  seed: process.env.LOCAL_AGENT_KANBAN_SEED === 'true',
});
const server = createKanbanMcpServer(service);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGINT', () => {
  service.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  service.close();
  process.exit(0);
});
