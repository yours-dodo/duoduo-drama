import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { createAi } from '../../index.js';
import { secret } from '../../auth/secret-value.js';
import { createGoogleProvider } from '../../providers/google/index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';

const encoder = new TextEncoder();

async function fixture(name: string): Promise<Uint8Array[]> {
  const bytes = await readFile(
    new URL(
      `../../../test/fixtures/google-generative-ai/${name}`,
      import.meta.url,
    ),
  );
  return [bytes, encoder.encode('\n')];
}

describe('Google Generative AI protocol', () => {
  it('maps multimodal tools and thinking while preserving thought signatures', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': 'google-key',
        },
        jsonBody: {
          systemInstruction: { parts: [{ text: 'Be concise.' }] },
          contents: [
            {
              role: 'user',
              parts: [
                { text: 'What is here?' },
                {
                  inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' },
                },
              ],
            },
          ],
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'weather',
                  description: 'Get weather',
                  parameters: {
                    type: 'object',
                    properties: { city: { type: 'string' } },
                    required: ['city'],
                  },
                },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 256,
            thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 },
          },
        },
      },
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyChunks: await fixture('thinking-tool.sse'),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://generativelanguage.googleapis.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(createGoogleProvider());
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('google-key'),
      scheme: '',
    };
    const model = await ai.models.require(
      {
        providerInstanceId: 'google',
        modelId: 'gemini-2.5-pro',
        protocol: 'google-generative-ai',
      },
      {},
      { credentialOverride },
    );

    const response = await ai.complete(
      model,
      {
        systemPrompt: 'Be concise.',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is here?' },
              {
                type: 'image',
                mediaType: 'image/png',
                source: { type: 'base64', data: 'aW1hZ2U=' },
              },
            ],
          },
        ],
        tools: [
          {
            name: 'weather',
            description: 'Get weather',
            inputSchema: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        ],
      },
      {
        credentialOverride,
        maxOutputTokens: 256,
        protocolOptions: { thinkingBudget: 1024 },
      },
    );

    expect(response).toMatchObject({
      status: 'completed',
      finishReason: 'tool_calls',
      responseId: 'resp-google',
      responseModel: {
        providerInstanceId: 'google',
        modelId: 'gemini-2.5-pro-001',
        protocol: 'google-generative-ai',
      },
      content: [
        {
          type: 'reasoning',
          text: 'plan',
          replay: {
            protocolId: 'google-generative-ai',
            codecId: 'google-thought-signature',
            data: { thoughtSignature: 'c2ln' },
          },
        },
        { type: 'text', text: 'Answer done' },
        {
          type: 'tool_call',
          name: 'weather',
          arguments: { city: 'Paris' },
          replay: {
            protocolId: 'google-generative-ai',
            codecId: 'google-thought-signature',
            data: { thoughtSignature: 'dG9vbA==' },
          },
        },
      ],
      usage: {
        inputTokens: 10,
        outputTokens: 8,
        reasoningTokens: 3,
        cacheReadTokens: 2,
        totalTokens: 20,
      },
    });
  });

  it('normalizes HTTP failures and incomplete streams', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({ status: 429, bodyChunks: [] });
    transport.enqueue({
      status: 200,
      bodyChunks: [encoder.encode('data: {"candidates":[]}\n\n')],
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://generativelanguage.googleapis.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(createGoogleProvider());
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('key'),
      scheme: '',
    };
    const model = await ai.models.require(
      { providerInstanceId: 'google', modelId: 'gemini-2.5-pro' },
      {},
      { credentialOverride },
    );

    await expect(
      ai.complete(model, { messages: [] }, { credentialOverride }),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'GOOGLE_RATE_LIMITED', category: 'rate_limit' },
    });
    await expect(
      ai.complete(model, { messages: [] }, { credentialOverride }),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'GOOGLE_STREAM_INCOMPLETE' },
    });
  });
});
