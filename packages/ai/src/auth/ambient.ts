import { createHmac, randomBytes } from 'node:crypto';

import type { RequestCredentialOverride } from './api-key.js';
import { secret } from './secret-value.js';

export interface EnvironmentSource {
  get(name: string): string | undefined;
}

export interface SecretCredentialSource {
  readonly environmentVariable: string;
  readonly scheme: string;
}

export interface EnvironmentCredentialResolution {
  readonly requestCredential: RequestCredentialOverride;
  readonly credentialInstanceId: string;
  readonly credentialIdentityLifetime: 'process-local';
}

export interface EnvironmentCredentialResolver {
  resolve(
    source: SecretCredentialSource,
  ): EnvironmentCredentialResolution | undefined;
  dispose(): void;
}

export function createEnvironmentCredentialResolver(options: {
  readonly environment: EnvironmentSource;
}): EnvironmentCredentialResolver {
  const identityKey = randomBytes(32);
  let disposed = false;
  const resolver: EnvironmentCredentialResolver = {
    resolve: (source) => {
      if (disposed)
        throw new Error('environment credential resolver is disposed');
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(source.environmentVariable))
        throw new TypeError('invalid environment variable name');
      if (source.scheme.length === 0 || source.scheme.length > 64)
        throw new TypeError('invalid credential scheme');
      const value = options.environment.get(source.environmentVariable);
      if (!value) return undefined;
      const credentialInstanceId = createHmac('sha256', identityKey)
        .update(
          JSON.stringify([
            '@duoduo/ai/environment-credential',
            1,
            source.environmentVariable,
            source.scheme,
          ]),
        )
        .update('\0')
        .update(value)
        .digest('base64url');
      return Object.freeze({
        requestCredential: Object.freeze({
          type: 'api_key' as const,
          secret: secret(value),
          scheme: source.scheme,
        }),
        credentialInstanceId,
        credentialIdentityLifetime: 'process-local' as const,
      });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      identityKey.fill(0);
    },
  };
  return Object.freeze(resolver);
}
