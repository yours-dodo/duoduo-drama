import type { AuthInteraction } from '../../login.js';
import type {
  AuthFlowContext,
  OAuthCredential,
  OAuthFlow,
} from '../../oauth.js';
import {
  abortableDelay,
  credentialResultFromToken,
  positiveNumber,
  requiredString,
  sendOAuthForm,
} from '../_shared/http.js';

export interface XAiOAuthFlowOptions {
  readonly clientId?: string;
  readonly scope?: string;
  readonly deviceEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly revokeEndpoint?: string;
}

export function createXAiOAuthFlow(
  options: XAiOAuthFlowOptions = {},
): OAuthFlow {
  const clientId = options.clientId ?? 'b1a00492-073a-47ea-816f-4c329264a828';
  const scope = options.scope ?? 'offline_access';
  const deviceEndpoint = secureUrl(
    options.deviceEndpoint ?? 'https://auth.x.ai/oauth2/device/code',
  );
  const tokenEndpoint = secureUrl(
    options.tokenEndpoint ?? 'https://auth.x.ai/oauth2/token',
  );
  const revokeEndpoint = options.revokeEndpoint
    ? secureUrl(options.revokeEndpoint)
    : undefined;
  return Object.freeze({
    refreshSkewMs: 5 * 60 * 1000,
    login: async (interaction: AuthInteraction, context: AuthFlowContext) => {
      const device = await sendOAuthForm(context, deviceEndpoint, 'device', {
        client_id: clientId,
        scope,
      });
      const deviceCode = requiredString(device.device_code, 'device_code');
      const userCode = requiredString(device.user_code, 'user_code');
      const verificationUri = requiredString(
        device.verification_uri ?? device.verification_url,
        'verification_uri',
      );
      const interval = positiveNumber(device.interval) ?? 5;
      const expiresIn = positiveNumber(device.expires_in) ?? 900;
      await interaction.notify?.({
        type: 'device_code',
        userCode,
        verificationUri,
        intervalSeconds: interval,
        expiresAt: (await context.clock.now(context.signal)) + expiresIn * 1000,
      });
      const token = await pollDeviceToken(
        context,
        tokenEndpoint,
        clientId,
        deviceCode,
        interval,
        expiresIn,
      );
      return credentialResultFromToken(token, context);
    },
    refresh: async (credential: OAuthCredential, context: AuthFlowContext) =>
      credentialResultFromToken(
        await sendOAuthForm(context, tokenEndpoint, 'token', {
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: credential.refreshToken,
        }),
        context,
        credential,
      ),
    ...(revokeEndpoint
      ? {
          revoke: async (
            credential: OAuthCredential,
            context: AuthFlowContext,
          ) => {
            await sendOAuthForm(context, revokeEndpoint, 'revoke', {
              token: credential.refreshToken,
              client_id: clientId,
            });
          },
        }
      : {}),
    toRequestAuth: (credential: OAuthCredential) => ({
      type: 'bearer_token' as const,
      secret: credential.accessToken,
      scheme: 'Bearer',
    }),
  });
}

async function pollDeviceToken(
  context: AuthFlowContext,
  endpoint: URL,
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number,
): Promise<Record<string, unknown>> {
  const startedAt = await context.clock.now(context.signal);
  let interval = intervalSeconds;
  for (;;) {
    try {
      return await sendOAuthForm(context, endpoint, 'token', {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
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

function secureUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new TypeError('xAI OAuth endpoint must use HTTPS');
  return url;
}
