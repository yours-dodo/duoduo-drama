import { createAi, type AiRuntime, type ModelHandle } from '@duoduo/ai';

import type { CreateAgentOptions } from '../core/types.js';

export interface AgentRuntime<TScopeHandle> {
  readonly ai: AiRuntime<TScopeHandle>;
  readonly model: ModelHandle;
}

export async function createAgentRuntime<TScopeHandle>(
  options: CreateAgentOptions<TScopeHandle>,
): Promise<AgentRuntime<TScopeHandle>> {
  const ai = createAi(options.aiOptions);

  try {
    ai.providers.registerAll(options.providers);
    const model = await ai.models.require(
      options.model.ref,
      options.model.scope,
      options.model.readOptions,
    );

    return { ai, model };
  } catch (error) {
    await ai.dispose().catch(() => undefined);
    throw error;
  }
}
