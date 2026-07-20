import { AiRuntimeError } from '../../../core/errors.js';
import type { JsonValue } from '../../../core/content.js';
import type {
  AuthFlowContext,
  AuthHttpResponse,
  OAuthCredential,
  OAuthCredentialResult,
} from '../../oauth.js';
import { secret, type SecretValue } from '../../secret-value.js';

export async function sendOAuthForm(
  context: AuthFlowContext,
  endpoint: URL,
  purpose: 'device' | 'token' | 'revoke' | 'discovery',
  fields: Readonly<Record<string, string | SecretValue>>,
  method: 'GET' | 'POST' = 'POST',
): Promise<Record<string, unknown>> {
  await context.networkPolicy.authorize(endpoint, { purpose }, context.signal);
  const response = await context.transport.send({
    method,
    url: endpoint,
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    ...(method === 'POST' ? { body: { type: 'form' as const, fields } } : {}),
    redirect: 'error',
    maxResponseBytes: 256 * 1024,
    signal: context.signal,
  });
  if (response.status < 200 || response.status >= 300)
    throw oauthHttpError(response);
  return parseJson(response);
}

export async function sendOAuthJson(
  context: AuthFlowContext,
  endpoint: URL,
  purpose: 'device' | 'token' | 'revoke' | 'discovery',
  fields: Readonly<Record<string, JsonValue | SecretValue>>,
): Promise<Record<string, unknown>> {
  await context.networkPolicy.authorize(endpoint, { purpose }, context.signal);
  const response = await context.transport.send({
    method: 'POST',
    url: endpoint,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: { type: 'json', fields },
    redirect: 'error',
    maxResponseBytes: 256 * 1024,
    signal: context.signal,
  });
  if (response.status < 200 || response.status >= 300)
    throw oauthHttpError(response);
  return parseJson(response);
}

function oauthHttpError(response: AuthHttpResponse): AiRuntimeError {
  let detail = '';
  try {
    const payload = parseJson(response);
    const code = optionalString(payload.error);
    const description = optionalString(payload.error_description);
    detail = [code, description].filter(Boolean).join(': ');
  } catch {
    // Ignore malformed error bodies; status remains authoritative.
  }
  return new AiRuntimeError(
    `OAUTH_HTTP_${response.status}`,
    response.status === 401 || response.status === 403 ? 'auth' : 'provider',
    `OAuth request failed with HTTP ${response.status}${detail ? ` (${detail})` : ''}`,
    response.status === 429 || response.status >= 500,
  );
}

export function parseJson(response: AuthHttpResponse): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(response.body));
  } catch {
    throw invalidOAuthResponse('OAuth response is not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidOAuthResponse('OAuth response must be an object');
  return value as Record<string, unknown>;
}

export async function credentialResultFromToken(
  payload: Record<string, unknown>,
  context: AuthFlowContext,
  previous?: OAuthCredential,
  metadata: Readonly<Record<string, JsonValue>> = {},
): Promise<OAuthCredentialResult> {
  const accessToken = requiredString(payload.access_token, 'access_token');
  const refreshToken = optionalString(payload.refresh_token);
  if (!refreshToken && !previous)
    throw invalidOAuthResponse('OAuth response is missing refresh_token');
  const expiresAt = parseExpiresAt(
    payload,
    await context.clock.now(context.signal),
  );
  const providerAccountId =
    optionalString(payload.account_id) ??
    decodeJwtStringClaim(accessToken, 'chatgpt_account_id') ??
    previous?.providerAccountId;
  return Object.freeze({
    credential: Object.freeze({
      type: 'oauth' as const,
      accessToken: secret(accessToken),
      refreshToken: refreshToken
        ? secret(refreshToken)
        : previous!.refreshToken,
      expiresAt,
      ...(providerAccountId ? { providerAccountId } : {}),
      ...(Object.keys(metadata).length
        ? { metadata: Object.freeze(metadata) }
        : {}),
    }),
    catalogAuth: Object.freeze({
      catalogVisibilityFingerprint: 'all-models',
      ...(Object.keys(metadata).length
        ? { publicMetadata: Object.freeze(metadata) }
        : {}),
    }),
    ...(providerAccountId ? { providerAccountLabel: providerAccountId } : {}),
  });
}

export function parseExpiresAt(
  payload: Record<string, unknown>,
  now: number,
): number {
  const explicit = positiveNumber(payload.expires_at);
  if (explicit !== undefined)
    return explicit > 10_000_000_000 ? explicit : explicit * 1000;
  const expiresIn = positiveNumber(payload.expires_in);
  if (expiresIn !== undefined) return now + expiresIn * 1000;
  return now + 3_600_000;
}

export function requiredString(value: unknown, field: string): string {
  const result = optionalString(value);
  if (!result) throw invalidOAuthResponse(`OAuth response is missing ${field}`);
  return result;
}
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
export function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
export function invalidOAuthResponse(message: string): AiRuntimeError {
  return new AiRuntimeError(
    'OAUTH_INVALID_RESPONSE',
    'invalid_response',
    message,
  );
}

export async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, milliseconds));
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve().then(() => {
      if (!signal.aborted) return;
      abort();
    });
  });
}

export function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function decodeJwtStringClaim(
  token: string,
  claim: string,
): string | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const value = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined;
    const direct = (value as Record<string, unknown>)[claim];
    if (typeof direct === 'string') return direct;
    const auth = (value as Record<string, unknown>)[
      'https://api.openai.com/auth'
    ];
    return auth && typeof auth === 'object' && !Array.isArray(auth)
      ? optionalString((auth as Record<string, unknown>)[claim])
      : undefined;
  } catch {
    return undefined;
  }
}
