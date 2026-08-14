import { describe, expect, it, vi } from 'vitest';

import { RetryStoryGeneration } from './retry-story-generation.js';

const NOW = new Date('2026-08-10T03:00:00.000Z');

describe('RetryStoryGeneration', () => {
  it.each(['failed', 'processing'] as const)(
    'resets a %s request and delegates to generation',
    async (status) => {
      const fixture = buildFixture({
        status,
        failureCode: status === 'failed' ? 'timeout' : null,
        processingStartedAt: status === 'processing' ? NOW : null,
        completedAt: status === 'failed' ? NOW : null,
      });
      const useCase = new RetryStoryGeneration(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.conversations,
        fixture.generationRequests,
        fixture.transactions,
        fixture.clock,
        fixture.generate,
      );

      await expect(
        useCase.execute({
          tenantId: 'team-id',
          actorUserId: 'creator-id',
          projectId: 'project-id',
          conversationId: 'conversation-id',
          requestId: 'generation-id',
        }),
      ).resolves.toMatchObject({ generationRequest: { status: 'pending' } });
      expect(fixture.generationRequests.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          failureCode: null,
          processingStartedAt: null,
          completedAt: null,
        }),
      );
      expect(fixture.generate.execute).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'generation-id' }),
      );
    },
  );

  it('does not reset a succeeded request', async () => {
    const fixture = buildFixture({
      status: 'succeeded',
      agentMessageId: 'agent-message-id',
      artifactId: 'artifact-id',
      artifactVersionId: 'version-id',
      completedAt: NOW,
    });
    const useCase = new RetryStoryGeneration(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.conversations,
      fixture.generationRequests,
      fixture.transactions,
      fixture.clock,
      fixture.generate,
    );

    await useCase.execute({
      tenantId: 'team-id',
      actorUserId: 'creator-id',
      projectId: 'project-id',
      conversationId: 'conversation-id',
      requestId: 'generation-id',
    });
    expect(fixture.generationRequests.update).not.toHaveBeenCalled();
    expect(fixture.generate.execute).toHaveBeenCalled();
  });
});

function buildFixture(
  overrides: Partial<{
    status: 'pending' | 'processing' | 'succeeded' | 'failed';
    failureCode: 'agent_unavailable' | 'timeout' | 'protocol_error' | null;
    processingStartedAt: Date | null;
    completedAt: Date | null;
    agentMessageId: string | null;
    artifactId: string | null;
    artifactVersionId: string | null;
  }> = {},
) {
  const request = {
    id: 'generation-id',
    tenantId: 'team-id',
    conversationId: 'conversation-id',
    triggerMessageId: 'message-id',
    idempotencyKey: 'message-key',
    inputSnapshot: { body: '请梳理人物关系' },
    status: overrides.status ?? ('failed' as const),
    failureCode: overrides.failureCode ?? 'timeout',
    processingStartedAt: overrides.processingStartedAt ?? null,
    completedAt: overrides.completedAt ?? NOW,
    agentMessageId: overrides.agentMessageId ?? null,
    artifactId: overrides.artifactId ?? null,
    artifactVersionId: overrides.artifactVersionId ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const fixture = {
    request,
    projects: {
      findByIdLocked: vi.fn(async () => project()),
      findById: vi.fn(async () => project()),
    },
    memberships: { findActive: vi.fn(async () => membership()) },
    collaborators: {
      findByProjectAndUserLocked: vi.fn(async () => null),
    },
    conversations: {
      findByIdLocked: vi.fn(async () => conversation()),
      findById: vi.fn(async () => conversation()),
    },
    generationRequests: {
      findByIdLocked: vi.fn(async () => fixture.request),
      update: vi.fn(async (value) => {
        fixture.request = value;
        return value;
      }),
    },
    transactions: {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    },
    clock: { now: vi.fn(async () => NOW) },
    generate: {
      execute: vi.fn(async () => ({
        generationRequest: { status: 'pending' },
        message: null,
        artifact: null,
        artifactVersion: null,
      })),
    },
  };
  return fixture;
}

function project() {
  return {
    id: 'project-id',
    tenantId: 'team-id',
    spaceId: 'team-space-id',
    createdByUserId: 'creator-id',
    ownerUserId: 'creator-id',
    title: '故事',
    visibility: 'team' as const,
    status: 'active' as const,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function conversation() {
  return {
    id: 'conversation-id',
    tenantId: 'team-id',
    projectId: 'project-id',
    title: '人物关系',
    status: 'active' as const,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function membership() {
  return {
    id: 'membership-id',
    tenantId: 'team-id',
    userId: 'creator-id',
    role: 'member' as const,
    joinedAt: NOW,
    removedAt: null,
  };
}
