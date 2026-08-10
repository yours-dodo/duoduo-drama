import { describe, expect, it } from 'vitest';

import {
  StoryGenerationRequest,
  StoryGenerationResultInvalidError,
  StoryGenerationRequestStateTransitionError,
} from './story-generation-request.js';

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
      failureCode: null,
      agentMessageId: null,
      artifactId: null,
      artifactVersionId: null,
    });
  });

  it('processes a request and records the generated result', () => {
    const request = StoryGenerationRequest.createPending({
      id: 'generation-id',
      tenantId: 'team-id',
      conversationId: 'conversation-id',
      triggerMessageId: 'message-id',
      idempotencyKey: 'message-key',
      inputSnapshot: { body: '请梳理人物关系' },
      createdAt: NOW,
    });
    const startedAt = new Date('2026-08-10T03:01:00.000Z');
    const completedAt = new Date('2026-08-10T03:02:00.000Z');

    expect(request.startProcessing(startedAt)).toBe(true);
    expect(
      request.succeed(
        {
          agentMessageId: 'agent-message-id',
          artifactId: 'artifact-id',
          artifactVersionId: 'artifact-version-id',
        },
        completedAt,
      ),
    ).toBe(true);

    expect(request.toSnapshot()).toMatchObject({
      status: 'succeeded',
      processingStartedAt: startedAt,
      completedAt,
      failureCode: null,
      agentMessageId: 'agent-message-id',
      artifactId: 'artifact-id',
      artifactVersionId: 'artifact-version-id',
    });
  });

  it('records a safe failure and allows an explicit retry', () => {
    const request = StoryGenerationRequest.createPending({
      id: 'generation-id',
      tenantId: 'team-id',
      conversationId: 'conversation-id',
      triggerMessageId: 'message-id',
      idempotencyKey: 'message-key',
      inputSnapshot: { body: '请梳理人物关系' },
      createdAt: NOW,
    });
    const failedAt = new Date('2026-08-10T03:01:00.000Z');

    request.startProcessing(failedAt);
    expect(request.fail('agent_unavailable', failedAt)).toBe(true);
    expect(request.toSnapshot()).toMatchObject({
      status: 'failed',
      failureCode: 'agent_unavailable',
      completedAt: failedAt,
    });

    expect(request.retry(new Date('2026-08-10T03:02:00.000Z'))).toBe(true);
    expect(request.toSnapshot()).toMatchObject({
      status: 'pending',
      failureCode: null,
      completedAt: null,
      agentMessageId: null,
      artifactId: null,
      artifactVersionId: null,
    });
  });

  it('rejects illegal transitions and retrying a succeeded request', () => {
    const request = StoryGenerationRequest.createPending({
      id: 'generation-id',
      tenantId: 'team-id',
      conversationId: 'conversation-id',
      triggerMessageId: 'message-id',
      idempotencyKey: 'message-key',
      inputSnapshot: { body: '请梳理人物关系' },
      createdAt: NOW,
    });

    expect(() => request.succeed({}, NOW)).toThrow(
      StoryGenerationRequestStateTransitionError,
    );
    request.startProcessing(NOW);
    expect(() =>
      request.succeed(
        {
          agentMessageId: '',
          artifactId: 'artifact-id',
          artifactVersionId: 'artifact-version-id',
        },
        NOW,
      ),
    ).toThrow(StoryGenerationResultInvalidError);
    request.succeed(
      {
        agentMessageId: 'agent-message-id',
        artifactId: 'artifact-id',
        artifactVersionId: 'artifact-version-id',
      },
      NOW,
    );
    expect(() => request.retry(NOW)).toThrow(
      StoryGenerationRequestStateTransitionError,
    );
  });
});
