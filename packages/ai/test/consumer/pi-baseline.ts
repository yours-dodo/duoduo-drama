import { createOpenAiCodexOAuthFlow } from '@duoduo/ai/auth/oauth/openai-codex';
import {
  createRadiusOAuthFlow,
  discoverRadiusOAuthConfig,
} from '@duoduo/ai/auth/oauth/radius';
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
  createPiMessagesAdapter,
  runPiMessages,
} from '@duoduo/ai/protocols/pi-messages';
import {
  createMistralProvider,
  mistralModelRef,
} from '@duoduo/ai/providers/mistral';
import {
  createOpenAiCodexProvider,
  openAiCodexModelRef,
} from '@duoduo/ai/providers/openai-codex';
import {
  createRadiusProvider,
  radiusModelRef,
  type RadiusProviderOptions,
} from '@duoduo/ai/providers/radius';

const radiusOptions: RadiusProviderOptions = { models: [{ id: 'fixture' }] };
void [
  createOpenAiCodexOAuthFlow(),
  createRadiusOAuthFlow(),
  createXAiOAuthFlow(),
  createMistralConversationsAdapter(),
  createOpenAiCodexResponsesAdapter(),
  createPiMessagesAdapter(),
  createMistralProvider(),
  createOpenAiCodexProvider(),
  createRadiusProvider(radiusOptions),
  mistralModelRef(),
  openAiCodexModelRef(),
  radiusModelRef('fixture'),
  normalizeMistralToolCallId('fixture'),
  runMistralConversations,
  runOpenAiCodexResponses,
  runPiMessages,
  discoverRadiusOAuthConfig,
];
