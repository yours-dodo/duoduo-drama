import type { AgentEvent, AgentRunResult } from '../types.js';
import type { AgentHarnessEventPayload } from './types.js';

export function turnStatusForResult(
  result: AgentRunResult,
): 'completed' | 'failed' | 'cancelled' {
  if (result.status === 'completed') return 'completed';
  if (result.status === 'cancelled') return 'cancelled';
  return result.error.code === 'AGENT_MAX_TURNS' ? 'completed' : 'failed';
}

export function toHarnessPayload(event: AgentEvent): AgentHarnessEventPayload {
  const sanitized = sanitizePublicEventValue(event) as Record<string, unknown>;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(sanitized).filter(
        ([key]) => key !== 'sequence' && key !== 'turn',
      ),
    ),
  ) as unknown as AgentHarnessEventPayload;
}

function sanitizePublicEventValue(value: unknown): unknown {
  if (Array.isArray(value))
    return Object.freeze(value.map(sanitizePublicEventValue));
  if (typeof value !== 'object' || value === null) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      key === 'rawArguments' ||
      key === 'arguments' ||
      key === 'idempotencyKey'
    )
      continue;
    sanitized[key] =
      key === 'argumentsDelta' ? '' : sanitizePublicEventValue(item);
  }
  return Object.freeze(sanitized);
}
