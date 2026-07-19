import { describe, expect, it } from 'vitest';

import type { AuthHttpRequest, AuthInteraction } from '../auth/oauth.js';
import { createLocalScopeAuthority } from '../auth/node/local-scope.js';
import { secret } from '../auth/secret-value.js';
import { createAnthropicProvider } from '../providers/anthropic/index.js';
import { createMemoryCredentialStore } from '../testing/memory-stores.js';
import { createFixtureTransportDriver } from '../transport/fixture-driver.js';
import { createAllowlistNetworkPolicy } from '../transport/network-policy.js';
import { createAi } from './create-ai.js';

const encoder = new TextEncoder();

function authResponse(status: number, body: unknown) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: encoder.encode(JSON.stringify(body)),
  };
}

function completedStream() {
  return [
    encoder.encode(
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_oauth","model":"claude-sonnet-4-5","usage":{"input_tokens":1,"output_tokens":0}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"ok"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
        '',
      ].join('\n'),
    ),
  ];
}

function oauthInteraction(): AuthInteraction {
  let state = '';
  return {
    promptSecret: async () => secret('unused'),
    notify: async (event) => {
      if ('type' in event && event.type === 'auth_url')
        state = new URL(event.url).searchParams.get('state') ?? '';
    },
    prompt: async () => `authorization-code#${state}`,
  };
}

describe('Anthropic stored OAuth runtime', () => {
  it('logs in and binds the stored OAuth access token as bearer authorization', async () => {
    const modelTransport = createFixtureTransportDriver();
    modelTransport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: { authorization: 'Bearer oauth-access' },
      },
      status: 200,
      bodyChunks: completedStream(),
    });
    const local = createLocalScopeAuthority({ tenantId: 't', subjectId: 's' });
    const ai = createAi({
      credentialStore: createMemoryCredentialStore(),
      scopeAuthority: local.authority,
      transport: modelTransport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://api.anthropic.com'],
      }),
      auth: {
        transport: {
          send: async () =>
            authResponse(200, {
              access_token: 'oauth-access',
              refresh_token: 'oauth-refresh',
              expires_in: 3600,
            }),
        },
        networkPolicy: { authorize: async () => {} },
        random: { bytes: (length) => new Uint8Array(length).fill(7) },
        clock: { now: async () => 1_000_000 },
      },
    });
    const provider = createAnthropicProvider();
    ai.providers.register(provider);

    await expect(
      ai.auth.login(provider.id, 'oauth', local.scope, oauthInteraction()),
    ).resolves.toMatchObject({ status: 'ready', method: 'oauth' });
    const model = await ai.models.require(
      {
        providerInstanceId: provider.id,
        modelId: 'claude-sonnet-4-5',
        protocol: 'anthropic-messages',
      },
      local.scope,
    );
    await expect(
      ai.complete(
        model,
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
        { maxOutputTokens: 32 },
      ),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('uses a refresh lease so concurrent expiry resolution performs one token refresh', async () => {
    let now = 1_000_000;
    const authRequests: AuthHttpRequest[] = [];
    const local = createLocalScopeAuthority({ tenantId: 't', subjectId: 's' });
    const store = createMemoryCredentialStore({ clock: { now: () => now } });
    const ai = createAi({
      credentialStore: store,
      scopeAuthority: local.authority,
      auth: {
        transport: {
          send: async (request) => {
            authRequests.push(request);
            if (
              request.body?.type === 'json' &&
              request.body.fields.grant_type === 'refresh_token'
            ) {
              await new Promise((resolve) => setTimeout(resolve, 10));
              return authResponse(200, {
                access_token: 'refreshed-access',
                refresh_token: 'rotated-refresh',
                expires_in: 3600,
              });
            }
            return authResponse(200, {
              access_token: 'short-access',
              refresh_token: 'initial-refresh',
              expires_in: 1,
            });
          },
        },
        networkPolicy: { authorize: async () => {} },
        random: { bytes: (length) => new Uint8Array(length).fill(8) },
        clock: { now: async () => now },
      },
    });
    const provider = createAnthropicProvider();
    ai.providers.register(provider);
    await ai.auth.login(provider.id, 'oauth', local.scope, oauthInteraction());
    now += 5_000;

    await Promise.all([
      ai.models.require(
        { providerInstanceId: provider.id, modelId: 'claude-sonnet-4-5' },
        local.scope,
      ),
      ai.models.require(
        { providerInstanceId: provider.id, modelId: 'claude-sonnet-4-5' },
        local.scope,
      ),
    ]);

    expect(
      authRequests.filter(
        (request) =>
          request.body?.type === 'json' &&
          request.body.fields.grant_type === 'refresh_token',
      ),
    ).toHaveLength(1);
  });

  it('rejects stored OAuth credentials after the OAuth policy changes', async () => {
    const local = createLocalScopeAuthority({ tenantId: 't', subjectId: 's' });
    const store = createMemoryCredentialStore();
    const first = createAi({
      credentialStore: store,
      scopeAuthority: local.authority,
      auth: {
        transport: {
          send: async () =>
            authResponse(200, {
              access_token: 'oauth-access',
              refresh_token: 'oauth-refresh',
              expires_in: 3600,
            }),
        },
        networkPolicy: { authorize: async () => {} },
        random: { bytes: (length) => new Uint8Array(length).fill(10) },
      },
    });
    const original = createAnthropicProvider({
      oauth: { tokenEndpoint: 'https://auth.example.test/oauth/token' },
    });
    first.providers.register(original);
    await first.auth.login(
      original.id,
      'oauth',
      local.scope,
      oauthInteraction(),
    );

    const second = createAi({
      credentialStore: store,
      scopeAuthority: local.authority,
    });
    const changed = createAnthropicProvider({
      oauth: { tokenEndpoint: 'https://other.example.test/oauth/token' },
    });
    second.providers.register(changed);

    await expect(
      second.models.require(
        {
          providerInstanceId: changed.id,
          modelId: 'claude-sonnet-4-5',
          protocol: 'anthropic-messages',
        },
        local.scope,
      ),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_AUTH_BINDING_MISMATCH' });
  });

  it('tombstones locally before best-effort remote revoke failure', async () => {
    let tokenCalls = 0;
    const local = createLocalScopeAuthority({ tenantId: 't', subjectId: 's' });
    const ai = createAi({
      credentialStore: createMemoryCredentialStore(),
      scopeAuthority: local.authority,
      auth: {
        transport: {
          send: async () => {
            tokenCalls += 1;
            return tokenCalls === 1
              ? authResponse(200, {
                  access_token: 'oauth-access',
                  refresh_token: 'oauth-refresh',
                  expires_in: 3600,
                })
              : authResponse(500, {});
          },
        },
        networkPolicy: { authorize: async () => {} },
        random: { bytes: (length) => new Uint8Array(length).fill(9) },
        clock: { now: async () => 1_000_000 },
      },
    });
    const provider = createAnthropicProvider({
      oauth: {
        revokeEndpoint: 'https://console.anthropic.com/v1/oauth/revoke',
      },
    });
    ai.providers.register(provider);
    await ai.auth.login(provider.id, 'oauth', local.scope, oauthInteraction());

    await expect(
      ai.auth.logout(provider.id, local.scope, { revokeRemote: true }),
    ).resolves.toMatchObject({ local: 'removed', remote: 'failed' });
    await expect(ai.auth.status(provider.id, local.scope)).resolves.toEqual({
      status: 'unconfigured',
    });
  });
});
