import { describe, expect, it } from 'vitest';

import { createAi, secret } from '../index.js';
import { createOpenAiProvider } from '../providers/openai/index.js';
import { createAllowlistNetworkPolicy } from '../transport/index.js';
import {
  createFixtureTransportDriver,
  createMemoryCredentialStore,
} from '../testing.js';
import { createLocalScopeAuthority } from '../auth/node/local-scope.js';

const encoder = new TextEncoder();

function completedSse(): Uint8Array[] {
  return [
    encoder.encode(
      `event: response.completed\ndata: ${JSON.stringify({
        type: 'response.completed',
        sequence_number: 0,
        response: {
          id: 'resp_stored',
          model: 'gpt-4.1-mini',
          status: 'completed',
          usage: {},
        },
      })}\n\n`,
    ),
  ];
}

describe('runtime stored auth', () => {
  it('supports login, cross-runtime use, replacement fencing, and logout', async () => {
    const store = createMemoryCredentialStore();
    const local = createLocalScopeAuthority({
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      credentialSlotId: 'primary',
    });
    const provider = createOpenAiProvider();
    const firstTransport = createFixtureTransportDriver();
    const first = createAi({
      credentialStore: store,
      scopeAuthority: local.authority,
      transport: firstTransport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.openai.com'],
      }),
    });
    first.providers.register(provider);

    await expect(first.auth.status(provider.id, local.scope)).resolves.toEqual({
      status: 'unconfigured',
    });
    await expect(
      first.auth.login(provider.id, 'api_key', local.scope, {
        promptSecret: async () => secret('sk-first'),
      }),
    ).resolves.toMatchObject({
      status: 'ready',
      source: 'stored',
      method: 'api_key',
    });

    const staleHandle = await first.models.require(
      {
        providerInstanceId: provider.id,
        modelId: 'gpt-4.1-mini',
        protocol: 'openai-responses',
      },
      local.scope,
    );

    const secondTransport = createFixtureTransportDriver();
    secondTransport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.openai.com/v1/responses',
        headers: {
          authorization: 'Bearer sk-first',
          'content-type': 'application/json',
        },
      },
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyChunks: completedSse(),
    });
    const secondLocal = createLocalScopeAuthority({
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      credentialSlotId: 'primary',
    });
    const second = createAi({
      credentialStore: store,
      scopeAuthority: secondLocal.authority,
      transport: secondTransport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.openai.com'],
      }),
    });
    second.providers.register(createOpenAiProvider());
    const restoredHandle = await second.models.require(
      {
        providerInstanceId: 'openai',
        modelId: 'gpt-4.1-mini',
        protocol: 'openai-responses',
      },
      secondLocal.scope,
    );
    await expect(
      second.complete(restoredHandle, { messages: [] }),
    ).resolves.toMatchObject({
      status: 'completed',
      responseId: 'resp_stored',
    });

    await first.auth.login(provider.id, 'api_key', local.scope, {
      promptSecret: async () => secret('sk-replacement'),
    });
    const before = firstTransport.requests().length;
    await expect(
      first.complete(staleHandle, { messages: [] }),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'CREDENTIAL_HANDLE_STALE' },
    });
    expect(firstTransport.requests()).toHaveLength(before);

    await expect(first.auth.logout(provider.id, local.scope)).resolves.toEqual({
      local: 'removed',
      remote: 'not_requested',
    });
    await expect(first.auth.status(provider.id, local.scope)).resolves.toEqual({
      status: 'unconfigured',
    });
  });

  it('isolates tenant, subject, slot, and provider configuration', async () => {
    const store = createMemoryCredentialStore();
    const owner = createLocalScopeAuthority({
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      credentialSlotId: 'primary',
    });
    const ai = createAi({
      credentialStore: store,
      scopeAuthority: owner.authority,
    });
    ai.providers.register(createOpenAiProvider());
    await ai.auth.login('openai', 'api_key', owner.scope, {
      promptSecret: async () => secret('sk-scope'),
    });

    for (const variant of [
      {
        tenantId: 'tenant-b',
        subjectId: 'subject-a',
        credentialSlotId: 'primary',
      },
      {
        tenantId: 'tenant-a',
        subjectId: 'subject-b',
        credentialSlotId: 'primary',
      },
      {
        tenantId: 'tenant-a',
        subjectId: 'subject-a',
        credentialSlotId: 'secondary',
      },
    ]) {
      const local = createLocalScopeAuthority(variant);
      const isolated = createAi({
        credentialStore: store,
        scopeAuthority: local.authority,
      });
      isolated.providers.register(createOpenAiProvider());
      await expect(
        isolated.auth.status('openai', local.scope),
      ).resolves.toEqual({
        status: 'unconfigured',
      });
    }

    const changed = createAi({
      credentialStore: store,
      scopeAuthority: owner.authority,
    });
    changed.providers.register(
      createOpenAiProvider({
        endpoint: 'https://gateway.example.com/v1/responses',
      }),
    );
    await expect(
      changed.models.require(
        { providerInstanceId: 'openai', modelId: 'gpt-4.1-mini' },
        owner.scope,
      ),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_AUTH_BINDING_MISMATCH' });
  });
});
