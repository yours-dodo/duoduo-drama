import { describe, expect, it } from 'vitest';

import { createLocalScopeAuthority } from '../auth/node/local-scope.js';
import { secret } from '../auth/secret-value.js';
import type { ChatRequest } from '../core/events.js';
import { createOpenAiProvider } from '../providers/openai/index.js';
import { createFauxProvider } from '../testing/faux.js';
import { createFixtureTransportDriver } from '../transport/fixture-driver.js';
import { createMemoryCredentialStore } from '../testing/memory-stores.js';
import { createAllowlistNetworkPolicy } from '../transport/network-policy.js';
import { createAi } from './create-ai.js';
import type { Provider } from './registry.js';

function completedSse(): Uint8Array {
  return new TextEncoder().encode(
    `event: response.completed\ndata: ${JSON.stringify({
      type: 'response.completed',
      response: { id: 'response-runtime', status: 'completed' },
    })}\n\n`,
  );
}

describe('runtime transport and session integration', () => {
  it('passes retry policy and provider idempotency safety into the bound transport', async () => {
    const driver = createFixtureTransportDriver();
    driver.enqueue({
      status: 500,
      bodyChunks: [],
    });
    driver.enqueue({
      status: 200,
      bodyChunks: [completedSse()],
    });
    const ai = createAi({
      transport: driver,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.openai.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    const provider = createOpenAiProvider();
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('fixture-key'),
    };
    const model = await ai.models.require(
      {
        providerInstanceId: provider.id,
        modelId: 'gpt-4.1-mini',
        protocol: 'openai-responses',
      },
      {},
      { credentialOverride },
    );

    const response = await ai.complete(
      model,
      { messages: [] },
      {
        credentialOverride,
        retry: {
          maxAttempts: 2,
          baseDelayMs: 0,
          maxDelayMs: 0,
          jitterRatio: 0,
          retryOn: ['provider_5xx'],
        },
      },
    );

    expect(response.status).toBe('completed');
    expect(driver.requests()).toHaveLength(2);
    expect(
      driver
        .requests()
        .every((request) => request.headerNames.includes('idempotency-key')),
    ).toBe(true);
  });

  it('isolates credentialless session resources by model lookup scope', async () => {
    const fixture = createFauxProvider();
    let createCount = 0;
    const provider: Provider = {
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        runChat: async (request: ChatRequest) => {
          const lease = await request.session.acquire(
            'connection',
            async () => ({
              value: { id: ++createCount },
              dispose: () => undefined,
            }),
          );
          await lease.release();
          return {
            status: 'completed',
            finishReason: 'stop',
            responseId: `resource-${lease.value.id}`,
          };
        },
      },
    };
    const ai = createAi();
    ai.providers.register(provider);
    const scopeA = {};
    const scopeB = {};
    const firstA = await ai.models.require(fixture.modelRef, scopeA);
    const secondA = await ai.models.require(fixture.modelRef, scopeA);
    const modelB = await ai.models.require(fixture.modelRef, scopeB);

    const first = await ai.complete(
      firstA,
      { messages: [] },
      { sessionId: 's1' },
    );
    const second = await ai.complete(
      secondA,
      { messages: [] },
      { sessionId: 's1' },
    );
    const isolated = await ai.complete(
      modelB,
      { messages: [] },
      { sessionId: 's1' },
    );

    expect(first.responseId).toBe('resource-1');
    expect(second.responseId).toBe('resource-1');
    expect(isolated.responseId).toBe('resource-2');
    expect(createCount).toBe(2);

    await ai.dispose();
  });

  it('isolates request-credential sessions by scope even when the key matches', async () => {
    const fixture = createFauxProvider({ id: 'scoped-key' });
    let createCount = 0;
    const provider: Provider = {
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        transport: {
          endpoint: 'https://session.example/v1/chat',
          credential: {
            headerName: 'authorization',
            defaultScheme: 'Bearer',
          },
        },
        runChat: async (request: ChatRequest) => {
          const lease = await request.session.acquire(
            'connection',
            async () => ({
              value: { id: ++createCount },
              dispose: () => undefined,
            }),
          );
          await lease.release();
          return {
            status: 'completed',
            finishReason: 'stop',
            responseId: `resource-${lease.value.id}`,
          };
        },
      },
    };
    const ai = createAi({
      transport: createFixtureTransportDriver(),
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://session.example'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('same-key'),
    };
    const scopeA = {};
    const scopeB = {};
    const firstA = await ai.models.require(fixture.modelRef, scopeA, {
      credentialOverride,
    });
    const secondA = await ai.models.require(fixture.modelRef, scopeA, {
      credentialOverride,
    });
    const modelB = await ai.models.require(fixture.modelRef, scopeB, {
      credentialOverride,
    });

    const first = await ai.complete(
      firstA,
      { messages: [] },
      {
        credentialOverride,
        sessionId: 's1',
      },
    );
    const second = await ai.complete(
      secondA,
      { messages: [] },
      {
        credentialOverride,
        sessionId: 's1',
      },
    );
    const isolated = await ai.complete(
      modelB,
      { messages: [] },
      {
        credentialOverride,
        sessionId: 's1',
      },
    );

    expect(first.responseId).toBe('resource-1');
    expect(second.responseId).toBe('resource-1');
    expect(isolated.responseId).toBe('resource-2');
    expect(createCount).toBe(2);

    await ai.dispose();
  });

  it('closes stored-credential sessions after replacement and logout once leases drain', async () => {
    const fixture = createFauxProvider({ id: 'stored-session' });
    const heldLeases: Array<{ release(): Promise<void> }> = [];
    let createCount = 0;
    let disposeCount = 0;
    const provider: Provider = {
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        transport: {
          endpoint: 'https://session.example/v1/chat',
          credential: {
            headerName: 'authorization',
            defaultScheme: 'Bearer',
          },
        },
        runChat: async (request: ChatRequest) => {
          const lease = await request.session.acquire(
            'connection',
            async () => ({
              value: { id: ++createCount },
              dispose: () => {
                disposeCount += 1;
              },
            }),
          );
          heldLeases.push(lease);
          return {
            status: 'completed',
            finishReason: 'stop',
            responseId: `resource-${lease.value.id}`,
          };
        },
      },
    };
    const local = createLocalScopeAuthority({
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
    });
    const ai = createAi({
      credentialStore: createMemoryCredentialStore(),
      scopeAuthority: local.authority,
      transport: createFixtureTransportDriver(),
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://session.example'],
      }),
    });
    ai.providers.register(provider);
    await ai.auth.login(provider.id, 'api_key', local.scope, {
      promptSecret: async () => secret('first-key'),
    });
    const firstModel = await ai.models.require(fixture.modelRef, local.scope);
    await ai.complete(firstModel, { messages: [] }, { sessionId: 's1' });

    await ai.auth.login(provider.id, 'api_key', local.scope, {
      promptSecret: async () => secret('replacement-key'),
    });
    expect(disposeCount).toBe(0);
    await heldLeases.shift()!.release();
    expect(disposeCount).toBe(1);

    const replacementModel = await ai.models.require(
      fixture.modelRef,
      local.scope,
    );
    await ai.complete(replacementModel, { messages: [] }, { sessionId: 's1' });
    await ai.auth.logout(provider.id, local.scope);
    expect(disposeCount).toBe(1);
    await heldLeases.shift()!.release();
    expect(disposeCount).toBe(2);

    await ai.dispose();
  });

  it('reuses session resources only for the same bound identity and session id', async () => {
    const fixture = createFauxProvider();
    let createCount = 0;
    let disposeCount = 0;
    const provider: Provider = {
      ...fixture.provider,
      chat: {
        ...fixture.provider.chat!,
        runChat: async (request: ChatRequest) => {
          const lease = await request.session!.acquire(
            'connection',
            async () => {
              createCount += 1;
              return {
                value: { id: createCount },
                dispose: () => {
                  disposeCount += 1;
                },
              };
            },
          );
          await lease.release();
          return {
            status: 'completed',
            finishReason: 'stop',
            responseId: `resource-${lease.value.id}`,
          };
        },
      },
    };
    const ai = createAi();
    ai.providers.register(provider);
    const model = await ai.models.require(fixture.modelRef, {});

    const first = await ai.complete(
      model,
      { messages: [] },
      { sessionId: 's1' },
    );
    const second = await ai.complete(
      model,
      { messages: [] },
      { sessionId: 's1' },
    );
    const transient = await ai.complete(model, { messages: [] });

    expect(first.responseId).toBe('resource-1');
    expect(second.responseId).toBe('resource-1');
    expect(transient.responseId).toBe('resource-2');
    expect(createCount).toBe(2);
    expect(disposeCount).toBe(1);

    await ai.dispose();
    expect(disposeCount).toBe(2);
  });
});
