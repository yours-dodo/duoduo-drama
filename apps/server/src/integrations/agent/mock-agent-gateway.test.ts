import { describe, expect, it } from 'vitest';

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
  it('starts a task and completes it with a mock script result', async () => {
    const gateway = new MockAgentGateway();

    const first = await gateway.startStory(request);
    const second = await gateway.startStory(request);

    expect(first.taskId).not.toBe(second.taskId);
    const snapshot = await gateway.getStoryTask(first.taskId);
    expect(snapshot.status).toBe('succeeded');
    expect(snapshot.result).toMatchObject({
      artifactType: 'outline',
      contentFormat: 'markdown',
      title: '故事大纲：请梳理人物关系',
    });
    expect(snapshot.result!.content).toContain('请梳理人物关系');
  });

  it('can expose a safe categorized failure for recovery tests', async () => {
    const gateway = new MockAgentGateway({ failureCode: 'timeout' });

    const task = await gateway.startStory(request);
    const snapshot = await gateway.getStoryTask(task.taskId);
    expect(snapshot.status).toBe('failed');
    expect(snapshot.failureCode).toBe('timeout');
  });
});
