import { describe, expect, it, vi } from 'vitest';

import { AgentGatewayError } from '../../../integrations/agent/agent-gateway.js';
import { GenerateStoryDraft } from './generate-story-draft.js';

const NOW = new Date('2026-08-10T03:00:00.000Z');

describe('GenerateStoryDraft', () => {
  it('commits an Agent message, draft artifact, and version after the gateway succeeds', async () => {
    const fixture = buildFixture();
    const useCase = new GenerateStoryDraft(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.conversations,
      fixture.messages,
      fixture.generationRequests,
      fixture.artifacts,
      fixture.artifactVersions,
      fixture.gateway,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
    );

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        requestId: 'generation-id',
      }),
    ).resolves.toMatchObject({
      generationRequest: {
        id: 'generation-id',
        status: 'succeeded',
        agentMessageId: 'agent-message-id',
        artifactId: 'artifact-id',
        artifactVersionId: 'version-id',
      },
      message: {
        id: 'agent-message-id',
        authorType: 'agent',
      },
      artifact: {
        id: 'artifact-id',
        currentVersionId: 'version-id',
      },
      artifactVersion: {
        id: 'version-id',
        status: 'draft',
        sourceType: 'agent',
        generationRequestId: 'generation-id',
      },
    });
    expect(fixture.gateway.generateStory).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'generation-id',
        userPrompt: '请梳理人物关系',
        messages: [{ authorType: 'user', body: '请梳理人物关系' }],
      }),
    );
    expect(fixture.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-message-id',
        authorType: 'agent',
      }),
    );
    expect(fixture.artifactVersions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: 'artifact-id',
        sourceMessageId: 'agent-message-id',
      }),
    );
  });

  it('records a categorized Agent failure without creating a partial result', async () => {
    const fixture = buildFixture({
      gatewayError: new AgentGatewayError('timeout'),
    });
    const useCase = createUseCase(fixture);

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        requestId: 'generation-id',
      }),
    ).resolves.toMatchObject({
      generationRequest: {
        status: 'failed',
        failureCode: 'timeout',
      },
      message: null,
      artifact: null,
      artifactVersion: null,
    });
    expect(fixture.messages.create).not.toHaveBeenCalled();
    expect(fixture.artifacts.create).not.toHaveBeenCalled();
    expect(fixture.artifactVersions.create).not.toHaveBeenCalled();
  });

  it('replays a succeeded request without calling the Agent again', async () => {
    const fixture = buildFixture({
      request: generationRequest({
        status: 'succeeded',
        agentMessageId: 'agent-message-id',
        artifactId: 'artifact-id',
        artifactVersionId: 'version-id',
        completedAt: NOW,
      }),
      resultMessage: {
        id: 'agent-message-id',
        tenantId: 'team-id',
        conversationId: 'conversation-id',
        authorType: 'agent',
        authorUserId: null,
        body: '已生成',
        createdAt: NOW,
      },
      resultArtifact: {
        id: 'artifact-id',
        tenantId: 'team-id',
        projectId: 'project-id',
        type: 'outline' as const,
        title: '故事大纲',
        status: 'active' as const,
        currentVersionId: 'version-id',
        createdAt: NOW,
        updatedAt: NOW,
      },
      resultVersion: {
        id: 'version-id',
        tenantId: 'team-id',
        artifactId: 'artifact-id',
        versionNumber: 1,
        content: '# 故事大纲',
        contentFormat: 'markdown' as const,
        status: 'draft' as const,
        sourceType: 'agent' as const,
        sourceMessageId: 'agent-message-id',
        generationRequestId: 'generation-id',
        createdByUserId: null,
        createdAt: NOW,
      },
    });
    const useCase = createUseCase(fixture);

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        requestId: 'generation-id',
      }),
    ).resolves.toMatchObject({
      generationRequest: { status: 'succeeded' },
      message: { id: 'agent-message-id' },
      artifactVersion: { id: 'version-id' },
    });
    expect(fixture.gateway.generateStory).not.toHaveBeenCalled();
    expect(fixture.messages.create).not.toHaveBeenCalled();
  });

  it('leaves an already processing request for explicit recovery', async () => {
    const fixture = buildFixture({
      request: generationRequest({
        status: 'processing',
        processingStartedAt: NOW,
      }),
    });
    const useCase = createUseCase(fixture);

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        requestId: 'generation-id',
      }),
    ).resolves.toMatchObject({
      generationRequest: { status: 'processing' },
      message: null,
    });
    expect(fixture.gateway.generateStory).not.toHaveBeenCalled();
  });
});

