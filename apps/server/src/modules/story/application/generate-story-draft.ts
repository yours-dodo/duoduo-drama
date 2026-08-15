import { Message } from '../../../domain/story/message.js';
import { StoryArtifact } from '../../../domain/story/story-artifact.js';
import { StoryArtifactVersion } from '../../../domain/story/story-artifact-version.js';
import {
  StoryGenerationRequest,
  type StoryGenerationFailureCode,
  type StoryGenerationRequestSnapshot,
} from '../../../domain/story/story-generation-request.js';
import type {
  AgentGateway,
  StoryGenerationAgentRequest,
  StoryGenerationAgentResult,
  StoryTaskRef,
} from '../../../integrations/agent/agent-contracts.js';
import { AgentGatewayError } from '../../../integrations/agent/agent-gateway.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryArtifactVersionRepository } from '../ports/story-artifact-version-repository.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { MessageRepository } from '../ports/message-repository.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryGenerationRequestRepository } from '../ports/story-generation-request-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { generationRequestOutput, messageOutput } from './message-output.js';
import {
  artifactOutput,
  artifactVersionOutput,
} from './story-artifact-output.js';
import {
  readConversationAccess,
  requireConversationEdit,
  requireConversationView,
} from './conversation-authorization.js';
import {
  ConversationArchivedError,
  StoryGenerationRequestNotFoundError,
  StoryGenerationResultUnavailableError,
  StoryProjectAccessDeniedError,
} from './story-errors.js';

type TransactionRunner = {
  run<T>(operation: () => Promise<T>): Promise<T>;
};

type DatabaseClock = { now(): Promise<Date> };
type IdFactory = { create(): string };

export interface StoryGenerationExecutionOutput {
  message: ReturnType<typeof messageOutput> | null;
  generationRequest: ReturnType<typeof generationRequestOutput>;
  artifact: ReturnType<typeof artifactOutput> | null;
  artifactVersion: ReturnType<typeof artifactVersionOutput> | null;
}

