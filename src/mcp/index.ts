import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createPingResponse } from '../core/index.ts';

const server = new McpServer({
  name: 'local-agent-kanban',
  version: '0.1.0',
});

server.tool('ping', {}, async () => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(createPingResponse('mcp')),
    },
  ],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
