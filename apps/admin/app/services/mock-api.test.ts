import { describe, expect, it } from 'vitest';

import { getDashboardSnapshot } from './mock-api.js';

describe('admin dashboard query adapter', () => {
  it('returns deterministic placeholder data for the initial shell', async () => {
    const snapshot = await getDashboardSnapshot();

    expect(snapshot.activeTenants).toBeGreaterThan(0);
    expect(snapshot.agentRuntimeStatus).toBe('healthy');
    expect(snapshot.recentRuns).toHaveLength(3);
  });
});