function createUseCase(fixture: ReturnType<typeof buildFixture>) {
  return new GenerateStoryDraft(
    fixture.projects,
    fixture.memberships,
    fixture.collaborators,
    fixture.conversations,
    fixture.messages,
    fixture.generationRequests,
    fixture.artifacts,
    fixture.artifactVersions,
    fixture.gateway,
    fixture.transactions,
    fixture.clock,
    fixture.ids,
  );
}

function generationRequest(
  overrides: Partial<ReturnType<typeof generationRequest>> = {},
) {
  return {
    id: 'generation-id',
    tenantId: 'team-id',
    conversationId: 'conversation-id',
    triggerMessageId: 'message-id',
    idempotencyKey: 'message-key',
    inputSnapshot: { body: '请梳理人物关系' },
    status: 'pending' as const,
    failureCode: null,
    processingStartedAt: null,
    completedAt: null,
    agentMessageId: null,
    artifactId: null,
    artifactVersionId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildFixture(
  options: {
    request?: ReturnType<typeof generationRequest>;
    gatewayError?: AgentGatewayError;
    resultMessage?: Record<string, unknown> | null;
    resultArtifact?: Record<string, unknown> | null;
    resultVersion?: Record<string, unknown> | null;
  } = {},
) {
  const fixture = {
    request: options.request ?? generationRequest(),
    resultMessage: options.resultMessage ?? null,
    resultArtifact: options.resultArtifact ?? null,
    resultVersion: options.resultVersion ?? null,
    projects: {
      findById: vi.fn(async () => project()),
      findByIdLocked: vi.fn(async () => project()),
    },
    memberships: {
      findActive: vi.fn(async () => membership()),
    },
    collaborators: {
      findByProjectAndUserLocked: vi.fn(async () => ({
        id: 'collaborator-id',
        tenantId: 'team-id',
        projectId: 'project-id',
        userId: 'creator-id',
        createdAt: NOW,
      })),
    },
    conversations: {
      findById: vi.fn(async () => conversation()),
      findByIdLocked: vi.fn(async () => conversation()),
    },
    messages: {
      create: vi.fn(async (value) => value),
      findById: vi.fn(async (request: { messageId: string }) =>
        request.messageId === 'message-id'
          ? userMessage()
          : fixture.resultMessage,
      ),
      listForConversation: vi.fn(async () => ({
        items: [userMessage()],
        next: null,
      })),
    },
    generationRequests: {
      findById: vi.fn(async () => fixture.request),
      findByIdLocked: vi.fn(async () => fixture.request),
      update: vi.fn(async (value) => {
        fixture.request = value;
        return value;
      }),
    },
    artifacts: {
      create: vi.fn(async (value) => value),
      update: vi.fn(async (value) => value),
      findById: vi.fn(async () => fixture.resultArtifact),
      listForProject: vi.fn(async () => []),
    },
    artifactVersions: {
      create: vi.fn(async (value) => value),
      findById: vi.fn(async () => fixture.resultVersion),
      listForArtifact: vi.fn(async () => []),
    },
    gateway: {
      generateStory: vi.fn(async () => {
        if (options.gatewayError) throw options.gatewayError;
        return {
          artifactType: 'outline' as const,
          title: '故事大纲',
          content: '# 故事大纲',
          contentFormat: 'markdown' as const,
          assistantBody: '已生成故事草稿',
        };
      }),
    },
    transactions: {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    },
    clock: { now: vi.fn(async () => NOW) },
    ids: {
      create: vi
        .fn()
        .mockReturnValueOnce('agent-message-id')
        .mockReturnValueOnce('artifact-id')
        .mockReturnValueOnce('version-id'),
    },
  };
  return fixture;
}

function project() {
  return {
    id: 'project-id',
    tenantId: 'team-id',
    createdByUserId: 'creator-id',
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

function userMessage() {
  return {
    id: 'message-id',
    tenantId: 'team-id',
    conversationId: 'conversation-id',
    authorType: 'user' as const,
    authorUserId: 'creator-id',
    body: '请梳理人物关系',
    createdAt: NOW,
  };
}
