import type { JsonValue } from '../core/content.js';
import type { SecretValue } from './secret-value.js';

export type CredentialBindingFacts = Readonly<Record<string, JsonValue>>;

export type RequestCredentialOverride =
  | {
      readonly type: 'api_key';
      readonly secret: SecretValue;
      readonly scheme?: string;
      readonly bindingFacts?: CredentialBindingFacts;
    }
  | {
      readonly type: 'bearer_token';
      readonly secret: SecretValue;
      readonly scheme?: string;
      readonly bindingFacts?: CredentialBindingFacts;
    }
  | {
      readonly type: 'provider_secret';
      readonly secret: SecretValue;
      readonly scheme: string;
      readonly bindingFacts?: CredentialBindingFacts;
    };

export function credentialScheme(override: RequestCredentialOverride): string {
  return override.scheme ?? 'Bearer';
}
