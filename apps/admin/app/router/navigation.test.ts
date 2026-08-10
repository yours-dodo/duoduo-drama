import { describe, expect, it } from 'vitest';

import { adminRouteMeta, getAdminRouteMeta } from './navigation.js';

describe('admin navigation', () => {
  it('exposes the approved platform navigation routes', () => {
    expect(adminRouteMeta.map((route) => route.path)).toEqual([
      '/dashboard',
      '/tenants',
      '/users',
      '/projects',
      '/agent/runs',
      '/agent/approvals',
      '/agent/recovery',
      '/settings/models',
    ]);
  });

  it('falls back to the dashboard metadata for unknown paths', () => {
    expect(getAdminRouteMeta('/missing').path).toBe('/dashboard');
  });
});
