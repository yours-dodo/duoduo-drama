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
import { resolveGitHubCopilotOrigin } from './endpoint.js';

const DEFAULT_DEVICE_ENDPOINT = 'https://github.com/login/device/code';
const DEFAULT_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
const DEFAULT_COPILOT_TOKEN_ENDPOINT =
  'https://api.github.com/copilot_internal/v2/token';
const DEFAULT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEFAULT_SCOPES = Object.freeze(['read:user']);

export interface CreateGitHubCopilotOAuthFlowOptions {
  readonly deviceEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly copilotTokenEndpoint?: string;
  readonly clientId?: string;
  readonly scopes?: readonly string[];
  readonly enterpriseDomain?: string;
  readonly refreshSkewMs?: number;
}

export function createGitHubCopilotOAuthFlow(
  options: CreateGitHubCopilotOAuthFlowOptions = {},
): OAuthFlow {
  const deviceEndpoint = secureUrl(
    options.deviceEndpoint ?? DEFAULT_DEVICE_ENDPOINT,
  );
  const tokenEndpoint = secureUrl(
    options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
  );
  const copilotTokenEndpoint = secureUrl(
    options.copilotTokenEndpoint ?? DEFAULT_COPILOT_TOKEN_ENDPOINT,
  );
  const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  const scopes = options.scopes ?? DEFAULT_SCOPES;

  return {
    refreshSkewMs: options.refreshSkewMs ?? 5 * 60_000,
    login: async (interaction, context) => {
      const device = await sendJson(context, deviceEndpoint, {
        method: 'POST',
        purpose: 'device',
        body: {
          type: 'form',
          fields: { client_id: clientId, scope: scopes.join(' ') },
        },
      });
      const deviceCode = requireString(device, 'device_code');
      const userCode = requireString(device, 'user_code');
      const verificationUri = requireString(device, 'verification_uri');
      const intervalSeconds = optionalPositiveNumber(device, 'interval') ?? 5;
      const now = await context.clock.now(context.signal);
      const expiresInSeconds =
        optionalPositiveNumber(device, 'expires_in') ?? 900;
      await interaction.notify?.({
        type: 'device_code',
        userCode,
        verificationUri,
        intervalSeconds,
        expiresAt: now + expiresInSeconds * 1_000,
      });
      await interaction.openBrowser?.(new URL(verificationUri));

      const githubToken = await pollGitHubToken(
        context,
        tokenEndpoint,
        clientId,
        secret(deviceCode),
      );
      return exchangeCopilotToken(
        context,
        copilotTokenEndpoint,
        githubToken,
        options.enterpriseDomain,
      );
    },
    refresh: (credential, context) =>
      exchangeCopilotToken(
        context,
        copilotTokenEndpoint,
        credential.refreshToken,
        options.enterpriseDomain,
        credential,
      ),
    toRequestAuth: (credential) => ({
      type: 'bearer_token',
      secret: credential.accessToken,
      scheme: 'Bearer',
      ...(credential.metadata ? { bindingFacts: credential.metadata } : {}),
    }),
  };
}

