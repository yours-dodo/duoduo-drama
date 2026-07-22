import { createOpenAiCodexOAuthFlow } from '@duoduo/ai/auth/oauth/openai-codex';
import { createXAiOAuthFlow } from '@duoduo/ai/auth/oauth/xai';
import {
  createMistralConversationsAdapter,
  normalizeMistralToolCallId,
  runMistralConversations,
} from '@duoduo/ai/protocols/mistral-conversations';
import {
  createOpenAiCodexResponsesAdapter,
  runOpenAiCodexResponses,
} from '@duoduo/ai/protocols/openai-codex-responses';
import {
  createMistralProvider,
  mistralModelRef,
} from '@duoduo/ai/providers/mistral';
import {
  createOpenAiCodexProvider,
  openAiCodexModelRef,
} from '@duoduo/ai/providers/openai-codex';
void [
  createOpenAiCodexOAuthFlow(),
  createXAiOAuthFlow(),
  createMistralConversationsAdapter(),
  createOpenAiCodexResponsesAdapter(),
  createMistralProvider(),
  createOpenAiCodexProvider(),
  mistralModelRef(),
  openAiCodexModelRef(),
  normalizeMistralToolCallId('fixture'),
  runMistralConversations,
  runOpenAiCodexResponses,
];
