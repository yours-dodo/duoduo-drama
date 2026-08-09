import { describe, expect, it, vi } from 'vitest';

import { TeamAdministratorRequiredError } from '../../tenancy/application/tenancy-errors.js';
import { ListAuditRecords } from './list-audit-records.js';

describe('ListAuditRecords', () => {
  it('returns a tenant page only to active administrators', async () => {
    const memberships = {
      findActive: vi.fn(async () => ({ role: 'admin' })),
    };
    const records = {
      listForTenant: vi.fn(async () => ({ items: [], next: null })),
    };
    const useCase = new ListAuditRecords(
      memberships as never,
      records as never,
    );

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'admin-id',
        page: { limit: 50, after: null },
      }),
    ).resolves.toEqual({ items: [], next: null });

    memberships.findActive.mockResolvedValueOnce({ role: 'member' });
    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'member-id',
        page: { limit: 50, after: null },
      }),
    ).rejects.toBeInstanceOf(TeamAdministratorRequiredError);
  });
});
