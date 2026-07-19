import { describe, expect, it, vi } from 'vitest';

import { secret } from '../secret-value.js';
import {
  createGoogleAdcAmbientAuth,
  resolveGoogleAdcConfiguration,
} from './google-adc.js';

const provider = {
  id: 'vertex',
  kind: 'google-vertex',
  name: 'Google Vertex AI',
  registrationGeneration: 'generation-1',
  configFingerprint: '{}',
  authPolicyFingerprint: 'adc',
};

describe('Google ADC ambient capability', () => {
  it('resolves explicit project/location before injected environment values', () => {
    const environment = {
      get: vi.fn(
        (name: string) =>
          ({
            GOOGLE_CLOUD_PROJECT: 'environment-project',
            GCLOUD_PROJECT: 'fallback-project',
            GOOGLE_CLOUD_LOCATION: 'environment-location',
          })[name],
      ),
    };

    expect(
      resolveGoogleAdcConfiguration({
        project: 'explicit-project',
        location: 'explicit-location',
        environment,
      }),
    ).toEqual({ project: 'explicit-project', location: 'explicit-location' });
    expect(environment.get).not.toHaveBeenCalled();
  });

  it('authorizes with a redacted bearer token and stable non-secret identity', async () => {
    const token = secret('google-access-token');
    const auth = createGoogleAdcAmbientAuth({
      project: 'project-a',
      location: 'us-central1',
      credentials: {
        getAccessToken: async () => ({ token }),
        getPrincipal: async () => 'service-account@example.test',
      },
    });

    const resolution = await auth.resolve({
      provider,
      signal: new AbortController().signal,
    });

    expect(resolution).toMatchObject({
      credentialIdentityLifetime: 'cross-runtime',
    });
    expect(resolution?.credentialInstanceId).not.toContain(
      'google-access-token',
    );
    const headers = await resolution?.authorize({
      url: new URL(
        'https://us-central1-aiplatform.googleapis.com/v1/projects/project-a',
      ),
      method: 'POST',
      headers: {},
      body: '{}',
      signal: new AbortController().signal,
    });
    expect(JSON.stringify(headers)).not.toContain('google-access-token');
    expect(headers?.authorization).toEqual({
      secret: token,
      prefix: 'Bearer ',
    });
  });

  it('uses process-local identity when no stable principal is available', async () => {
    const auth = createGoogleAdcAmbientAuth({
      project: 'project-a',
      location: 'us-central1',
      credentials: {
        getAccessToken: async () => ({ token: secret('token') }),
      },
    });

    await expect(
      auth.resolve({ provider, signal: new AbortController().signal }),
    ).resolves.toMatchObject({ credentialIdentityLifetime: 'process-local' });
  });
});
