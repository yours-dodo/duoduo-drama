import { createHash } from 'node:crypto';

import { AiRuntimeError } from '../../../core/errors.js';
import type { JsonValue } from '../../../core/content.js';
import type {
  AuthFlowContext,
  AuthHttpResponse,
  OAuthCredential,
  OAuthCredentialResult,
  OAuthFlow,
} from '../../oauth.js';
import { secret } from '../../secret-value.js';

const DEFAULT_AUTHORIZE_ENDPOINT = 'https://claude.ai/oauth/authorize';
const DEFAULT_TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token';
const DEFAULT_REDIRECT_URI =
  'https://console.anthropic.com/oauth/code/callback';
const DEFAULT_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const DEFAULT_SCOPES = Object.freeze([
  'org:create_api_key',
  'user:profile',
  'user:inference',
]);

export interface CreateAnthropicOAuthFlowOptions {
  readonly authorizeEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly revokeEndpoint?: string;
  readonly redirectUri?: string;
  readonly clientId?: string;
  readonly scopes?: readonly string[];
  readonly refreshSkewMs?: number;
}

export function createAnthropicOAuthFlow(
  options: CreateAnthropicOAuthFlowOptions = {},
): OAuthFlow {
  const authorizeEndpoint = new URL(
    options.authorizeEndpoint ?? DEFAULT_AUTHORIZE_ENDPOINT,
  );
  const tokenEndpoint = new URL(
    options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
  );
  const revokeEndpoint = options.revokeEndpoint
    ? new URL(options.revokeEndpoint)
    : undefined;
  const redirectUri = options.redirectUri ?? DEFAULT_REDIRECT_URI;
  const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  const scopes = options.scopes ?? DEFAULT_SCOPES;
  const refreshSkewMs = options.refreshSkewMs ?? 5 * 60_000;

  const flow: OAuthFlow = {
    refreshSkewMs,
    login: async (interaction, context) => {
      if (!interaction.prompt)
        throw new AiRuntimeError(
          'AUTH_INTERACTION_UNSUPPORTED',
          'auth',
          'OAuth login requires a manual-code prompt interaction',
        );
      const state = base64Url(context.random.bytes(32));
      const verifier = base64Url(context.random.bytes(32));
      const authorizationUrl = new URL(authorizeEndpoint);
      authorizationUrl.searchParams.set('client_id', clientId);
      authorizationUrl.searchParams.set('redirect_uri', redirectUri);
      authorizationUrl.searchParams.set('response_type', 'code');
      authorizationUrl.searchParams.set('scope', scopes.join(' '));
      authorizationUrl.searchParams.set('state', state);
      authorizationUrl.searchParams.set(
        'code_challenge',
        createHash('sha256').update(verifier).digest('base64url'),
      );
      authorizationUrl.searchParams.set('code_challenge_method', 'S256');
      await context.networkPolicy.authorize(
        authorizationUrl,
        { purpose: 'authorize' },
        context.signal,
      );
      await interaction.notify?.({
        type: 'auth_url',
        url: authorizationUrl.href,
        instructions: 'Authorize Anthropic, then paste the returned code.',
      });
      await interaction.openBrowser?.(authorizationUrl);
      const entered = await interaction.prompt({
        type: 'manual_code',
        message: 'Paste the Anthropic authorization code',
        placeholder: 'code#state',
        signal: context.signal,
      });
      const parsed = parseAuthorizationCode(entered, state);
      const token = await sendTokenRequest(context, tokenEndpoint, {
        grant_type: 'authorization_code',
        code: secret(parsed.code),
        state,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: secret(verifier),
      });
      return parseCredentialResult(
        token,
        await context.clock.now(context.signal),
      );
    },
    refresh: async (credential, context) => {
      const token = await sendTokenRequest(context, tokenEndpoint, {
        grant_type: 'refresh_token',
        refresh_token: credential.refreshToken,
        client_id: clientId,
      });
      return parseCredentialResult(
        token,
        await context.clock.now(context.signal),
        credential,
      );
    },
    toRequestAuth: (credential) => ({
      type: 'bearer_token',
      secret: credential.accessToken,
      scheme: 'Bearer',
    }),
    ...(revokeEndpoint
      ? {
          revoke: async (
            credential: OAuthCredential,
            context: AuthFlowContext,
          ) => {
            await context.networkPolicy.authorize(
              revokeEndpoint,
              { purpose: 'revoke' },
              context.signal,
            );
            const response = await context.transport.send({
              method: 'POST',
              url: revokeEndpoint,
              headers: { 'content-type': 'application/json' },
              body: {
                type: 'json',
                fields: {
                  token: credential.refreshToken,
                  client_id: clientId,
                },
              },
              redirect: 'error',
              maxResponseBytes: 64 * 1024,
              signal: context.signal,
            });
            if (response.status < 200 || response.status >= 300)
              throw oauthFailure('ANTHROPIC_OAUTH_REVOKE_FAILED');
          },
        }
      : {}),
  };
  return Object.freeze(flow);
}

