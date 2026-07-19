import type { JsonValue } from '../core/content.js';
import type { ProviderSnapshot } from '../core/models.js';
import type { CatalogAuthView, Credential } from './credential-store.js';
import type { AuthInteraction } from './login.js';
import type { SecretValue } from './secret-value.js';

export type OAuthCredential = Extract<Credential, { type: 'oauth' }>;

export type AuthPrompt = { readonly signal?: AbortSignal } & (
  | Readonly<{ type: 'text'; message: string; placeholder?: string }>
  | Readonly<{ type: 'secret'; message: string; placeholder?: string }>
  | Readonly<{
      type: 'select';
      message: string;
      options: readonly Readonly<{
        id: string;
        label: string;
        description?: string;
      }>[];
    }>
  | Readonly<{
      type: 'manual_code';
      message: string;
      placeholder?: string;
    }>
);

export type AuthEvent =
  | Readonly<{ type: 'info' | 'progress'; message: string }>
  | Readonly<{ type: 'auth_url'; url: string; instructions?: string }>
  | Readonly<{
      type: 'device_code';
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresAt?: number;
    }>;

export interface AuthHttpRequest {
  readonly method: 'GET' | 'POST';
  readonly url: URL;
  readonly headers?: Readonly<Record<string, string | SecretValue>>;
  readonly body?:
    | Readonly<{
        type: 'form';
        fields: Readonly<Record<string, string | SecretValue>>;
      }>
    | Readonly<{
        type: 'json';
        fields: Readonly<Record<string, JsonValue | SecretValue>>;
      }>
    | Readonly<{ type: 'bytes'; data: Uint8Array }>;
  readonly redirect: 'error' | 'same-origin';
  readonly maxResponseBytes: number;
  readonly signal: AbortSignal;
}

export interface AuthHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface AuthHttpTransport {
  send(request: AuthHttpRequest): Promise<AuthHttpResponse>;
}

export interface AuthNetworkPolicy {
  authorize(
    url: URL,
    context: Readonly<{
      purpose: 'discovery' | 'authorize' | 'device' | 'token' | 'revoke';
      issuer?: string;
      redirectFrom?: URL;
    }>,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface AuthClock {
  now(signal?: AbortSignal): Promise<number>;
}

export interface SecureRandom {
  bytes(length: number): Uint8Array;
}

export interface AuthFlowContext {
  readonly provider: Readonly<ProviderSnapshot>;
  readonly signal: AbortSignal;
  readonly transport: AuthHttpTransport;
  readonly networkPolicy: AuthNetworkPolicy;
  readonly clock: AuthClock;
  readonly random: SecureRandom;
}

export interface OAuthCredentialResult {
  readonly credential: OAuthCredential;
  readonly catalogAuth: CatalogAuthView;
  readonly providerAccountLabel?: string;
}

export interface OAuthFlow {
  readonly refreshSkewMs: number;
  login(
    interaction: AuthInteraction,
    context: AuthFlowContext,
  ): Promise<OAuthCredentialResult>;
  refresh(
    credential: OAuthCredential,
    context: AuthFlowContext,
  ): Promise<OAuthCredentialResult>;
  toRequestAuth(credential: OAuthCredential): Readonly<{
    type: 'bearer_token';
    secret: SecretValue;
    scheme: 'Bearer';
  }>;
  readonly revoke?: (
    credential: OAuthCredential,
    context: AuthFlowContext,
  ) => Promise<void>;
}

export interface AuthRuntimeOptions {
  readonly transport: AuthHttpTransport;
  readonly networkPolicy: AuthNetworkPolicy;
  readonly clock?: AuthClock;
  readonly random?: SecureRandom;
}
