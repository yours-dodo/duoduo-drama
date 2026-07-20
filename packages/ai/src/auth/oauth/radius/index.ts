import { createHash } from 'node:crypto';
import type { JsonValue } from '../../../core/content.js';
import type {
  AuthFlowContext,
  OAuthCredential,
  OAuthCredentialResult,
  OAuthFlow,
} from '../../oauth.js';
import type { AuthInteraction } from '../../login.js';
import {
  abortableDelay,
  base64Url,
  credentialResultFromToken,
  parseJson,
  positiveNumber,
  requiredString,
  sendOAuthForm,
} from '../_shared/http.js';

export interface RadiusOAuthFlowOptions {
  readonly gateway?: string;
  readonly redirectUri?: string;
}

interface RadiusOAuthConfig {
  readonly authorizationEndpoint: URL;
  readonly tokenEndpoint: URL;
  readonly deviceAuthorizationEndpoint?: URL;
  readonly revocationEndpoint?: URL;
  readonly clientId: string;
  readonly scope: string;
  readonly deviceCodeGrantType: string;
  readonly gatewayBaseUrl?: string;
}

export function createRadiusOAuthFlow(
  options: RadiusOAuthFlowOptions = {},
): OAuthFlow {
  const gateway = secureGateway(options.gateway ?? 'https://radius.pi.dev');
  const redirectUri =
    options.redirectUri ?? 'http://127.0.0.1:19876/oauth/callback';
  return Object.freeze({
    refreshSkewMs: 60_000,
    login: async (interaction: AuthInteraction, context: AuthFlowContext) => {
      const config = await discoverRadiusOAuthConfig(gateway, context);
      const method =
        config.deviceAuthorizationEndpoint && interaction.prompt
          ? await interaction.prompt({
              type: 'select',
              message: 'Choose Radius sign-in method',
              options: [
                { id: 'browser', label: 'Browser PKCE' },
                { id: 'device-code', label: 'Device code' },
              ],
              signal: context.signal,
            })
          : 'browser';
      let token: Record<string, unknown>;
      if (method === 'device-code' && config.deviceAuthorizationEndpoint) {
        const device = await sendOAuthForm(
          context,
          config.deviceAuthorizationEndpoint,
          'device',
          {
            client_id: config.clientId,
            scope: config.scope,
          },
        );
        const userCode = requiredString(device.user_code, 'user_code');
        await interaction.notify?.({
          type: 'device_code',
          userCode,
          verificationUri: requiredString(
            device.verification_uri ?? device.verification_url,
            'verification_uri',
          ),
          intervalSeconds: positiveNumber(device.interval) ?? 5,
        });
        token = await pollDeviceToken(
          context,
          config,
          requiredString(device.device_code, 'device_code'),
          positiveNumber(device.interval) ?? 5,
          positiveNumber(device.expires_in) ?? 900,
        );
      } else {
        const verifier = base64Url(context.random.bytes(32));
        const challenge = createHash('sha256')
          .update(verifier)
          .digest('base64url');
        const state = base64Url(context.random.bytes(18));
        const authorize = new URL(config.authorizationEndpoint);
        authorize.search = new URLSearchParams({
          response_type: 'code',
          client_id: config.clientId,
          redirect_uri: redirectUri,
          scope: config.scope,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        }).toString();
        await context.networkPolicy.authorize(
          authorize,
          { purpose: 'authorize' },
          context.signal,
        );
        await interaction.notify?.({
          type: 'auth_url',
          url: authorize.href,
          instructions: 'Complete sign in and paste the callback URL.',
        });
        await interaction.openBrowser?.(authorize);
        if (!interaction.prompt)
          throw new Error('Radius browser login requires a manual code prompt');
        const entered = await interaction.prompt({
          type: 'manual_code',
          message: 'Paste the Radius callback URL or authorization code',
          signal: context.signal,
        });
        token = await sendOAuthForm(context, config.tokenEndpoint, 'token', {
          grant_type: 'authorization_code',
          client_id: config.clientId,
          redirect_uri: redirectUri,
          code: parseCode(entered, state),
          code_verifier: verifier,
        });
      }
      return radiusCredentialResult(token, config, context);
    },
    refresh: async (credential: OAuthCredential, context: AuthFlowContext) => {
      const config = await discoverRadiusOAuthConfig(gateway, context);
      const token = await sendOAuthForm(
        context,
        config.tokenEndpoint,
        'token',
        {
          grant_type: 'refresh_token',
          client_id: config.clientId,
          refresh_token: credential.refreshToken,
        },
      );
      return radiusCredentialResult(token, config, context, credential);
    },
    revoke: async (credential: OAuthCredential, context: AuthFlowContext) => {
      const config = await discoverRadiusOAuthConfig(gateway, context);
      if (!config.revocationEndpoint) return;
      await sendOAuthForm(context, config.revocationEndpoint, 'revoke', {
        token: credential.refreshToken,
        client_id: config.clientId,
      });
    },
    toRequestAuth: (credential: OAuthCredential) => ({
      type: 'bearer_token' as const,
      secret: credential.accessToken,
      scheme: 'Bearer',
      ...(typeof credential.metadata?.radiusBaseUrl === 'string'
        ? { bindingFacts: { radiusBaseUrl: credential.metadata.radiusBaseUrl } }
        : {}),
    }),
  });
}

