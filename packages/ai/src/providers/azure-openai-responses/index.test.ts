import { describe, expect, it } from 'vitest';

import { AiRuntimeError, createAi, secret } from '../../index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';
import {
  createAzureOpenAiResponsesProvider,
  resolveAzureOpenAiConfiguration,
} from './index.js';

function environment(values: Readonly<Record<string, string>>) {
  return { get: (name: string) => values[name] };
}

function completedSse(): Uint8Array {
  return new TextEncoder().encode(
    `event: response.completed\ndata: ${JSON.stringify({
      type: 'response.completed',
      response: {
        id: 'resp_azure',
        model: 'deployment-a',
        status: 'completed',
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    })}\n\n`,
  );
}

describe('Azure OpenAI Responses provider', () => {
  it('resolves every configuration source in documented priority order', () => {
    expect(
      resolveAzureOpenAiConfiguration({
        modelId: 'model-a',
        options: {
          baseUrl: 'https://explicit.example/openai/v1',
          resourceName: 'ignored-resource',
          apiVersion: 'explicit-version',
          deploymentName: 'explicit-deployment',
          deploymentMap: 'model-a=ignored-map',
        },
        environment: environment({
          AZURE_OPENAI_BASE_URL: 'https://environment.example/openai/v1',
          AZURE_OPENAI_RESOURCE_NAME: 'environment-resource',
          AZURE_OPENAI_API_VERSION: 'environment-version',
          AZURE_OPENAI_DEPLOYMENT_NAME: 'environment-deployment',
          AZURE_OPENAI_DEPLOYMENT_NAME_MAP: 'model-a=environment-map',
        }),
      }),
    ).toEqual({
      baseUrl: 'https://explicit.example/openai/v1',
      apiVersion: 'explicit-version',
      deploymentName: 'explicit-deployment',
    });

    expect(
      resolveAzureOpenAiConfiguration({
        modelId: 'model-a',
        options: {},
        environment: environment({
          AZURE_OPENAI_BASE_URL: 'https://environment.example/openai/v1',
          AZURE_OPENAI_API_VERSION: 'environment-version',
          AZURE_OPENAI_DEPLOYMENT_NAME: 'environment-deployment',
        }),
      }),
    ).toEqual({
      baseUrl: 'https://environment.example/openai/v1',
      apiVersion: 'environment-version',
      deploymentName: 'environment-deployment',
    });
  });

  it('derives a resource URL and applies deployment map and fallback leaves', () => {
    expect(
      resolveAzureOpenAiConfiguration({
        modelId: 'model-a',
        options: {
          resourceName: 'explicit-resource',
          deploymentMap: ' model-a = first , ,model-a=last ',
        },
      }),
    ).toEqual({
      baseUrl: 'https://explicit-resource.openai.azure.com/openai/v1',
      apiVersion: 'v1',
      deploymentName: 'last',
    });

    expect(
      resolveAzureOpenAiConfiguration({
        modelId: 'model-b',
        options: {},
        environment: environment({
          AZURE_OPENAI_RESOURCE_NAME: 'environment-resource',
          AZURE_OPENAI_DEPLOYMENT_NAME_MAP: 'other=deployment',
        }),
      }),
    ).toEqual({
      baseUrl: 'https://environment-resource.openai.azure.com/openai/v1',
      apiVersion: 'v1',
      deploymentName: 'model-b',
    });
  });

  it('rejects malformed deployment maps without disclosing their raw value', () => {
    const raw = 'model-a=deployment=secret-canary';
    let thrown: unknown;
    try {
      resolveAzureOpenAiConfiguration({
        modelId: 'model-a',
        options: { resourceName: 'resource', deploymentMap: raw },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiRuntimeError);
    expect(thrown).toMatchObject({
      code: 'AZURE_OPENAI_DEPLOYMENT_MAP_INVALID',
      category: 'invalid_request',
    });
    expect(String((thrown as Error).message)).not.toContain(raw);
    expect(JSON.stringify(thrown)).not.toContain('secret-canary');
  });

  it.each([
    {
      options: {},
      code: 'AZURE_OPENAI_ENDPOINT_UNCONFIGURED',
    },
    {
      options: { resourceName: '-invalid-resource-' },
      code: 'AZURE_OPENAI_RESOURCE_NAME_INVALID',
    },
    {
      options: { baseUrl: 'http://resource.openai.azure.com/openai/v1' },
      code: 'AZURE_OPENAI_BASE_URL_INVALID',
    },
  ])(
    'rejects unsafe endpoint configuration with $code',
    ({ options, code }) => {
      expect(() =>
        resolveAzureOpenAiConfiguration({ modelId: 'model-a', options }),
      ).toThrowError(expect.objectContaining({ code }));
    },
  );

  it('binds api-key auth, deployment model, API version, and shared Responses parser', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://resource.openai.azure.com/openai/v1/responses?api-version=2026-01-01',
        headers: {
          'api-key': 'fixture-key',
          'content-type': 'application/json',
        },
        jsonBody: {
          model: 'deployment-a',
          input: [],
          max_output_tokens: 8_192,
          stream: true,
        },
      },
      status: 200,
      bodyChunks: [completedSse()],
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://resource.openai.azure.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    const provider = createAzureOpenAiResponsesProvider({
      resourceName: 'resource',
      apiVersion: '2026-01-01',
      deploymentMap: 'model-a=deployment-a',
      models: [{ id: 'model-a' }],
    });
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('fixture-key'),
      scheme: '',
    };
    const model = await ai.models.require(
      {
        providerInstanceId: provider.id,
        modelId: 'model-a',
        protocol: 'azure-openai-responses',
      },
      {},
      { credentialOverride },
    );

    const response = await ai.complete(
      model,
      { messages: [] },
      { credentialOverride },
    );

    expect(response).toMatchObject({
      status: 'completed',
      responseId: 'resp_azure',
      responseModel: { modelId: 'deployment-a' },
      replay: { protocolId: 'azure-openai-responses' },
    });
  });
});
