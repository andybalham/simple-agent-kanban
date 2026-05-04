export const productInfo = {
  name: 'Local Agent Kanban',
  version: '0.1.0',
} as const;

export type ServiceName = 'http-api' | 'mcp' | 'test';

export type PingResponse = {
  ok: true;
  service: ServiceName;
  product: typeof productInfo.name;
  version: typeof productInfo.version;
};

export function createPingResponse(service: ServiceName): PingResponse {
  return {
    ok: true,
    service,
    product: productInfo.name,
    version: productInfo.version,
  };
}
