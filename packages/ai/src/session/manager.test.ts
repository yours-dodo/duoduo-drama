import { describe, expect, it } from 'vitest';

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
});
