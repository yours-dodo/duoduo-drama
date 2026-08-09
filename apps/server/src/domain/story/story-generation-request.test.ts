import { describe, expect, it } from 'vitest';

import { StoryGenerationRequest } from './story-generation-request.js';

const NOW = new Date('2026-08-10T03:00:00.000Z');

describe('StoryGenerationRequest', () => {
  it('creates a pending request from an input message snapshot', () => {
    expect(
      StoryGenerationRequest.createPending({
        id: 'generation-id',
        tenantId: 'team-id',
        conversationId: 'conversation-id',
        triggerMessageId: 'message-id',
        idempotencyKey: 'message-key',
        inputSnapshot: { body: '请梳理人物关系' },
        createdAt: NOW,
      }).toSnapshot(),
    ).toMatchObject({
      id: 'generation-id',
      tenantId: 'team-id',
      conversationId: 'conversation-id',
      triggerMessageId: 'message-id',
      idempotencyKey: 'message-key',
      inputSnapshot: { body: '请梳理人物关系' },
      status: 'pending',
    });
  });
});
