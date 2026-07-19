import { createHash, randomBytes } from 'node:crypto';

import type {
  AmbientAuth,
  AmbientAuthResolution,
  EnvironmentSource,
} from '../ambient.js';
import type { SecretValue } from '../secret-value.js';
import type { RequestAuthorizationInput } from '../../transport/request-transport.js';

export interface GoogleAdcAccessToken {
  readonly token: SecretValue;
  readonly expiresAt?: number;
}

export interface GoogleAdcCredentialProvider {
  getAccessToken(input: {
    readonly signal: AbortSignal;
  }): Promise<GoogleAdcAccessToken>;
  getPrincipal?(input: {
    readonly signal: AbortSignal;
  }): Promise<string | undefined>;
}

export interface GoogleAdcConfiguration {
  readonly project: string;
  readonly location: string;
}

export interface CreateGoogleAdcAmbientAuthOptions extends GoogleAdcConfiguration {
  readonly credentials: GoogleAdcCredentialProvider;
}

export function resolveGoogleAdcConfiguration(options: {
  readonly project?: string;
  readonly location?: string;
  readonly environment?: EnvironmentSource;
}): GoogleAdcConfiguration {
  const project =
    nonEmpty(options.project) ??
    nonEmpty(options.environment?.get('GOOGLE_CLOUD_PROJECT')) ??
    nonEmpty(options.environment?.get('GCLOUD_PROJECT'));
  const location =
    nonEmpty(options.location) ??
    nonEmpty(options.environment?.get('GOOGLE_CLOUD_LOCATION'));
  if (!project)
    throw new TypeError('Google ADC project is required for Vertex AI');
  if (!location)
    throw new TypeError('Google ADC location is required for Vertex AI');
  return Object.freeze({ project, location });
}

export function createGoogleAdcAmbientAuth(
  options: CreateGoogleAdcAmbientAuthOptions,
): AmbientAuth {
  const project = requireSegment(options.project, 'project');
  const location = requireSegment(options.location, 'location');
  const processIdentity = randomBytes(32).toString('base64url');
  const auth: AmbientAuth = {
    resolve: async ({ provider, signal }): Promise<AmbientAuthResolution> => {
      const principal = nonEmpty(
        await options.credentials.getPrincipal?.({ signal }),
      );
      const stableFacts = principal
        ? ['google-adc', 1, provider.id, project, location, principal]
        : undefined;
      const credentialInstanceId = stableFacts
        ? digest(stableFacts)
        : digest([
            'google-adc-process',
            1,
            provider.id,
            project,
            location,
            processIdentity,
          ]);
      return Object.freeze({
        credentialInstanceId,
        credentialIdentityLifetime: principal
          ? ('cross-runtime' as const)
          : ('process-local' as const),
        authorize: async ({
          signal: requestSignal,
        }: RequestAuthorizationInput) => {
          const accessToken = await options.credentials.getAccessToken({
            signal: requestSignal,
          });
          return Object.freeze({
            authorization: Object.freeze({
              secret: accessToken.token,
              prefix: 'Bearer ',
            }),
          });
        },
      });
    },
  };
  return Object.freeze(auth);
}

function digest(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('base64url');
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function requireSegment(value: string, name: string): string {
  const normalized = nonEmpty(value);
  if (!normalized || normalized.includes('/'))
    throw new TypeError(`invalid Google ADC ${name}`);
  return normalized;
}
