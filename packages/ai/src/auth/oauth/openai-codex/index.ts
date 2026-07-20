import { createHash } from 'node:crypto';
import type {
  AuthFlowContext,
  OAuthCredential,
  OAuthFlow,
} from '../../oauth.js';
import type { AuthInteraction } from '../../login.js';
import {
  base64Url,
  credentialResultFromToken,
  requiredString,
  sendOAuthForm,
  sendOAuthJson,
} from '../_shared/http.js';

export interface OpenAiCodexOAuthFlowOptions {
  readonly clientId?: string;
  readonly authBaseUrl?: string;
  readonly redirectUri?: string;
  readonly scope?: string;
}

export function createOpenAiCodexOAuthFlow(
  options: OpenAiCodexOAuthFlowOptions = {},
): OAuthFlow {
  const clientId = options.clientId ?? 'app_EMoamEEZ73f0CkXaXp7hrann';
  const authBase = secureBaseUrl(
    options.authBaseUrl ?? 'https://auth.openai.com',
  );
  const tokenEndpoint = new URL('/oauth/token', authBase);
  const redirectUri =
    options.redirectUri ?? 'http://localhost:1455/auth/callback';
  const scope = options.scope ?? 'openid profile email offline_access';
  return Object.freeze({
    refreshSkewMs: 0,
    login: async (interaction: AuthInteraction, context: AuthFlowContext) => {
      const method = interaction.prompt
        ? await interaction.prompt({
            type: 'select',
            message: 'Choose OpenAI Codex sign-in method',
            options: [
              { id: 'browser', label: 'Browser PKCE' },
              { id: 'device_code', label: 'Device code' },
            ],
            signal: context.signal,
          })
        : 'device_code';
      if (method === 'browser') {
        const verifier = base64Url(context.random.bytes(32));
        const challenge = createHash('sha256')
          .update(verifier)
          .digest('base64url');
        const state = base64Url(context.random.bytes(18));
        const authorize = new URL('/oauth/authorize', authBase);
        authorize.search = new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
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
          instructions: 'Complete sign in, then paste the callback URL.',
        });
        await interaction.openBrowser?.(authorize);
        if (!interaction.prompt)
          throw new Error(
            'OpenAI Codex browser login requires a manual code prompt',
          );
        const entered = await interaction.prompt({
          type: 'manual_code',
          message: 'Paste the OpenAI Codex callback URL or authorization code',
          signal: context.signal,
        });
        const code = parseCode(entered, state);
        const token = await sendOAuthForm(context, tokenEndpoint, 'token', {
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        });
        return credentialResultFromToken(token, context);
      }
      const device = await sendOAuthJson(
        context,
        new URL('/api/accounts/deviceauth/usercode', authBase),
        'device',
        { client_id: clientId },
      );
      const userCode = requiredString(device.user_code, 'user_code');
      const deviceAuthId = requiredString(
        device.device_auth_id,
        'device_auth_id',
      );
      const verificationUri = new URL('/codex/device', authBase).href;
      await interaction.notify?.({
        type: 'device_code',
        userCode,
        verificationUri,
        intervalSeconds: 5,
      });
      const authorization = await sendOAuthJson(
        context,
        new URL('/api/accounts/deviceauth/token', authBase),
        'token',
        {
          device_auth_id: deviceAuthId,
          user_code: userCode,
        },
      );
      const token = await sendOAuthForm(context, tokenEndpoint, 'token', {
        grant_type: 'authorization_code',
        client_id: clientId,
        code: requiredString(
          authorization.authorization_code,
          'authorization_code',
        ),
        redirect_uri: new URL('/deviceauth/callback', authBase).href,
        code_verifier: requiredString(
          authorization.code_verifier,
          'code_verifier',
        ),
      });
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
    toRequestAuth: (credential: OAuthCredential) => ({
      type: 'bearer_token' as const,
      secret: credential.accessToken,
      scheme: 'Bearer',
      ...(credential.providerAccountId
        ? { bindingFacts: { accountId: credential.providerAccountId } }
        : {}),
    }),
  });
}

function parseCode(value: string, expectedState: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('OpenAI Codex authorization code is empty');
  try {
    const url = new URL(trimmed);
    if (url.searchParams.get('state') !== expectedState)
      throw new Error('OpenAI Codex OAuth state mismatch');
    return requiredString(url.searchParams.get('code'), 'code');
  } catch (error) {
    if (/^https?:/iu.test(trimmed)) throw error;
    return trimmed;
  }
}

function secureBaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new TypeError('OpenAI Codex authBaseUrl must be a plain HTTPS URL');
  return url;
}
