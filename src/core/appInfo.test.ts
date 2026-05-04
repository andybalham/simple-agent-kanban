import { describe, expect, it } from 'vitest';

import { createPingResponse, productInfo } from './index.ts';

describe('core app info', () => {
  it('creates a stable ping response', () => {
    expect(createPingResponse('test')).toEqual({
      ok: true,
      service: 'test',
      product: productInfo.name,
      version: productInfo.version,
    });
  });
});