async function pollGitHubToken(
  context: AuthFlowContext,
  tokenEndpoint: URL,
  clientId: string,
  deviceCode: ReturnType<typeof secret>,
) {
  const token = await sendJson(context, tokenEndpoint, {
    method: 'POST',
    purpose: 'token',
    body: {
      type: 'form',
      fields: {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
    },
  });
  if (typeof token.error === 'string')
    throw new AiRuntimeError(
      `GITHUB_DEVICE_${token.error.toUpperCase()}`,
      'auth',
      'GitHub device authorization did not complete',
      token.error === 'authorization_pending' || token.error === 'slow_down',
    );
  return secret(requireString(token, 'access_token'));
}

async function exchangeCopilotToken(
  context: AuthFlowContext,
  endpoint: URL,
  githubToken: ReturnType<typeof secret>,
  enterpriseDomain?: string,
  previous?: OAuthCredential,
): Promise<OAuthCredentialResult> {
  const payload = await sendJson(context, endpoint, {
    method: 'GET',
    purpose: 'token',
    headers: {
      authorization: githubToken,
      accept: 'application/json',
      'editor-version': 'duoduo-ai/1.0',
      'editor-plugin-version': 'duoduo-ai/1.0',
      'user-agent': '@duoduo/ai',
    },
  });
  const tokenValue = requireString(payload, 'token');
  const endpointOrigin = resolveGitHubCopilotOrigin({
    copilotToken: tokenValue,
    enterpriseDomain,
  });
  const visibleModelIds = stringArray(
    payload.available_models ?? payload.models,
  );
  const now = await context.clock.now(context.signal);
  const expiresAt = parseExpiresAt(payload, tokenValue, now);
  const providerAccountId = optionalString(payload, 'account_id');
  const metadata: Readonly<Record<string, JsonValue>> = Object.freeze({
    endpointOrigin,
    ...(visibleModelIds ? { visibleModelIds } : {}),
  });
  const catalogVisibilityFingerprint = createHash('sha256')
    .update(JSON.stringify([endpointOrigin, visibleModelIds ?? []]))
    .digest('base64url');
  return {
    credential: Object.freeze({
      type: 'oauth' as const,
      accessToken: secret(tokenValue),
      refreshToken: previous?.refreshToken ?? githubToken,
      expiresAt,
      ...(providerAccountId ? { providerAccountId } : {}),
      metadata,
    }),
    catalogAuth: Object.freeze({
      catalogVisibilityFingerprint,
      ...(visibleModelIds
        ? { visibleModelIds: Object.freeze(visibleModelIds) }
        : {}),
      publicMetadata: Object.freeze({ endpointOrigin }),
    }),
    ...(providerAccountId ? { providerAccountLabel: providerAccountId } : {}),
  };
}

function parseExpiresAt(
  payload: Readonly<Record<string, unknown>>,
  token: string,
  now: number,
): number {
  const explicit = optionalPositiveNumber(payload, 'expires_at');
  if (explicit !== undefined) return explicit * 1_000;
  const expiresIn = optionalPositiveNumber(payload, 'expires_in');
  if (expiresIn !== undefined) return now + expiresIn * 1_000;
  const tokenExpiry = token
    .split(';')
    .find((field) => field.startsWith('exp='));
  if (tokenExpiry) {
    const value = Number(tokenExpiry.slice(4));
    if (Number.isFinite(value) && value > 0) return value * 1_000;
  }
  throw invalidResponse('Copilot token expiry is missing');
}

async function sendJson(
  context: AuthFlowContext,
  url: URL,
  input: Readonly<{
    method: 'GET' | 'POST';
    purpose: 'device' | 'token';
    headers?: import('../../oauth.js').AuthHttpRequest['headers'];
    body?: import('../../oauth.js').AuthHttpRequest['body'];
  }>,
): Promise<Readonly<Record<string, unknown>>> {
  await context.networkPolicy.authorize(
    url,
    { purpose: input.purpose },
    context.signal,
  );
  const response = await context.transport.send({
    method: input.method,
    url,
    headers: input.headers,
    body: input.body,
    redirect: 'error',
    maxResponseBytes: 128 * 1024,
    signal: context.signal,
  });
  if (response.status < 200 || response.status >= 300)
    throw new AiRuntimeError(
      `GITHUB_COPILOT_HTTP_${response.status}`,
      response.status === 401 || response.status === 403 ? 'auth' : 'provider',
      `GitHub Copilot auth request failed with HTTP ${response.status}`,
      response.status === 429 || response.status >= 500,
    );
  return parseJson(response);
}

function parseJson(
  response: AuthHttpResponse,
): Readonly<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(response.body));
  } catch {
    throw invalidResponse('GitHub Copilot auth response is not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidResponse('GitHub Copilot auth response must be an object');
  return value as Readonly<Record<string, unknown>>;
}

function requireString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const result = optionalString(value, key);
  if (!result)
    throw invalidResponse(`GitHub Copilot response is missing ${key}`);
  return result;
}

function optionalString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : undefined;
}

function optionalPositiveNumber(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const candidate = value[key];
  return typeof candidate === 'number' &&
    Number.isFinite(candidate) &&
    candidate > 0
    ? candidate
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.length > 0,
  );
  return result.length > 0 ? [...new Set(result)] : undefined;
}

function secureUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('GitHub Copilot OAuth endpoint must be a plain HTTPS URL');
  return url;
}

function invalidResponse(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'GITHUB_COPILOT_INVALID_AUTH_RESPONSE',
    'invalid_response',
    message,
  );
}

export { resolveGitHubCopilotOrigin } from './endpoint.js';
