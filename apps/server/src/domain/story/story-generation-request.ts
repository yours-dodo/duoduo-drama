export type StoryGenerationRequestStatus =
  'pending' | 'processing' | 'succeeded' | 'failed';

export interface StoryGenerationRequestSnapshot {
  id: string;
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
  idempotencyKey: string;
  inputSnapshot: Record<string, unknown>;
  status: StoryGenerationRequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class StoryGenerationRequest {
  private constructor(
    private readonly snapshot: StoryGenerationRequestSnapshot,
  ) {}

  static createPending(input: {
    id: string;
    tenantId: string;
    conversationId: string;
    triggerMessageId: string;
    idempotencyKey: string;
    inputSnapshot: Record<string, unknown>;
    createdAt: Date;
  }): StoryGenerationRequest {
    return new StoryGenerationRequest({
      id: input.id,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      triggerMessageId: input.triggerMessageId,
      idempotencyKey: input.idempotencyKey,
      inputSnapshot: { ...input.inputSnapshot },
      status: 'pending',
      createdAt: new Date(input.createdAt),
      updatedAt: new Date(input.createdAt),
    });
  }

  static restore(
    snapshot: StoryGenerationRequestSnapshot,
  ): StoryGenerationRequest {
    return new StoryGenerationRequest({
      ...snapshot,
      inputSnapshot: { ...snapshot.inputSnapshot },
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
    });
  }

  toSnapshot(): StoryGenerationRequestSnapshot {
    return {
      ...this.snapshot,
      inputSnapshot: { ...this.snapshot.inputSnapshot },
      createdAt: new Date(this.snapshot.createdAt),
      updatedAt: new Date(this.snapshot.updatedAt),
    };
  }
}
