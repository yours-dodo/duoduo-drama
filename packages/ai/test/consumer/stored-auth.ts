import { createAi, secret, type CredentialStore } from '@duoduo/ai';
import {
  createAesGcmCredentialCodec,
  createFileCredentialStore,
  createLocalScopeAuthority,
} from '@duoduo/ai/auth/node';
import { createOpenAiProvider } from '@duoduo/ai/providers/openai';
import { createMemoryCredentialStore } from '@duoduo/ai/testing';

const memory: CredentialStore = createMemoryCredentialStore();
const local = createLocalScopeAuthority({
  tenantId: 'local',
  subjectId: 'user',
});
const ai = createAi({
  credentialStore: memory,
  scopeAuthority: local.authority,
});
ai.providers.register(createOpenAiProvider());

export async function compileStoredAuthConsumer(): Promise<void> {
  await ai.auth.login('openai', 'api_key', local.scope, {
    promptSecret: async () => secret('fixture-only'),
  });
  void createAesGcmCredentialCodec;
  void createFileCredentialStore;
}