async function sendTokenRequest(
  context: AuthFlowContext,
  endpoint: URL,
  fields: Readonly<
    Record<string, JsonValue | import('../../secret-value.js').SecretValue>
  >,
): Promise<AuthHttpResponse> {
  await context.networkPolicy.authorize(
    endpoint,
    { purpose: 'token' },
    context.signal,
  );
  const response = await context.transport.send({
    method: 'POST',
    url: endpoint,
    headers: { 'content-type': 'application/json' },
    body: { type: 'json', fields },
    redirect: 'error',
    maxResponseBytes: 64 * 1024,
    signal: context.signal,
  });
  if (response.status < 200 || response.status >= 300)
    throw oauthFailure('ANTHROPIC_OAUTH_TOKEN_FAILED');
  return response;
}

function parseCredentialResult(
  response: AuthHttpResponse,
  now: number,
  previous?: OAuthCredential,
): OAuthCredentialResult {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(new TextDecoder().decode(response.body)) as Record<
      string,
      unknown
    >;
  } catch {
    throw oauthFailure('ANTHROPIC_OAUTH_INVALID_RESPONSE');
  }
  const accessToken = requiredString(value.access_token);
  const refreshToken = optionalString(value.refresh_token);
  const expiresIn = requiredNumber(value.expires_in);
  const account = object(value.account);
  const providerAccountId =
    optionalString(value.account_id) ??
    optionalString(account.uuid) ??
    previous?.providerAccountId;
  if (!refreshToken && !previous)
    throw oauthFailure('ANTHROPIC_OAUTH_INVALID_RESPONSE');
  const credential: OAuthCredential = Object.freeze({
    type: 'oauth',
    accessToken: secret(accessToken),
    refreshToken: refreshToken ? secret(refreshToken) : previous!.refreshToken,
    expiresAt: now + expiresIn * 1000,
    ...(providerAccountId ? { providerAccountId } : {}),
  });
  return Object.freeze({
    credential,
    catalogAuth: Object.freeze({ catalogVisibilityFingerprint: 'default' }),
    ...(providerAccountId ? { providerAccountLabel: providerAccountId } : {}),
  });
}

function parseAuthorizationCode(
  entered: string,
  expectedState: string,
): { readonly code: string } {
  const marker = entered.lastIndexOf('#');
  const code = marker < 0 ? entered.trim() : entered.slice(0, marker).trim();
  const state = marker < 0 ? undefined : entered.slice(marker + 1).trim();
  if (!code || state !== expectedState)
    throw oauthFailure('ANTHROPIC_OAUTH_STATE_MISMATCH');
  return { code };
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function oauthFailure(code: string): AiRuntimeError {
  return new AiRuntimeError(code, 'auth', 'Anthropic OAuth request failed');
}

function requiredString(value: unknown): string {
  const result = optionalString(value);
  if (!result) throw oauthFailure('ANTHROPIC_OAUTH_INVALID_RESPONSE');
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requiredNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw oauthFailure('ANTHROPIC_OAUTH_INVALID_RESPONSE');
  return value;
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