export class GenerateStoryDraft {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly generationRequests: StoryGenerationRequestRepository,
    private readonly artifacts: StoryArtifactRepository,
    private readonly artifactVersions: StoryArtifactVersionRepository,
    private readonly gateway: AgentGateway,
    private readonly transactions: TransactionRunner,
    private readonly databaseClock: DatabaseClock,
    private readonly ids: IdFactory,
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    conversationId: string;
    requestId: string;
  }): Promise<StoryGenerationExecutionOutput> {
    const prepared = await this.authorizeAndStart(input);
    if (prepared.request.status === 'succeeded') {
      return this.readResult(prepared.request);
    }
    if (!prepared.started) {
      return emptyResult(prepared.request);
    }

    try {
      const agentRequest = await this.buildAgentRequest(
        input,
        prepared.request,
      );
      const task = await this.gateway.startStory(agentRequest);
      const updated = await this.updateTaskRef(prepared.request, task);
      return emptyResult(updated);
    } catch (error) {
      return this.failAndRead(input, failureCodeFor(error));
    }
  }

  async read(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    conversationId: string;
    requestId: string;
  }): Promise<StoryGenerationExecutionOutput> {
    const request = await this.authorizeAndRead(input);
    if (request.status === 'succeeded') return this.readResult(request);
    if (request.status !== 'processing') return emptyResult(request);

    const taskId = readAgentTaskId(request);
    if (!taskId) return emptyResult(request);

    let task;
    try {
      task = await this.gateway.getStoryTask(taskId);
    } catch {
      // Transient polling failure: keep the request processing and let the
      // client poll again instead of failing the whole generation.
      return emptyResult(request);
    }
    if (task.status === 'failed') {
      return this.failAndRead(input, task.failureCode ?? 'agent_unavailable');
    }
    if (task.status === 'succeeded' && task.result) {
      try {
        return await this.persistSuccess(input, request, task.result);
      } catch (error) {
        return this.failAndRead(input, failureCodeFor(error));
      }
    }
    const updated = await this.updateTaskRef(request, task);
    return emptyResult(updated);
  }

  private async updateTaskRef(
    request: StoryGenerationRequestSnapshot,
    task: StoryTaskRef,
  ): Promise<StoryGenerationRequestSnapshot> {
    return this.transactions.run(async () => {
      const current = await this.generationRequests.findByIdLocked({
        tenantId: request.tenantId,
        requestId: request.id,
      });
      if (current === null) return request;
      const aggregate = StoryGenerationRequest.restore(current);
      const snapshot = aggregate.toSnapshot();
      return this.generationRequests.update({
        ...snapshot,
        inputSnapshot: {
          ...(snapshot.inputSnapshot as Record<string, unknown>),
          agentTaskId: task.taskId,
          pipelineStage: task.stage,
        },
      });
    });
  }

  private async authorizeAndStart(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    conversationId: string;
    requestId: string;
  }): Promise<{ request: StoryGenerationRequestSnapshot; started: boolean }> {
    return this.transactions.run(async () => {
      await this.requireConversationEditor(input, true);
      const request = await this.generationRequests.findByIdLocked({
        tenantId: input.tenantId,
        requestId: input.requestId,
      });
      this.assertRequestConversation(request, input.conversationId);

      if (request.status !== 'pending') {
        return { request, started: false };
      }

      const aggregate = StoryGenerationRequest.restore(request);
      aggregate.startProcessing(await this.databaseClock.now());
      return {
        request: await this.generationRequests.update(aggregate.toSnapshot()),
        started: true,
      };
    });
  }

  private async authorizeAndRead(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    conversationId: string;
    requestId: string;
  }): Promise<StoryGenerationRequestSnapshot> {
    return this.transactions.run(async () => {
      await this.requireConversationViewer(input);
      const request = await this.generationRequests.findById({
        tenantId: input.tenantId,
        requestId: input.requestId,
      });
      this.assertRequestConversation(request, input.conversationId);
      return request;
    });
  }

  private async requireConversationViewer(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    conversationId: string;
  }): Promise<void> {
    const membership = await this.memberships.findActive({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (membership === null) throw new StoryProjectAccessDeniedError();
    const access = await readConversationAccess(
      this.projects,
      this.collaborators,
      this.conversations,
      {
        tenantId: input.tenantId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        membership,
        lock: false,
      },
    );
    requireConversationView(access);
  }

  private async requireConversationEditor(
    input: {
      tenantId: string;
      actorUserId: string;
      projectId: string;
      conversationId: string;
    },
    lock: boolean,
  ): Promise<void> {
    const membership = await this.memberships.findActive({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (membership === null) throw new StoryProjectAccessDeniedError();
    const access = await readConversationAccess(
      this.projects,
      this.collaborators,
      this.conversations,
      {
        tenantId: input.tenantId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        membership,
        lock,
      },
    );
    requireConversationEdit(access);
    if (access.conversation.status === 'archived') {
      throw new ConversationArchivedError();
    }
  }

  private async buildAgentRequest(
    input: {
      tenantId: string;
      projectId: string;
      conversationId: string;
    },
    request: StoryGenerationRequestSnapshot,
  ): Promise<StoryGenerationAgentRequest> {
    const [triggerMessage, messagePage, artifacts] = await Promise.all([
      this.messages.findById({
        tenantId: input.tenantId,
        messageId: request.triggerMessageId,
      }),
      this.messages.listForConversation({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        page: { limit: 100, after: null },
      }),
      this.artifacts.listForProject({
        tenantId: input.tenantId,
        projectId: input.projectId,
      }),
    ]);
    if (
      triggerMessage === null ||
      triggerMessage.conversationId !== input.conversationId ||
      triggerMessage.authorType !== 'user'
    ) {
      throw new Error('Story generation trigger message is unavailable');
    }

    const currentVersions = await Promise.all(
      artifacts
        .filter((artifact) => artifact.currentVersionId !== null)
        .map(async (artifact) => {
          const version = await this.artifactVersions.findById({
            tenantId: input.tenantId,
            versionId: artifact.currentVersionId!,
          });
          if (version === null || version.artifactId !== artifact.id) {
            throw new Error('Story artifact current version is unavailable');
          }
          return { artifact, version };
        }),
    );

    return {
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      authorization: {
        tenantId: input.tenantId,
        projectId: input.projectId,
        conversationId: input.conversationId,
      },
      userPrompt: triggerMessage.body,
      messages: messagePage.items
        .slice()
        .reverse()
        .map((message) => ({
          authorType: message.authorType,
          body: message.body,
        })),
      artifacts: currentVersions.map(({ artifact, version }) => ({
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        content: version.content,
        sourceType: version.sourceType,
      })),
    };
  }

  private async persistSuccess(
    input: {
      tenantId: string;
      actorUserId: string;
      projectId: string;
      conversationId: string;
      requestId: string;
    },
    processingRequest: StoryGenerationRequestSnapshot,
    result: StoryGenerationAgentResult,
  ): Promise<StoryGenerationExecutionOutput> {
    return this.transactions.run(async () => {
      await this.requireConversationEditor(input, true);
      const current = await this.generationRequests.findByIdLocked({
        tenantId: input.tenantId,
        requestId: input.requestId,
      });
      this.assertRequestConversation(current, input.conversationId);
      if (current.status === 'succeeded') {
        return this.readResult(current);
      }
      if (current.status !== 'processing') {
        return emptyResult(current);
      }

      const now = await this.databaseClock.now();
      const assistantMessage = Message.create({
        id: this.ids.create(),
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        authorType: 'agent',
        authorUserId: null,
        body: result.assistantBody,
        createdAt: now,
      }).toSnapshot();
      const artifact = StoryArtifact.create({
        id: this.ids.create(),
        tenantId: input.tenantId,
        projectId: input.projectId,
        type: result.artifactType,
        title: result.title,
        createdAt: now,
      }).toSnapshot();
      const version = StoryArtifactVersion.createDraft({
        id: this.ids.create(),
        tenantId: input.tenantId,
        artifactId: artifact.id,
        versionNumber: 1,
        content: result.content,
        contentFormat: result.contentFormat,
        sourceType: 'agent',
        sourceMessageId: assistantMessage.id,
        generationRequestId: processingRequest.id,
        createdByUserId: null,
        createdAt: now,
      }).toSnapshot();
      const artifactWithCurrentVersion = StoryArtifact.restore({
        ...artifact,
        currentVersionId: version.id,
        updatedAt: now,
      }).toSnapshot();

      await this.messages.create(assistantMessage);
      await this.artifacts.create(artifact);
      await this.artifactVersions.create(version);
      await this.artifacts.update(artifactWithCurrentVersion);

      const aggregate = StoryGenerationRequest.restore(current);
      aggregate.succeed(
        {
          agentMessageId: assistantMessage.id,
          artifactId: artifact.id,
          artifactVersionId: version.id,
        },
        now,
      );
      const generationRequest = await this.generationRequests.update(
        aggregate.toSnapshot(),
      );
      return {
        generationRequest: generationRequestOutput(generationRequest),
        message: messageOutput(assistantMessage),
        artifact: artifactOutput(artifactWithCurrentVersion),
        artifactVersion: artifactVersionOutput(version),
      };
    });
  }

  private async failAndRead(
    input: {
      tenantId: string;
      requestId: string;
    },
    failureCode: StoryGenerationFailureCode,
  ): Promise<StoryGenerationExecutionOutput> {
    const request = await this.transactions.run(async () => {
      const current = await this.generationRequests.findByIdLocked({
        tenantId: input.tenantId,
        requestId: input.requestId,
      });
      if (current === null) throw new StoryGenerationRequestNotFoundError();
      if (current.status !== 'processing') return current;
      const aggregate = StoryGenerationRequest.restore(current);
      aggregate.fail(failureCode, await this.databaseClock.now());
      return this.generationRequests.update(aggregate.toSnapshot());
    });
    return request.status === 'succeeded'
      ? this.readResult(request)
      : emptyResult(request);
  }

  private async readResult(
    request: StoryGenerationRequestSnapshot,
  ): Promise<StoryGenerationExecutionOutput> {
    if (
      request.agentMessageId === null ||
      request.artifactId === null ||
      request.artifactVersionId === null
    ) {
      throw new StoryGenerationResultUnavailableError();
    }
    const [message, artifact, artifactVersion] = await Promise.all([
      this.messages.findById({
        tenantId: request.tenantId,
        messageId: request.agentMessageId,
      }),
      this.artifacts.findById({
        tenantId: request.tenantId,
        artifactId: request.artifactId,
      }),
      this.artifactVersions.findById({
        tenantId: request.tenantId,
        versionId: request.artifactVersionId,
      }),
    ]);
    if (
      message === null ||
      artifact === null ||
      artifactVersion === null ||
      message.conversationId !== request.conversationId ||
      artifactVersion.artifactId !== artifact.id
    ) {
      throw new StoryGenerationResultUnavailableError();
    }
    return {
      generationRequest: generationRequestOutput(request),
      message: messageOutput(message),
      artifact: artifactOutput(artifact),
      artifactVersion: artifactVersionOutput(artifactVersion),
    };
  }

  private assertRequestConversation(
    request: StoryGenerationRequestSnapshot | null,
    conversationId: string,
  ): asserts request is StoryGenerationRequestSnapshot {
    if (request === null || request.conversationId !== conversationId) {
      throw new StoryGenerationRequestNotFoundError();
    }
  }
}

function emptyResult(
  request: StoryGenerationRequestSnapshot,
): StoryGenerationExecutionOutput {
  return {
    generationRequest: generationRequestOutput(request),
    message: null,
    artifact: null,
    artifactVersion: null,
  };
}

function readAgentTaskId(
  request: StoryGenerationRequestSnapshot,
): string | null {
  const inputSnapshot = request.inputSnapshot as
    | { agentTaskId?: unknown }
    | undefined;
  return typeof inputSnapshot?.agentTaskId === 'string'
    ? inputSnapshot.agentTaskId
    : null;
}

function failureCodeFor(error: unknown): StoryGenerationFailureCode {
  if (error instanceof AgentGatewayError) return error.failureCode;
  return 'protocol_error';
}