export async function discoverRadiusOAuthConfig(
  gateway: URL | string,
  context: AuthFlowContext,
): Promise<RadiusOAuthConfig> {
  const normalizedGateway =
    typeof gateway === 'string' ? secureGateway(gateway) : gateway;
  const endpoint = new URL('/v1/oauth', normalizedGateway);
  await context.networkPolicy.authorize(
    endpoint,
    { purpose: 'discovery' },
    context.signal,
  );
  const response = await context.transport.send({
    method: 'GET',
    url: endpoint,
    headers: { accept: 'application/json' },
    redirect: 'error',
    maxResponseBytes: 256 * 1024,
    signal: context.signal,
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error(
      `Radius OAuth discovery failed with HTTP ${response.status}`,
    );
  const value = parseJson(response);
  const authorizationEndpoint = secureDiscoveredUrl(
    requiredString(
      value.authorizationEndpoint ?? value.authorization_endpoint,
      'authorizationEndpoint',
    ),
    normalizedGateway,
  );
  const tokenEndpoint = secureDiscoveredUrl(
    requiredString(
      value.tokenEndpoint ?? value.token_endpoint,
      'tokenEndpoint',
    ),
    normalizedGateway,
  );
  const deviceRaw =
    value.deviceAuthorizationEndpoint ?? value.device_authorization_endpoint;
  const revocationRaw = value.revocationEndpoint ?? value.revocation_endpoint;
  const gatewayBaseRaw = value.baseUrl ?? value.base_url;
  return Object.freeze({
    authorizationEndpoint,
    tokenEndpoint,
    ...(typeof deviceRaw === 'string'
      ? {
          deviceAuthorizationEndpoint: secureDiscoveredUrl(
            deviceRaw,
            normalizedGateway,
          ),
        }
      : {}),
    ...(typeof revocationRaw === 'string'
      ? {
          revocationEndpoint: secureDiscoveredUrl(
            revocationRaw,
            normalizedGateway,
          ),
        }
      : {}),
    clientId: requiredString(value.clientId ?? value.client_id, 'clientId'),
    scope:
      typeof value.scope === 'string' ? value.scope : 'openid offline_access',
    deviceCodeGrantType:
      typeof value.deviceCodeGrantType === 'string'
        ? value.deviceCodeGrantType
        : 'urn:ietf:params:oauth:grant-type:device_code',
    ...(typeof gatewayBaseRaw === 'string'
      ? {
          gatewayBaseUrl: secureDiscoveredUrl(
            gatewayBaseRaw,
            normalizedGateway,
          ).href.replace(/\/+$/u, ''),
        }
      : {}),
  });
}

async function pollDeviceToken(
  context: AuthFlowContext,
  config: RadiusOAuthConfig,
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number,
): Promise<Record<string, unknown>> {
  const startedAt = await context.clock.now(context.signal);
  let interval = intervalSeconds;
  for (;;) {
    try {
      return await sendOAuthForm(context, config.tokenEndpoint, 'token', {
        grant_type: config.deviceCodeGrantType,
        client_id: config.clientId,
        device_code: deviceCode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now = await context.clock.now(context.signal);
      if (now - startedAt >= expiresInSeconds * 1000) throw error;
      if (!/authorization_pending|slow_down/iu.test(message)) throw error;
      if (/slow_down/iu.test(message)) interval += 5;
      await abortableDelay(interval * 1000, context.signal);
    }
  }
}

async function radiusCredentialResult(
  token: Record<string, unknown>,
  config: RadiusOAuthConfig,
  context: AuthFlowContext,
  previous?: OAuthCredential,
): Promise<OAuthCredentialResult> {
  const metadata: Record<string, JsonValue> = {};
  if (config.gatewayBaseUrl) metadata.radiusBaseUrl = config.gatewayBaseUrl;
  const result = await credentialResultFromToken(
    token,
    context,
    previous,
    metadata,
  );
  return Object.freeze({
    ...result,
    catalogAuth: Object.freeze({
      ...result.catalogAuth,
      catalogVisibilityFingerprint: createHash('sha256')
        .update(JSON.stringify(['radius', config.gatewayBaseUrl ?? null]))
        .digest('base64url'),
    }),
  });
}

function parseCode(value: string, expectedState: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.searchParams.get('state') !== expectedState)
      throw new Error('Radius OAuth state mismatch');
    return requiredString(url.searchParams.get('code'), 'code');
  } catch (error) {
    if (/^https?:/iu.test(trimmed)) throw error;
    if (!trimmed) throw new Error('Radius authorization code is empty');
    return trimmed;
  }
}

function secureGateway(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new TypeError('Radius gateway must be a plain HTTPS URL');
  return url;
}
function secureDiscoveredUrl(value: string, gateway: URL): URL {
  const url = new URL(value, gateway);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new TypeError('Radius OAuth endpoint must use HTTPS');
  const suffix = (host: string) =>
    host.toLowerCase().split('.').slice(-2).join('.');
  if (
    url.origin !== gateway.origin &&
    suffix(url.hostname) !== suffix(gateway.hostname)
  )
    throw new TypeError(
      'Radius OAuth endpoint origin is not allowed by the gateway binding',
    );
  return url;
}
