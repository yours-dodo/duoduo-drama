import { beforeEach, describe, expect, it } from 'vitest';

import { useAdminSessionStore } from './session-store.js';

describe('admin session store', () => {
  beforeEach(() => {
    useAdminSessionStore.setState({
      isAuthenticated: false,
      displayName: 'Admin Operator',
    });
  });

  it('supports the local placeholder login flow', () => {
    expect(useAdminSessionStore.getState().isAuthenticated).toBe(false);

    useAdminSessionStore.getState().login();

    expect(useAdminSessionStore.getState().isAuthenticated).toBe(true);
  });

  it('clears the local session on logout', () => {
    useAdminSessionStore.getState().login();
    useAdminSessionStore.getState().logout();

    expect(useAdminSessionStore.getState().isAuthenticated).toBe(false);
  });
});
