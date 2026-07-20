import { describe, expect, it } from 'vitest';
import { secret } from '../auth/secret-value.js';
import { createAi } from '../runtime/create-ai.js';
import { createAllowlistNetworkPolicy } from '../transport/network-policy.js';
import { createFixtureTransportDriver } from '../testing.js';
import {
  compatibleProviderDescriptors,
  createCompatibleProvider,
  type CompatibleProviderDescriptor,
} from './_shared/openai-compatible.js';

const encoder = new TextEncoder();

const expected = [
  [
    'ant-ling',
    'ANT_LING_API_KEY',
    'https://api.ant-ling.com/v1/chat/completions',
  ],
  [
    'cerebras',
    'CEREBRAS_API_KEY',
    'https://api.cerebras.ai/v1/chat/completions',
  ],
  [
    'cloudflare-workers-ai',
    'CLOUDFLARE_API_KEY',
    'https://api.cloudflare.com/client/v4/accounts/fixture-account/ai/v1/chat/completions',
  ],
  ['deepseek', 'DEEPSEEK_API_KEY', 'https://api.deepseek.com/chat/completions'],
  ['groq', 'GROQ_API_KEY', 'https://api.groq.com/openai/v1/chat/completions'],
  [
    'huggingface',
    'HF_TOKEN',
    'https://router.huggingface.co/v1/chat/completions',
  ],
  [
    'moonshotai',
    'MOONSHOT_API_KEY',
    'https://api.moonshot.ai/v1/chat/completions',
  ],
  [
    'moonshotai-cn',
    'MOONSHOT_API_KEY',
    'https://api.moonshot.cn/v1/chat/completions',
  ],
  [
    'nvidia',
    'NVIDIA_API_KEY',
    'https://integrate.api.nvidia.com/v1/chat/completions',
  ],
  [
    'together',
    'TOGETHER_API_KEY',
    'https://api.together.ai/v1/chat/completions',
  ],
  ['xai', 'XAI_API_KEY', 'https://api.x.ai/v1/chat/completions'],
  [
    'xiaomi',
    'XIAOMI_API_KEY',
    'https://api.xiaomimimo.com/v1/chat/completions',
  ],
  [
    'xiaomi-token-plan-ams',
    'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
    'https://token-plan-ams.xiaomimimo.com/v1/chat/completions',
  ],
  [
    'xiaomi-token-plan-cn',
    'XIAOMI_TOKEN_PLAN_CN_API_KEY',
    'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
  ],
  [
    'xiaomi-token-plan-sgp',
    'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
    'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
  ],
  [
    'zai',
    'ZAI_API_KEY',
    'https://api.z.ai/api/coding/paas/v4/chat/completions',
  ],
  [
    'zai-coding-cn',
    'ZAI_CODING_CN_API_KEY',
    'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
  ],
] as const;

describe('OpenAI Chat compatible provider wave', () => {
  it('freezes all 17 provider auth, endpoint, profile, and manifest rows', () => {
    expect(
      compatibleProviderDescriptors.map((descriptor) => [
        descriptor.kind,
        descriptor.environmentVariable,
        descriptor.endpoint({ accountId: 'fixture-account' }),
      ]),
    ).toEqual(expected);
    for (const descriptor of compatibleProviderDescriptors) {
      expect(descriptor.manifest).toMatchObject({
        schemaVersion: 1,
        providerKind: descriptor.kind,
        bindings: [
          {
            capability: 'chat',
            protocol: 'openai-chat-completions',
            authSchemes: ['api_key'],
            endpointBranchIds: expect.arrayContaining(['default']),
            requestFixtureIds: expect.any(Array),
            streamFixtureIds: expect.any(Array),
            errorFixtureIds: expect.any(Array),
            sources: expect.arrayContaining([
              expect.objectContaining({ kind: 'official' }),
            ]),
          },
        ],
      });
    }
  });

  it.each(compatibleProviderDescriptors)(
    '$kind binds auth, endpoint, request, stream, and error semantics',
    async (descriptor: CompatibleProviderDescriptor) => {
      const endpoint = descriptor.endpoint({ accountId: 'fixture-account' });
      const transport = createFixtureTransportDriver();
      transport.enqueue({
        status: 200,
        bodyChunks: [
          encoder.encode(
            'data: {"id":"chatcmpl_ok","model":"result-model","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\ndata: [DONE]\n\n',
          ),
        ],
      });
      const ai = createAi({
        transport,
        networkPolicy: createAllowlistNetworkPolicy({
          origins: [new URL(endpoint).origin],
        }),
        credentialOverridePolicy: { allow: () => true },
      });
      const provider = createCompatibleProvider(descriptor, {
        ...(descriptor.kind === 'cloudflare-workers-ai'
          ? { accountId: 'fixture-account' }
          : {}),
      });
      ai.providers.register(provider);
      const credentialOverride = {
        type: 'api_key' as const,
        secret: secret('fixture-key'),
      };
      const model = await ai.models.require(
        {
          providerInstanceId: provider.id,
          modelId: descriptor.defaultModelId,
          protocol: 'openai-chat-completions',
        },
        {},
        { credentialOverride },
      );
      const response = await ai.complete(
        model,
        {
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          ],
        },
        {
          credentialOverride,
          protocolOptions: { thinkingEnabled: false },
        },
      );
      expect(response).toMatchObject({
        status: 'completed',
        responseId: 'chatcmpl_ok',
        responseModel: { modelId: 'result-model' },
        content: [{ type: 'text', text: 'ok' }],
      });
      expect(transport.requests()).toEqual([
        expect.objectContaining({
          origin: new URL(endpoint).origin,
          pathname: new URL(endpoint).pathname,
          headerNames: expect.arrayContaining([
            'authorization',
            'content-type',
          ]),
        }),
      ]);
      expect(provider).toMatchObject({
        kind: descriptor.kind,
        contractManifest: descriptor.manifest,
        auth: {
          policyFingerprint: expect.stringContaining(
            descriptor.environmentVariable,
          ),
        },
      });
    },
  );
});
