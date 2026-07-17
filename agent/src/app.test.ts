import { describe, expect, it } from 'vitest';

import { app } from './app.js';

describe('agent health endpoint', () => {
  it('reports agent health', async () => {
    const response = await app.request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: 'agent',
      status: 'ok',
    });
  });
});
