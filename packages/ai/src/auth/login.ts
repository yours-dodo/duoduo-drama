import type { AiDiagnostic } from '../core/events.js';
import type { AuthEvent, AuthPrompt } from './oauth.js';
import type { SecretValue } from './secret-value.js';

export interface AuthInteraction {
  readonly signal?: AbortSignal;
  openBrowser?(url: URL): Promise<'opened' | 'unavailable'>;
  prompt?(prompt: AuthPrompt): Promise<string>;
  promptSecret(
    request: Readonly<{
      providerInstanceId: string;
      method: 'api_key';
      label: string;
    }>,
  ): Promise<SecretValue>;
  notify?(
    message: AuthEvent | Readonly<{ level: 'info' | 'warning'; text: string }>,
  ): Promise<void> | void;
}

export type AuthStatus =
  | Readonly<{ status: 'unconfigured' }>
  | Readonly<{
      status: 'ready';
      source: 'stored' | 'ambient';
      method: 'api_key' | 'oauth' | 'ambient_config';
      providerAccountLabel?: string;
    }>
  | Readonly<{ status: 'backoff'; retryAt: number; errorCode: string }>
  | Readonly<{ status: 'reauth_required'; errorCode: string }>;

export interface AuthLogoutResult {
  readonly local: 'removed' | 'already_empty';
  readonly remote: 'not_requested' | 'revoked' | 'unsupported' | 'failed';
  readonly diagnostics?: readonly AiDiagnostic[];
}

export interface AuthApi<TScopeHandle> {
  status(
    providerInstanceId: string,
    scope: TScopeHandle,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AuthStatus>;
  login(
    providerInstanceId: string,
    method: 'api_key' | 'oauth' | 'ambient_config',
    scope: TScopeHandle,
    interaction: AuthInteraction,
    options?: { readonly secretScheme?: string; readonly signal?: AbortSignal },
  ): Promise<AuthStatus>;
  logout(
    providerInstanceId: string,
    scope: TScopeHandle,
    options?: {
      readonly revokeRemote?: boolean;
      readonly signal?: AbortSignal;
    },
  ): Promise<AuthLogoutResult>;
}
