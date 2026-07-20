import {
  createAnthropicMessagesAdapter,
  type AnthropicMessagesCompatibility,
} from '../../protocols/anthropic-messages/adapter.js';
import { runDashScope } from '../../protocols/dashscope/index.js';
import {
  createOpenAiChatCompletionsAdapter,
  type OpenAiChatCompatibility,
} from '../../protocols/openai-chat-completions/adapter.js';
import { runOpenAiResponses } from '../../protocols/openai-responses/adapter.js';
import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';

export type QwenProtocolPreference =
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'dashscope';

export type QwenNativeRouteId = 'text-generation' | 'multimodal-generation';

export interface QwenProtocolProfile {
  readonly id: string;
  readonly protocol: QwenProtocolPreference;
  readonly route?: QwenNativeRouteId;
  readonly openAiChatCompatibility?: OpenAiChatCompatibility;
  readonly anthropicCompatibility?: AnthropicMessagesCompatibility;
}

export const qwenProtocolProfiles = Object.freeze([
  Object.freeze({
    id: 'qwen-openai-chat-default',
    protocol: 'openai-chat-completions',
    openAiChatCompatibility: Object.freeze({
      supportsDeveloperRole: true,
      supportsUsageInStreaming: true,
      supportsReasoningEffort: true,
      thinkingFormat: 'openai',
      maxTokensField: 'max_tokens',
    }),
  }),
  Object.freeze({
    id: 'qwen-openai-responses-default',
    protocol: 'openai-responses',
  }),
  Object.freeze({
    id: 'qwen-anthropic-default',
    protocol: 'anthropic-messages',
    anthropicCompatibility: Object.freeze({
      supportsEagerToolInputStreaming: true,
      supportsTemperature: true,
    }),
  }),
  Object.freeze({
    id: 'qwen-dashscope-text',
    protocol: 'dashscope',
    route: 'text-generation',
  }),
  Object.freeze({
    id: 'qwen-dashscope-multimodal',
    protocol: 'dashscope',
    route: 'multimodal-generation',
  }),
] as const satisfies readonly QwenProtocolProfile[]);

const profileById: ReadonlyMap<string, QwenProtocolProfile> = new Map(
  qwenProtocolProfiles.map((profile) => [profile.id, profile]),
);

export function requireQwenProfile(id: string): QwenProtocolProfile {
  const profile = profileById.get(id);
  if (!profile) throw new Error(`unknown Qwen protocol profile: ${id}`);
  return profile;
}

export function preferenceProfileId(
  preference: QwenProtocolPreference,
): string {
  switch (preference) {
    case 'openai-chat-completions':
      return 'qwen-openai-chat-default';
    case 'openai-responses':
      return 'qwen-openai-responses-default';
    case 'anthropic-messages':
      return 'qwen-anthropic-default';
    case 'dashscope':
      return 'qwen-dashscope-text';
  }
}

export function nativeProfileId(route: QwenNativeRouteId): string {
  return route === 'text-generation'
    ? 'qwen-dashscope-text'
    : 'qwen-dashscope-multimodal';
}

export function createQwenProtocolRunners(): ReadonlyMap<
  QwenProtocolPreference,
  (request: ChatRequest, sink: ProtocolEventSink) => Promise<ProtocolTerminal>
> {
  const chatProfile = requireQwenProfile('qwen-openai-chat-default');
  const anthropicProfile = requireQwenProfile('qwen-anthropic-default');
  return new Map([
    [
      'openai-chat-completions',
      createOpenAiChatCompletionsAdapter({
        compatibility: chatProfile.openAiChatCompatibility,
      }) as unknown as (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ) => Promise<ProtocolTerminal>,
    ],
    [
      'openai-responses',
      runOpenAiResponses as unknown as (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ) => Promise<ProtocolTerminal>,
    ],
    [
      'anthropic-messages',
      createAnthropicMessagesAdapter({
        compatibility: anthropicProfile.anthropicCompatibility,
      }) as unknown as (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ) => Promise<ProtocolTerminal>,
    ],
    [
      'dashscope',
      runDashScope as unknown as (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ) => Promise<ProtocolTerminal>,
    ],
  ]);
}
