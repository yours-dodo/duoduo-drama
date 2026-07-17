import { Hono } from 'hono';

interface HealthResponse {
  service: 'agent';
  status: 'ok';
}

export const app = new Hono();

app.get('/health', (context) => {
  const response: HealthResponse = { service: 'agent', status: 'ok' };

  return context.json(response);
});
