import { AgentError } from '../errors.js';
import type { AgentApprovalSnapshot } from './runtime-store.js';
import type { ReadAgentApprovalsQuery } from './types.js';

interface ApprovalCursorPayload {
  readonly version: 1;
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly proposalSequence: number;
}

export function encodeApprovalCursor(
  query: ReadAgentApprovalsQuery,
  approval: AgentApprovalSnapshot,
): string {
  const payload: ApprovalCursorPayload = {
    version: 1,
    tenantId: query.tenantId,
    projectId: query.projectId,
    taskId: query.taskId,
    runId: query.runId,
    proposalSequence: approval.proposalSequence,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeApprovalCursor(
  query: ReadAgentApprovalsQuery,
  cursor: string,
): number {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (!isCursorPayload(value) || !matchesQuery(value, query))
      throw new TypeError('Approval cursor does not match query');
    return value.proposalSequence;
  } catch (cause) {
    throw new AgentError(
      'AGENT_CURSOR_INVALID',
      'Agent Approval cursor is invalid',
      { cause },
    );
  }
}

function isCursorPayload(value: unknown): value is ApprovalCursorPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Partial<ApprovalCursorPayload>;
  return (
    payload.version === 1 &&
    typeof payload.tenantId === 'string' &&
    typeof payload.projectId === 'string' &&
    typeof payload.taskId === 'string' &&
    typeof payload.runId === 'string' &&
    Number.isInteger(payload.proposalSequence) &&
    Number(payload.proposalSequence) >= 0
  );
}

function matchesQuery(
  payload: ApprovalCursorPayload,
  query: ReadAgentApprovalsQuery,
): boolean {
  return (
    payload.tenantId === query.tenantId &&
    payload.projectId === query.projectId &&
    payload.taskId === query.taskId &&
    payload.runId === query.runId
  );
}
