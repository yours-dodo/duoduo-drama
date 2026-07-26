import { describe, expect, it } from 'vitest';
import { secret } from '../secret-value.js';
import type {
  AuthFlowContext,
  AuthHttpRequest,
  AuthHttpResponse,
  OAuthCredential,
} from '../oauth.js';
import { createAnthropicOAuthFlow } from './anthropic/index.js';
import { createOpenAiCodexOAuthFlow } from './openai-codex/index.js';
import { createXAiOAuthFlow } from './xai/index.js';

const encoder = new TextEncoder();
function response(status: number, value: unknown): AuthHttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: encoder.encode(JSON.stringify(value)),
  };
}
function context(
  send: (request: AuthHttpRequest) => Promise<AuthHttpResponse>,
  signal = new AbortController().signal,
): AuthFlowContext {
  return {
    provider: {
      id: 'fixture',
      kind: 'fixture',
      name: 'Fixture',
      registrationGeneration: 'test',
      configFingerprint: '{}',
      authPolicyFingerprint: 'test',
    },
    signal,
    transport: { send },
    networkPolicy: { authorize: async () => {} },
    clock: { now: async () => 1_000_000 },
    random: { bytes: (length) => new Uint8Array(length).fill(7) },
  };
}
function credential(): OAuthCredential {
  return {
    type: 'oauth',
    accessToken: secret('old-access'),
    refreshToken: secret('old-refresh'),
    expiresAt: 1,
    providerAccountId: 'acct_old',
  };
}

describe('PI OAuth baseline contracts', () => {
  it('uses the exact provider refresh skews', () => {
    expect(createAnthropicOAuthFlow().refreshSkewMs).toBe(300_000);
    expect(createXAiOAuthFlow().refreshSkewMs).toBe(300_000);
    expect(createOpenAiCodexOAuthFlow().refreshSkewMs).toBe(0);
  });

  it('refreshes Codex without replacing an omitted refresh token and binds account identity', async () => {
    const previous = credential();
    let request: AuthHttpRequest | undefined;
    const result = await createOpenAiCodexOAuthFlow({
      clientId: 'client',
    }).refresh(
      previous,
      context(async (input) => {
        request = input;
        return response(200, {
          access_token: 'new-access',
          expires_in: 60,
          account_id: 'acct_new',
        });
      }),
    );
    expect(request?.body).toMatchObject({
      type: 'form',
      fields: {
        grant_type: 'refresh_token',
        client_id: 'client',
        refresh_token: previous.refreshToken,
      },
    });
    expect(request?.signal).toBeDefined();
    expect(result.credential.refreshToken).toBe(previous.refreshToken);
    expect(result).toMatchObject({
      credential: { expiresAt: 1_060_000, providerAccountId: 'acct_new' },
      providerAccountLabel: 'acct_new',
    });
    expect(
      createOpenAiCodexOAuthFlow().toRequestAuth(result.credential),
    ).toMatchObject({
      type: 'bearer_token',
      bindingFacts: { accountId: 'acct_new' },
    });
  });

  it('refreshes xAI and supports configured token revocation', async () => {
    const requests: AuthHttpRequest[] = [];
    const previous = credential();
    const flow = createXAiOAuthFlow({
      clientId: 'x-client',
      tokenEndpoint: 'https://auth.x.ai/token',
      revokeEndpoint: 'https://auth.x.ai/revoke',
    });
    const ctx = context(async (request) => {
      requests.push(request);
      return request.url.pathname === '/revoke'
        ? response(200, {})
        : response(200, { access_token: 'x-new', expires_in: 60 });
    });
    const result = await flow.refresh(previous, ctx);
    await flow.revoke?.(result.credential, ctx);
    expect(result.credential.refreshToken).toBe(previous.refreshToken);
    expect(requests.map((item) => item.url.pathname)).toEqual([
      '/token',
      '/revoke',
    ]);
    expect(requests[1]?.body).toMatchObject({
      type: 'form',
      fields: { token: previous.refreshToken, client_id: 'x-client' },
    });
  });
});
