import { requestJson } from './http-client';

export interface SessionSnapshot {
  user: { id: string; email: string };
  session: { expiresAt: string };
  teams: Array<{ id: string; name: string; role: string }>;
}

export function getSession(): Promise<SessionSnapshot> {
  return requestJson<SessionSnapshot>('v1/me');
}
