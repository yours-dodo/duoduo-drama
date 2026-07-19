import { describe, expect, it, vi } from 'vitest';

import { secret } from '../secret-value.js';
import {
  createAwsAmbientAuth,
  resolveBedrockRegion,
  type AwsRequestSigner,
} from './aws.js';

const provider = {
  id: 'bedrock',
  kind: 'amazon-bedrock',
  name: 'Amazon Bedrock',
  registrationGeneration: 'generation-1',
  configFingerprint: '{}',
  authPolicyFingerprint: 'aws',
};

describe('AWS ambient capability', () => {
  it('resolves Bedrock region in the documented priority order', () => {
    const environment = {
      get: (name: string) =>
        ({ AWS_REGION: 'env-region', AWS_DEFAULT_REGION: 'default-region' })[
          name
        ],
    };
    expect(
      resolveBedrockRegion({
        modelId:
          'arn:aws:bedrock:eu-west-1:123456789012:inference-profile/example',
        explicitRegion: 'explicit-region',
        environment,
        profileRegion: 'profile-region',
      }),
    ).toBe('eu-west-1');
    expect(
      resolveBedrockRegion({
        modelId: 'anthropic.claude-sonnet',
        explicitRegion: 'explicit-region',
        environment,
        profileRegion: 'profile-region',
      }),
    ).toBe('explicit-region');
    expect(
      resolveBedrockRegion({
        modelId: 'eu.anthropic.claude-sonnet',
        environment: { get: () => undefined },
      }),
    ).toBe('eu-central-1');
    expect(
      resolveBedrockRegion({
        modelId: 'anthropic.claude-sonnet',
        environment: { get: () => undefined },
      }),
    ).toBe('us-east-1');
  });

  it('signs the final request without exposing AWS secret material', async () => {
    const signer: AwsRequestSigner = {
      sign: vi.fn(async ({ url, region }) => ({
        authorization: secret(`signed:${region}:${url.pathname}`),
        'x-amz-date': '20260719T000000Z',
      })),
    };
    const auth = createAwsAmbientAuth({
      region: 'us-west-2',
      profile: 'production',
      principal: 'arn:aws:iam::123456789012:role/runtime',
      signer,
    });

    const resolution = await auth.resolve({
      provider,
      signal: new AbortController().signal,
    });
    expect(resolution).toMatchObject({
      credentialIdentityLifetime: 'cross-runtime',
    });
    const headers = await resolution?.authorize({
      url: new URL('https://bedrock-runtime.us-west-2.amazonaws.com/model/x'),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: new AbortController().signal,
    });
    expect(signer.sign).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-west-2', service: 'bedrock' }),
    );
    expect(JSON.stringify(headers)).not.toContain('signed:us-west-2');
  });
});
