import { describe, expect, it } from 'vitest';

import { secret, type SecretValue } from '../../../index.js';
import type {
  AuthFlowContext,
  AuthHttpRequest,
  AuthHttpTransport,
  AuthInteraction,
} from '../../oauth.js';
import { createAnthropicOAuthFlow } from './index.js';

const encoder = new TextEncoder();

function response(status: number, body: unknown) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: encoder.encode(JSON.stringify(body)),
  };
}

function fixtureContext(
  transport: AuthHttpTransport,
  randomValues: readonly Uint8Array[] = [
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    Uint8Array.from({ length: 32 }, (_, index) => 255 - index),
  ],
): AuthFlowContext {
  let randomIndex = 0;
  return {
    provider: {
      id: 'anthropic',
      kind: 'anthropic',
      name: 'Anthropic',
      registrationGeneration: 'test',
      configFingerprint: '{}',
      authPolicyFingerprint: 'test',
    },
    signal: new AbortController().signal,
    transport,
    networkPolicy: { authorize: async () => {} },
    clock: { now: async () => 1_000_000 },
    random: {
      bytes: () => randomValues[randomIndex++] ?? randomValues.at(-1)!,
    },
  };
}

function expectSecret(value: string | SecretValue | undefined): void {
  expect(value).toBeDefined();
  expect(typeof value).not.toBe('string');
  expect(String(value)).toBe('[REDACTED]');
  expect(JSON.stringify(value)).toBe('"[REDACTED]"');
}

describe('Anthropic OAuth flow', () => {
  it('uses the Anthropic five-minute refresh skew by default', () => {
    expect(createAnthropicOAuthFlow().refreshSkewMs).toBe(5 * 60_000);
  });

  it('logs in with PKCE through the secret-aware auth transport', async () => {
    const requests: AuthHttpRequest[] = [];
    const flow = createAnthropicOAuthFlow();
    const interaction: AuthInteraction = {
      promptSecret: async () => secret('unused'),
      prompt: async (prompt) => {
        expect(prompt.type).toBe('manual_code');
        return `authorization-code#${Buffer.from(encoder.encode('expected-state')).toString('base64url')}`;
      },
      notify: async (event) => {
        if ('type' in event && event.type === 'auth_url') {
          const url = new URL(event.url);
          expect(url.origin + url.pathname).toBe(
            'https://claude.ai/oauth/authorize',
          );
          expect(url.searchParams.get('code_challenge_method')).toBe('S256');
          expect(url.searchParams.get('state')).toBe(
            Buffer.from(encoder.encode('expected-state')).toString('base64url'),
          );
        }
      },
    };
    const context = fixtureContext(
      {
        send: async (request) => {
          requests.push(request);
          return response(200, {
            access_token: 'access-canary',
            refresh_token: 'refresh-canary',
            expires_in: 3600,
            account: { uuid: 'account-123' },
          });
        },
      },
      [encoder.encode('expected-state'), encoder.encode('expected-verifier')],
    );

    const result = await flow.login(interaction, context);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      maxResponseBytes: 64 * 1024,
      body: { type: 'json' },
    });
    expect(requests[0]?.url.href).toBe(
      'https://console.anthropic.com/v1/oauth/token',
    );
    if (requests[0]?.body?.type !== 'json')
      throw new Error('expected JSON token request');
    expect(requests[0].body.fields).toMatchObject({
      grant_type: 'authorization_code',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
      state: Buffer.from(encoder.encode('expected-state')).toString(
        'base64url',
      ),
    });
    expectSecret(requests[0].body.fields.code as SecretValue);
    expectSecret(requests[0].body.fields.code_verifier as SecretValue);
    expect(result).toMatchObject({
      credential: {
        type: 'oauth',
        expiresAt: 4_600_000,
        providerAccountId: 'account-123',
      },
      catalogAuth: { catalogVisibilityFingerprint: 'default' },
      providerAccountLabel: 'account-123',
    });
    expectSecret(result.credential.accessToken);
    expectSecret(result.credential.refreshToken);
    expect(JSON.stringify(result)).not.toContain('access-canary');
    expect(JSON.stringify(result)).not.toContain('refresh-canary');
  });

  it('refreshes without materializing the refresh token and preserves it when rotation is omitted', async () => {
    const originalRefresh = secret('original-refresh');
    let request: AuthHttpRequest | undefined;
    const flow = createAnthropicOAuthFlow();
    const result = await flow.refresh(
      {
        type: 'oauth',
        accessToken: secret('expired-access'),
        refreshToken: originalRefresh,
        expiresAt: 10,
        providerAccountId: 'account-123',
      },
      fixtureContext({
        send: async (value) => {
          request = value;
          return response(200, {
            access_token: 'new-access',
            expires_in: 7200,
          });
        },
      }),
    );

    if (request?.body?.type !== 'json')
      throw new Error('expected JSON refresh request');
    expect(request.body.fields).toMatchObject({
      grant_type: 'refresh_token',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    });
    expect(request.body.fields.refresh_token).toBe(originalRefresh);
    expect(result.credential.refreshToken).toBe(originalRefresh);
    expect(result.credential.expiresAt).toBe(8_200_000);
  });

  it('rejects a manually pasted authorization code without the expected state', async () => {
    const flow = createAnthropicOAuthFlow();
    const interaction: AuthInteraction = {
      promptSecret: async () => secret('unused'),
      prompt: async () => 'authorization-code',
      notify: async () => {},
    };

    await expect(
      flow.login(
        interaction,
        fixtureContext({ send: async () => response(500, {}) }, [
          encoder.encode('expected-state'),
          encoder.encode('expected-verifier'),
        ]),
      ),
    ).rejects.toMatchObject({ code: 'ANTHROPIC_OAUTH_STATE_MISMATCH' });
  });

  it('rejects token redirects and does not expose response secrets in the error', async () => {
    const flow = createAnthropicOAuthFlow();
    const interaction: AuthInteraction = {
      promptSecret: async () => secret('unused'),
      prompt: async () =>
        `authorization-code#${Buffer.from(encoder.encode('expected-state')).toString('base64url')}`,
      notify: async () => {},
    };

    await expect(
      flow.login(
        interaction,
        fixtureContext(
          {
            send: async () =>
              response(302, {
                access_token: 'redirected-access-canary',
                refresh_token: 'redirected-refresh-canary',
              }),
          },
          [
            encoder.encode('expected-state'),
            encoder.encode('expected-verifier'),
          ],
        ),
      ),
    ).rejects.toMatchObject({
      code: 'ANTHROPIC_OAUTH_TOKEN_FAILED',
      category: 'auth',
    });
  });

  it('revokes only through an explicitly configured endpoint', async () => {
    const credential = {
      type: 'oauth' as const,
      accessToken: secret('access-to-revoke'),
      refreshToken: secret('refresh-to-revoke'),
      expiresAt: 123,
    };
    const unsupported = createAnthropicOAuthFlow();
    expect(unsupported.revoke).toBeUndefined();

    let request: AuthHttpRequest | undefined;
    const configured = createAnthropicOAuthFlow({
      revokeEndpoint: 'https://console.anthropic.com/v1/oauth/revoke',
    });
    await configured.revoke?.(
      credential,
      fixtureContext({
        send: async (value) => {
          request = value;
          return response(204, {});
        },
      }),
    );

    expect(request).toMatchObject({ method: 'POST', redirect: 'error' });
    if (request?.body?.type !== 'json')
      throw new Error('expected JSON revoke request');
    expect(request.body.fields.token).toBe(credential.refreshToken);
  });
});
