import { AgentError } from '../errors.js';
import type { AgentHarnessEvent, ReadAgentEventsQuery } from './types.js';

interface EventCursorPayload {
  readonly version: 1;
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly sequence: number;
}

export function encodeEventCursor(
  query: ReadAgentEventsQuery,
  event: AgentHarnessEvent,
): string {
  const payload: EventCursorPayload = {
    version: 1,
    tenantId: query.tenantId,
    projectId: query.projectId,
    taskId: query.taskId,
    runId: query.runId,
    sequence: event.sequence,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeEventCursor(
  query: ReadAgentEventsQuery,
  cursor: string,
): number {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (!isCursorPayload(value) || !matchesQuery(value, query))
      throw new TypeError('Event cursor does not match query');
    return value.sequence;
  } catch (cause) {
    throw new AgentError(
      'AGENT_CURSOR_INVALID',
      'Agent event cursor is invalid',
      {
        cause,
      },
    );
  }
}

function isCursorPayload(value: unknown): value is EventCursorPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Partial<EventCursorPayload>;
  return (
    payload.version === 1 &&
    typeof payload.tenantId === 'string' &&
    typeof payload.projectId === 'string' &&
    typeof payload.taskId === 'string' &&
    typeof payload.runId === 'string' &&
    Number.isInteger(payload.sequence) &&
    Number(payload.sequence) >= 0
  );
}

function matchesQuery(
  payload: EventCursorPayload,
  query: ReadAgentEventsQuery,
): boolean {
  return (
    payload.tenantId === query.tenantId &&
    payload.projectId === query.projectId &&
    payload.taskId === query.taskId &&
    payload.runId === query.runId
  );
}
