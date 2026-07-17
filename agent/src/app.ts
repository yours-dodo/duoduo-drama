import type { HealthResponse } from '@duoduo/contracts';
import { Hono } from 'hono';

export const app = new Hono();

app.get('/health', (context) => {
  const response: HealthResponse = { service: 'agent', status: 'ok' };

  return context.json(response);
});
