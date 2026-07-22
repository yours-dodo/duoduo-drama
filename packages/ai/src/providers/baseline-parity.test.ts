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
import { createMistralProvider, mistralModelRef } from './mistral/index.js';
import {
  createOpenAiCodexProvider,
  openAiCodexModelRef,
} from './openai-codex/index.js';
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
    expect(openAiCodexResponsesReplayCodecs).toEqual(
      expect.arrayContaining([expect.objectContaining({ version: 1 })]),
    );
    expect(mistralConversationsReplayCodecs).toEqual(
      expect.arrayContaining([expect.objectContaining({ version: 1 })]),
    );
    expect(typeof createOpenAiCodexResponsesAdapter).toBe('function');
    expect(typeof createMistralConversationsAdapter).toBe('function');
  });

  it('binds Codex and Mistral to their exact protocols', () => {
    const codex = createOpenAiCodexProvider();
    const mistral = createMistralProvider();

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
    expect(openAiCodexModelRef()).toMatchObject({
      providerInstanceId: 'openai-codex',
      protocol: 'openai-codex-responses',
    });
    expect(mistralModelRef()).toMatchObject({
      providerInstanceId: 'mistral',
      protocol: 'mistral-conversations',
    });
  });

  it('freezes the deterministic 35-provider and nine-protocol PI ledger', () => {
    expect(parity.schemaVersion).toBe(1);
    expect(parity.providers).toHaveLength(35);
    expect(new Set(parity.providers).size).toBe(35);
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
    ]);
    expect(parity.digest).toMatch(/^[a-f0-9]{64}$/u);
  });
});
