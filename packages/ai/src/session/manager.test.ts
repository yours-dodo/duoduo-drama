import { describe, expect, it, vi } from 'vitest';

import { createSessionManager } from './manager.js';

const identity = {
  providerInstanceId: 'openai',
  protocol: 'openai-responses',
  credentialScopeFingerprint: 'scope',
  credentialInstanceId: 'credential-1',
  authBindingFingerprint: 'auth-binding',
  providerRegistrationGeneration: 'generation-1',
  sessionId: 'session-1',
};

describe('session manager', () => {
  it('creates a shared resource once and disposes after closing leases drain', async () => {
    const manager = createSessionManager();
    const firstHandle = manager.open(identity);
    const secondHandle = manager.open(identity);
    let createCalls = 0;
    let disposeCalls = 0;
    const create = async () => {
      createCalls += 1;
      return {
        value: { socket: 'shared' },
        dispose: async () => {
          disposeCalls += 1;
        },
      };
    };

    const [first, second] = await Promise.all([
      firstHandle.acquire('socket', create),
      secondHandle.acquire('socket', create),
    ]);
    expect(createCalls).toBe(1);
    expect(first.value).toBe(second.value);

    await manager.cleanup({
      providerInstanceId: 'openai',
      credentialScopeFingerprint: 'scope',
      sessionId: 'session-1',
    });
    await expect(firstHandle.acquire('later', create)).rejects.toMatchObject({
      code: 'SESSION_CLOSING',
    });
    await first.release();
    expect(disposeCalls).toBe(0);
    await second.release();
    expect(disposeCalls).toBe(1);
    await second.release();
    expect(disposeCalls).toBe(1);

    const replacementHandle = manager.open(identity);
    const replacement = await replacementHandle.acquire('socket', create);
    expect(createCalls).toBe(2);
    expect(replacement.value).not.toBe(first.value);
    await replacement.release();
  });

  it('fences replaced credentials without affecting the replacement session', async () => {
    const manager = createSessionManager();
    const oldHandle = manager.open(identity);
    const nextHandle = manager.open({
      ...identity,
      credentialInstanceId: 'credential-2',
    });
    let oldDisposed = 0;
    let nextDisposed = 0;
    const oldLease = await oldHandle.acquire('resource', async () => ({
      value: 'old',
      dispose: () => {
        oldDisposed += 1;
      },
    }));
    const nextLease = await nextHandle.acquire('resource', async () => ({
      value: 'next',
      dispose: () => {
        nextDisposed += 1;
      },
    }));

    await manager.cleanupCredential('credential-1');
    await oldLease.release();
    expect(oldDisposed).toBe(1);
    expect(nextDisposed).toBe(0);
    await expect(
      nextHandle.acquire('other', async () => ({ value: 'ok', dispose() {} })),
    ).resolves.toMatchObject({ value: 'ok' });
    await nextLease.release();
  });

  it('continues disposal after one resource fails and can be disposed repeatedly', async () => {
    const diagnostics: string[] = [];
    const manager = createSessionManager({
      onDisposeError: () => diagnostics.push('failed'),
    });
    const handle = manager.open(identity);
    const first = await handle.acquire('first', async () => ({
      value: 1,
      dispose: () => {
        throw new Error('private cleanup detail');
      },
    }));
    const second = await handle.acquire('second', async () => ({
      value: 2,
      dispose: () => undefined,
    }));
    await first.release();
    await second.release();

    await manager.dispose();
    await manager.dispose();
    expect(diagnostics).toEqual(['failed']);
    expect(() => manager.open(identity)).toThrowError(
      'session manager is disposed',
    );
  });

  it('keeps transient resources and affinity request-local', async () => {
    const manager = createSessionManager();
    let disposeCalls = 0;
    const first = manager.open({ ...identity, sessionId: undefined });
    first.setAffinity('response', 'resp-1');
    expect(first.getAffinity('response')).toBe('resp-1');
    const lease = await first.acquire('resource', async () => ({
      value: 'temporary',
      dispose: () => {
        disposeCalls += 1;
      },
    }));
    await lease.release();
    expect(disposeCalls).toBe(1);

    const second = manager.open({ ...identity, sessionId: undefined });
    expect(second.getAffinity('response')).toBeUndefined();
  });

  it('disposes a newly created resource when acquisition is aborted', async () => {
    const manager = createSessionManager();
    const handle = manager.open(identity);
    const controller = new AbortController();
    let disposeCalls = 0;

    await expect(
      handle.acquire(
        'resource',
        async () => {
          controller.abort('caller stopped');
          return {
            value: 'unclaimed',
            dispose: () => {
              disposeCalls += 1;
            },
          };
        },
        controller.signal,
      ),
    ).rejects.toBe('caller stopped');

    expect(disposeCalls).toBe(1);
    await manager.dispose();
    expect(disposeCalls).toBe(1);
  });

  it('rejects a new resource before creation when a session reaches its limit', async () => {
    const manager = createSessionManager({ maxResourcesPerSession: 1 });
    const handle = manager.open(identity);
    const first = await handle.acquire('first', async () => ({
      value: 'first',
      dispose() {},
    }));
    await first.release();
    let createCalls = 0;

    await expect(
      handle.acquire('second', async () => {
        createCalls += 1;
        return { value: 'second', dispose() {} };
      }),
    ).rejects.toMatchObject({ code: 'SESSION_RESOURCE_LIMIT' });
    expect(createCalls).toBe(0);

    const reused = await handle.acquire('first', async () => {
      createCalls += 1;
      return { value: 'replacement', dispose() {} };
    });
    expect(reused.value).toBe('first');
    expect(createCalls).toBe(0);
    await reused.release();
  });

  it('evicts the least-recently-used idle session at capacity', async () => {
    let now = 0;
    const manager = createSessionManager({
      maxSessions: 2,
      clock: { now: () => now },
    });
    const first = manager.open(identity);
    now = 1;
    const second = manager.open({ ...identity, sessionId: 'session-2' });
    now = 2;
    first.getAffinity('touch');
    now = 3;
    const third = manager.open({ ...identity, sessionId: 'session-3' });

    await expect(
      second.acquire('resource', async () => ({ value: 2, dispose() {} })),
    ).rejects.toMatchObject({ code: 'SESSION_CLOSING' });
    const firstLease = await first.acquire('resource', async () => ({
      value: 1,
      dispose() {},
    }));
    const thirdLease = await third.acquire('resource', async () => ({
      value: 3,
      dispose() {},
    }));
    expect(firstLease.value).toBe(1);
    expect(thirdLease.value).toBe(3);
    await firstLease.release();
    await thirdLease.release();
    await manager.dispose();
  });

  it('rejects a new session when every capacity candidate is active', async () => {
    const manager = createSessionManager({ maxSessions: 1 });
    const first = manager.open(identity);
    const held = await first.acquire('resource', async () => ({
      value: 'held',
      dispose() {},
    }));

    expect(() =>
      manager.open({ ...identity, sessionId: 'session-2' }),
    ).toThrowError(
      expect.objectContaining({ code: 'SESSION_CAPACITY_EXCEEDED' }),
    );

    await held.release();
    const replacement = manager.open({
      ...identity,
      sessionId: 'session-2',
    });
    await expect(
      first.acquire('resource', async () => ({ value: 'old', dispose() {} })),
    ).rejects.toMatchObject({ code: 'SESSION_CLOSING' });
    const replacementLease = await replacement.acquire(
      'resource',
      async () => ({ value: 'replacement', dispose() {} }),
    );
    await replacementLease.release();
    await manager.dispose();
  });

  it('closes and removes an idle session after its TTL', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000));
      let createCalls = 0;
      let disposeCalls = 0;
      const manager = createSessionManager({ idleTtlMs: 60_000 });
      const handle = manager.open(identity);
      const lease = await handle.acquire('resource', async () => ({
        value: ++createCalls,
        dispose: () => {
          disposeCalls += 1;
        },
      }));
      await lease.release();

      await vi.advanceTimersByTimeAsync(59_999);
      expect(disposeCalls).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(disposeCalls).toBe(1);
      await expect(
        handle.acquire('resource', async () => ({ value: 0, dispose() {} })),
      ).rejects.toMatchObject({ code: 'SESSION_CLOSING' });

      const replacement = manager.open(identity);
      const replacementLease = await replacement.acquire(
        'resource',
        async () => ({
          value: ++createCalls,
          dispose() {},
        }),
      );
      expect(replacementLease.value).toBe(2);
      await replacementLease.release();
      await manager.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
