import { createHash, randomBytes } from 'node:crypto';

import type {
  AmbientAuth,
  AmbientAuthResolution,
  EnvironmentSource,
} from '../ambient.js';
import type {
  RequestAuthorizationHeaders,
  RequestAuthorizationInput,
} from '../../transport/request-transport.js';

export interface AwsRequestSignerInput extends RequestAuthorizationInput {
  readonly service: 'bedrock';
  readonly region: string;
  readonly profile?: string;
}

export interface AwsRequestSigner {
  sign(
    input: AwsRequestSignerInput,
  ): Promise<RequestAuthorizationHeaders> | RequestAuthorizationHeaders;
}

export interface CreateAwsAmbientAuthOptions {
  readonly region: string;
  readonly profile?: string;
  readonly principal?: string;
  readonly signer: AwsRequestSigner;
}

export function createAwsAmbientAuth(
  options: CreateAwsAmbientAuthOptions,
): AmbientAuth {
  const region = requireValue(options.region, 'AWS region');
  const profile = optionalValue(options.profile);
  const principal = optionalValue(options.principal);
  const processIdentity = randomBytes(32).toString('base64url');
  const auth: AmbientAuth = {
    resolve: async ({ provider }): Promise<AmbientAuthResolution> => {
      const stableFacts = principal
        ? ['aws-ambient', 1, provider.id, region, profile ?? null, principal]
        : undefined;
      return Object.freeze({
        credentialInstanceId: digest(
          stableFacts ?? [
            'aws-ambient-process',
            1,
            provider.id,
            region,
            profile ?? null,
            processIdentity,
          ],
        ),
        credentialIdentityLifetime: principal
          ? ('cross-runtime' as const)
          : ('process-local' as const),
        authorize: (request: RequestAuthorizationInput) =>
          options.signer.sign({
            ...request,
            service: 'bedrock',
            region,
            ...(profile ? { profile } : {}),
          }),
      });
    },
  };
  return Object.freeze(auth);
}

export function resolveBedrockRegion(options: {
  readonly modelId: string;
  readonly explicitRegion?: string;
  readonly environment?: EnvironmentSource;
  readonly profileRegion?: string;
}): string {
  const arnRegion = inferenceProfileArnRegion(options.modelId);
  if (arnRegion) return arnRegion;
  return (
    optionalValue(options.explicitRegion) ??
    optionalValue(options.environment?.get('AWS_REGION')) ??
    optionalValue(options.environment?.get('AWS_DEFAULT_REGION')) ??
    optionalValue(options.profileRegion) ??
    (options.modelId.startsWith('eu.') ? 'eu-central-1' : 'us-east-1')
  );
}

function inferenceProfileArnRegion(modelId: string): string | undefined {
  const match =
    /^arn:[^:]+:bedrock:([^:]+):[^:]*:(?:application-)?inference-profile\//.exec(
      modelId,
    );
  return optionalValue(match?.[1]);
}

function digest(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('base64url');
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function requireValue(value: string, name: string): string {
  const normalized = optionalValue(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}
