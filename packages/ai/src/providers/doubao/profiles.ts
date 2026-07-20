import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import { runArkResponses } from '../../protocols/ark-responses/index.js';
import {
  createOpenAiChatCompletionsAdapter,
  type OpenAiChatCompatibility,
} from '../../protocols/openai-chat-completions/adapter.js';
import { runOpenAiResponses } from '../../protocols/openai-responses/adapter.js';
import type { ProtocolEventSink } from '../../runtime/registry.js';

export type DoubaoTextProtocol =
  'openai-responses' | 'openai-chat-completions' | 'ark-responses';

export interface DoubaoProtocolProfile {
  readonly id: string;
  readonly protocol: DoubaoTextProtocol;
  readonly openAiChatCompatibility?: OpenAiChatCompatibility;
}

export const doubaoProtocolProfiles = Object.freeze([
  Object.freeze({
    id: 'doubao-openai-responses-default',
    protocol: 'openai-responses',
  }),
  Object.freeze({
    id: 'doubao-openai-chat-default',
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
    id: 'doubao-ark-responses-v3',
    protocol: 'ark-responses',
  }),
] as const satisfies readonly DoubaoProtocolProfile[]);

const profileById: ReadonlyMap<string, DoubaoProtocolProfile> = new Map(
  doubaoProtocolProfiles.map((profile) => [profile.id, profile]),
);

export function requireDoubaoProfile(id: string): DoubaoProtocolProfile {
  const profile = profileById.get(id);
  if (!profile) throw new Error(`unknown Doubao protocol profile: ${id}`);
  return profile;
}

export function compatibilityProfile(
  mode: 'responses' | 'chat-completions',
): DoubaoProtocolProfile {
  return requireDoubaoProfile(
    mode === 'responses'
      ? 'doubao-openai-responses-default'
      : 'doubao-openai-chat-default',
  );
}

export function createDoubaoProtocolRunners(): ReadonlyMap<
  DoubaoTextProtocol,
  (request: ChatRequest, sink: ProtocolEventSink) => Promise<ProtocolTerminal>
> {
  const chat = requireDoubaoProfile('doubao-openai-chat-default');
  return new Map([
    [
      'openai-responses',
      runOpenAiResponses as unknown as (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ) => Promise<ProtocolTerminal>,
    ],
    [
      'openai-chat-completions',
      createOpenAiChatCompletionsAdapter({
        compatibility: chat.openAiChatCompatibility,
      }) as unknown as (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ) => Promise<ProtocolTerminal>,
    ],
    [
      'ark-responses',
      runArkResponses as unknown as (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ) => Promise<ProtocolTerminal>,
    ],
  ]);
}
