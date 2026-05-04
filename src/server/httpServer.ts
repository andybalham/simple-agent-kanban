import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { createPingResponse } from '../core/index.ts';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
};

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, jsonHeaders);
  response.end(JSON.stringify(body));
}

function notFound(request: IncomingMessage, response: ServerResponse): void {
  sendJson(response, 404, {
    ok: false,
    error: 'not_found',
    path: request.url,
  });
}

export function createHttpServer() {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, createPingResponse('http-api'));
      return;
    }

    if (request.method === 'GET' && request.url === '/api/health') {
      sendJson(response, 200, createPingResponse('http-api'));
      return;
    }

    notFound(request, response);
  });
}
