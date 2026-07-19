import type { SecretValue } from './secret-value.js';

export type RequestCredentialOverride =
  | {
      readonly type: 'api_key';
      readonly secret: SecretValue;
      readonly scheme?: string;
    }
  | {
      readonly type: 'bearer_token';
      readonly secret: SecretValue;
      readonly scheme?: string;
    }
  | {
      readonly type: 'provider_secret';
      readonly secret: SecretValue;
      readonly scheme: string;
    };

export function credentialScheme(override: RequestCredentialOverride): string {
  return override.scheme ?? 'Bearer';
}
