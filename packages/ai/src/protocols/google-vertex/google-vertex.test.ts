import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { secret } from '../../auth/secret-value.js';
import { createGoogleAdcAmbientAuth } from '../../auth/ambient/google-adc.js';
import { createAi } from '../../index.js';
import { createGoogleVertexProvider } from '../../providers/google-vertex/index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';

const encoder = new TextEncoder();
async function fixture(): Promise<Uint8Array[]> {
  const bytes = await readFile(
    new URL('../../../test/fixtures/google-vertex/text.sse', import.meta.url),
  );
  return [bytes, encoder.encode('\n')];
}

describe('Google Vertex protocol and provider', () => {
  it('supports the API-key branch without project or location', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
        headers: { 'x-goog-api-key': 'vertex-key' },
      },
      status: 200,
      bodyChunks: await fixture(),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://aiplatform.googleapis.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(createGoogleVertexProvider({ authMode: 'api-key' }));
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('vertex-key'),
      scheme: '',
    };
    const model = await ai.models.require(
      { providerInstanceId: 'google-vertex', modelId: 'gemini-2.5-flash' },
      {},
      { credentialOverride },
    );

    await expect(
      ai.complete(
        model,
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'completed',
      content: [{ type: 'text', text: 'vertex ok' }],
    });
  });

  it('uses ADC with project/location and a regional final URL', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://europe-west4-aiplatform.googleapis.com/v1/projects/project-a/locations/europe-west4/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
        headers: { authorization: 'Bearer adc-token' },
      },
      status: 200,
      bodyChunks: await fixture(),
    });
    const ambientAuth = createGoogleAdcAmbientAuth({
      project: 'project-a',
      location: 'europe-west4',
      credentials: {
        getPrincipal: async () => 'vertex@example.test',
        getAccessToken: async () => ({ token: secret('adc-token') }),
      },
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://europe-west4-aiplatform.googleapis.com'],
      }),
      ambientAuthPolicy: { allow: () => true },
    });
    ai.providers.register(
      createGoogleVertexProvider({
        authMode: 'adc',
        project: 'project-a',
        location: 'europe-west4',
        ambientAuth,
      }),
    );
    const snapshot = ai.providers.list()[0];
    expect(snapshot?.configFingerprint).toContain('"vertexai":"true"');
    expect(snapshot?.configFingerprint).toContain('"apiVersion":"v1"');
    expect(snapshot?.configFingerprint).toContain('"project":"project-a"');
    expect(snapshot?.configFingerprint).toContain('"location":"europe-west4"');
    const model = await ai.models.require(
      { providerInstanceId: 'google-vertex', modelId: 'gemini-2.5-flash' },
      {},
    );

    await expect(ai.complete(model, { messages: [] })).resolves.toMatchObject({
      status: 'completed',
      responseId: 'resp-vertex',
    });
  });

  it('keeps API-key and ADC provider identities distinct', () => {
    const apiKeyAi = createAi();
    apiKeyAi.providers.register(
      createGoogleVertexProvider({ authMode: 'api-key' }),
    );
    const adcAi = createAi();
    adcAi.providers.register(
      createGoogleVertexProvider({
        authMode: 'adc',
        project: 'project-a',
        location: 'us-central1',
        ambientAuth: createGoogleAdcAmbientAuth({
          project: 'project-a',
          location: 'us-central1',
          credentials: {
            getAccessToken: async () => ({ token: secret('token') }),
          },
        }),
      }),
    );

    expect(apiKeyAi.providers.list()[0]?.configFingerprint).not.toBe(
      adcAi.providers.list()[0]?.configFingerprint,
    );
  });
});
