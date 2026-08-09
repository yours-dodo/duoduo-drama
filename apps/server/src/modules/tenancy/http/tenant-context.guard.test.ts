import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { SessionRepository } from '../../identity/ports/session-repository.js';
import {
  SessionAuthGuard,
  SESSION_COOKIE_NAME,
} from '../../identity/http/session-auth.guard.js';
import type { TeamMembershipRepository } from '../ports/team-membership-repository.js';
import {
  readTenantContext,
  TenantContextGuard,
} from './tenant-context.guard.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';

describe('TenantContextGuard', () => {
  it('builds immutable tenant context from the path and active membership', async () => {
    const request = {
      cookies: { [SESSION_COOKIE_NAME]: 'session-token' },
      params: { teamId: TEAM_ID },
    };
    const executionContext = contextFor(request);
    await authenticate(executionContext);
    const memberships = membershipRepository({
      id: 'membership-id',
      tenantId: TEAM_ID,
      userId: 'user-id',
      role: 'admin',
      joinedAt: new Date('2026-08-10T00:00:00.000Z'),
      removedAt: null,
    });
    const guard = new TenantContextGuard(memberships);

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);

    expect(memberships.findActive).toHaveBeenCalledWith({
      tenantId: TEAM_ID,
      userId: 'user-id',
    });
    const tenant = readTenantContext(request);
    expect(tenant).toEqual({
      tenantId: TEAM_ID,
      membershipId: 'membership-id',
      userId: 'user-id',
      role: 'admin',
    });
    expect(Object.isFrozen(tenant)).toBe(true);
  });

  it.each([
    { teamId: 'not-a-uuid', membership: null },
    { teamId: TEAM_ID, membership: null },
  ])(
    'hides an invalid or inaccessible tenant as not found',
    async ({ teamId, membership }) => {
      const request = {
        cookies: { [SESSION_COOKIE_NAME]: 'session-token' },
        params: { teamId },
      };
      const executionContext = contextFor(request);
      await authenticate(executionContext);
      const memberships = membershipRepository(membership);
      const guard = new TenantContextGuard(memberships);

      await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
        code: 'TEAM_NOT_FOUND',
        statusCode: 404,
      });
      if (teamId === 'not-a-uuid') {
        expect(memberships.findActive).not.toHaveBeenCalled();
      }
    },
  );
});

async function authenticate(context: ExecutionContext): Promise<void> {
  const sessions: SessionRepository = {
    create: vi.fn(),
    findActiveByTokenHash: vi.fn(async () => ({
      id: 'session-id',
      userId: 'user-id',
      email: 'creator@example.com',
      expiresAt: new Date('2026-09-10T00:00:00.000Z'),
    })),
    revoke: vi.fn(),
  };
  const guard = new SessionAuthGuard(sessions, {
    hashSessionToken: () => 'session-hash',
  });
  await guard.canActivate(context);
}

function membershipRepository(
  membership: Awaited<ReturnType<TeamMembershipRepository['findActive']>>,
): TeamMembershipRepository & {
  findActive: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findActive: vi.fn(async () => membership),
  };
}

function contextFor(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}
