import { describe, expect, it } from 'vitest';

import { AgentGatewayError } from './agent-gateway.js';
import { MockAgentGateway } from './mock-agent-gateway.js';

const request = {
  requestId: 'generation-id',
  idempotencyKey: 'message-key',
  authorization: {
    tenantId: 'team-id',
    projectId: 'project-id',
    conversationId: 'conversation-id',
  },
  userPrompt: '请梳理人物关系',
  messages: [
    {
      authorType: 'user' as const,
      body: '请梳理人物关系',
    },
  ],
  artifacts: [],
};

describe('MockAgentGateway', () => {
  it('returns the same candidate for the same authorized input', async () => {
    const gateway = new MockAgentGateway();

    const first = await gateway.generateStory(request);
    const second = await gateway.generateStory(request);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      artifactType: 'outline',
      contentFormat: 'markdown',
      title: '故事大纲：请梳理人物关系',
    });
    expect(first.content).toContain('请梳理人物关系');
    expect(first.assistantBody).toContain('故事大纲：请梳理人物关系');
  });

  it('can expose a safe categorized failure for recovery tests', async () => {
    const gateway = new MockAgentGateway({ failureCode: 'timeout' });

    await expect(gateway.generateStory(request)).rejects.toMatchObject(
      new AgentGatewayError('timeout'),
    );
  });
});
