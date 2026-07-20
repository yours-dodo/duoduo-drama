import { describe, expect, it } from 'vitest';

import { secret, type SecretValue } from '../../../index.js';
import type {
  AuthFlowContext,
  AuthHttpRequest,
  AuthHttpTransport,
  AuthInteraction,
} from '../../oauth.js';
import { createGitHubCopilotOAuthFlow } from './index.js';

const encoder = new TextEncoder();
function response(status: number, body: unknown) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: encoder.encode(JSON.stringify(body)),
  };
}

function context(transport: AuthHttpTransport): AuthFlowContext {
  return {
    provider: {
      id: 'github-copilot',
      kind: 'github-copilot',
      name: 'GitHub Copilot',
      registrationGeneration: 'test',
      configFingerprint: '{}',
      authPolicyFingerprint: 'test',
    },
    signal: new AbortController().signal,
    transport,
    networkPolicy: { authorize: async () => {} },
    clock: { now: async () => 1_000_000 },
    random: { bytes: (length) => new Uint8Array(length) },
  };
}

function expectSecret(value: SecretValue): void {
  expect(String(value)).toBe('[REDACTED]');
  expect(JSON.stringify(value)).toBe('"[REDACTED]"');
}

describe('GitHub Copilot OAuth', () => {
  it('runs device login, exchanges the GitHub token, and filters visible models', async () => {
    const requests: AuthHttpRequest[] = [];
    const replies = [
      response(200, {
        device_code: 'device-secret',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      }),
      response(200, { access_token: 'github-token', token_type: 'bearer' }),
      response(200, {
        token: 'tid=1;proxy-ep=proxy.enterprise.example;exp=9999999999',
        expires_at: 4_600,
        endpoints: { api: 'https://api.enterprise.example' },
        available_models: ['gpt-4.1', 'claude-sonnet-4'],
      }),
    ];
    const events: unknown[] = [];
    const interaction: AuthInteraction = {
      promptSecret: async () => secret('unused'),
      notify: async (event) => events.push(event),
    };
    const flow = createGitHubCopilotOAuthFlow();
    const result = await flow.login(
      interaction,
      context({
        send: async (request) => {
          requests.push(request);
          return replies.shift()!;
        },
      }),
    );

    expect(requests.map((request) => request.url.href)).toEqual([
      'https://github.com/login/device/code',
      'https://github.com/login/oauth/access_token',
      'https://api.github.com/copilot_internal/v2/token',
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'device_code', userCode: 'ABCD-EFGH' }),
    );
    expect(result.catalogAuth.visibleModelIds).toEqual([
      'gpt-4.1',
      'claude-sonnet-4',
    ]);
    expect(result.credential.metadata).toMatchObject({
      endpointOrigin: 'https://api.enterprise.example',
    });
    expectSecret(result.credential.accessToken);
    expectSecret(result.credential.refreshToken);
    expect(JSON.stringify(result)).not.toContain('github-token');
    expect(JSON.stringify(result)).not.toContain('proxy.enterprise.example');
  });

  it('refreshes by exchanging the stored GitHub token again', async () => {
    let request: AuthHttpRequest | undefined;
    const original = secret('github-token');
    const result = await createGitHubCopilotOAuthFlow().refresh(
      {
        type: 'oauth',
        accessToken: secret('expired-copilot'),
        refreshToken: original,
        expiresAt: 1,
      },
      context({
        send: async (value) => {
          request = value;
          return response(200, {
            token: 'tid=1;exp=9999999999',
            expires_at: 5_000,
          });
        },
      }),
    );
    expect(request?.headers?.authorization).toBe(original);
    expect(result.credential.refreshToken).toBe(original);
    expect(result.credential.expiresAt).toBe(5_000_000);
  });
});
