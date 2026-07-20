import { describe, expect, it } from 'vitest';

import {
  createMistralConversationsAdapter,
  mistralConversationsContract,
  mistralConversationsReplayCodecs,
} from '../protocols/mistral-conversations/index.js';
import {
  createOpenAiCodexResponsesAdapter,
  openAiCodexResponsesContract,
  openAiCodexResponsesReplayCodecs,
} from '../protocols/openai-codex-responses/index.js';
import {
  createPiMessagesAdapter,
  piMessagesContract,
  piMessagesReplayCodecs,
} from '../protocols/pi-messages/index.js';
import { createMistralProvider, mistralModelRef } from './mistral/index.js';
import {
  createOpenAiCodexProvider,
  openAiCodexModelRef,
} from './openai-codex/index.js';
import { createRadiusProvider, radiusModelRef } from './radius/index.js';
import parity from './_generated/pi-parity.generated.json';

describe('PI text baseline parity', () => {
  it('exports stable protocol contracts and replay codecs', () => {
    expect(openAiCodexResponsesContract).toMatchObject({
      protocol: 'openai-codex-responses',
      route: 'codex/responses',
      streaming: true,
    });
    expect(mistralConversationsContract).toMatchObject({
      protocol: 'mistral-conversations',
      route: 'chat.stream',
      streaming: true,
    });
    expect(piMessagesContract).toMatchObject({
      protocol: 'pi-messages',
      route: 'messages',
      streaming: true,
    });
    expect(openAiCodexResponsesReplayCodecs).toEqual(
      expect.arrayContaining([expect.objectContaining({ version: 1 })]),
    );
    expect(mistralConversationsReplayCodecs).toEqual(
      expect.arrayContaining([expect.objectContaining({ version: 1 })]),
    );
    expect(piMessagesReplayCodecs).toEqual(
      expect.arrayContaining([expect.objectContaining({ version: 1 })]),
    );
    expect(typeof createOpenAiCodexResponsesAdapter).toBe('function');
    expect(typeof createMistralConversationsAdapter).toBe('function');
    expect(typeof createPiMessagesAdapter).toBe('function');
  });

  it('binds Codex, Mistral, and Radius to their exact protocols', () => {
    const codex = createOpenAiCodexProvider();
    const mistral = createMistralProvider();
    const radius = createRadiusProvider({
      models: [{ id: 'radius-fixture', name: 'Radius Fixture' }],
    });

    expect(codex).toMatchObject({
      kind: 'openai-codex',
      identity: { endpoint: 'https://chatgpt.com/backend-api/codex/responses' },
      chat: { models: [{ protocol: 'openai-codex-responses' }] },
    });
    expect(mistral).toMatchObject({
      kind: 'mistral',
      identity: { endpoint: 'https://api.mistral.ai/v1/chat/completions' },
      chat: { models: [{ protocol: 'mistral-conversations' }] },
    });
    expect(radius).toMatchObject({
      kind: 'radius',
      identity: { gateway: 'https://radius.pi.dev' },
      chat: { models: [{ protocol: 'pi-messages' }] },
    });

    expect(openAiCodexModelRef()).toMatchObject({
      providerInstanceId: 'openai-codex',
      protocol: 'openai-codex-responses',
    });
    expect(mistralModelRef()).toMatchObject({
      providerInstanceId: 'mistral',
      protocol: 'mistral-conversations',
    });
    expect(radiusModelRef('radius-fixture')).toEqual({
      providerInstanceId: 'radius',
      modelId: 'radius-fixture',
      protocol: 'pi-messages',
    });
  });

  it('freezes the deterministic 36-provider and ten-protocol PI ledger', () => {
    expect(parity.schemaVersion).toBe(1);
    expect(parity.providers).toHaveLength(36);
    expect(new Set(parity.providers).size).toBe(36);
    expect(parity.textProtocols).toEqual([
      'anthropic-messages',
      'azure-openai-responses',
      'bedrock-converse-stream',
      'google-generative-ai',
      'google-vertex',
      'mistral-conversations',
      'openai-chat-completions',
      'openai-codex-responses',
      'openai-responses',
      'pi-messages',
    ]);
    expect(parity.digest).toMatch(/^[a-f0-9]{64}$/u);
  });
});
