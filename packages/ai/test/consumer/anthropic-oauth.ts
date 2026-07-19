import {
  createAi,
  type AuthHttpRequest,
  type AuthRuntimeOptions,
  type OAuthFlow,
} from '@duoduo/ai';
import { createAnthropicOAuthFlow } from '@duoduo/ai/auth/oauth/anthropic';
import { createLocalScopeAuthority } from '@duoduo/ai/auth/node';
import { createAnthropicProvider } from '@duoduo/ai/providers/anthropic';
import { createMemoryCredentialStore } from '@duoduo/ai/testing';

const flow: OAuthFlow = createAnthropicOAuthFlow();
const auth: AuthRuntimeOptions = {
  transport: {
    send: async (request: AuthHttpRequest) => {
      void request;
      return {
        status: 500,
        headers: {},
        body: new Uint8Array(),
      };
    },
  },
  networkPolicy: { authorize: async () => {} },
};
const local = createLocalScopeAuthority({
  tenantId: 'local',
  subjectId: 'user',
});
const ai = createAi({
  credentialStore: createMemoryCredentialStore(),
  scopeAuthority: local.authority,
  auth,
});
const provider = createAnthropicProvider();
ai.providers.register(provider);

export async function compileAnthropicOAuthConsumer(): Promise<void> {
  await ai.auth.status(provider.id, local.scope);
  void flow.refreshSkewMs;
}
