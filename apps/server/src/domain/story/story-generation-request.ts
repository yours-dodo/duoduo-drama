export type StoryGenerationRequestStatus =
  'pending' | 'processing' | 'succeeded' | 'failed';

export type StoryGenerationFailureCode =
  'agent_unavailable' | 'timeout' | 'protocol_error';

export interface StoryGenerationRequestSnapshot {
  id: string;
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
  idempotencyKey: string;
  inputSnapshot: Record<string, unknown>;
  status: StoryGenerationRequestStatus;
  failureCode: StoryGenerationFailureCode | null;
  processingStartedAt: Date | null;
  completedAt: Date | null;
  agentMessageId: string | null;
  artifactId: string | null;
  artifactVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class StoryGenerationRequestStateTransitionError extends Error {
  constructor() {
    super('Story generation request cannot perform this state transition');
    this.name = 'StoryGenerationRequestStateTransitionError';
  }
}

export class StoryGenerationFailureCodeInvalidError extends Error {
  constructor() {
    super('Story generation failure code is invalid');
    this.name = 'StoryGenerationFailureCodeInvalidError';
  }
}

export class StoryGenerationResultInvalidError extends Error {
  constructor() {
    super('Succeeded story generation requests require all result references');
    this.name = 'StoryGenerationResultInvalidError';
  }
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
      failureCode: null,
      processingStartedAt: null,
      completedAt: null,
      agentMessageId: null,
      artifactId: null,
      artifactVersionId: null,
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
      failureCode: normalizeFailureCode(snapshot.failureCode),
      processingStartedAt: cloneDate(snapshot.processingStartedAt),
      completedAt: cloneDate(snapshot.completedAt),
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
    });
  }

  startProcessing(updatedAt: Date): boolean {
    this.assertStatus('pending');
    this.snapshot.status = 'processing';
    this.snapshot.processingStartedAt = new Date(updatedAt);
    this.snapshot.completedAt = null;
    this.snapshot.failureCode = null;
    this.snapshot.updatedAt = new Date(updatedAt);
    return true;
  }

  succeed(
    result: {
      agentMessageId: string;
      artifactId: string;
      artifactVersionId: string;
    },
    updatedAt: Date,
  ): boolean {
    this.assertStatus('processing');
    if (
      result.agentMessageId.trim().length === 0 ||
      result.artifactId.trim().length === 0 ||
      result.artifactVersionId.trim().length === 0
    ) {
      throw new StoryGenerationResultInvalidError();
    }
    this.snapshot.status = 'succeeded';
    this.snapshot.failureCode = null;
    this.snapshot.completedAt = new Date(updatedAt);
    this.snapshot.agentMessageId = result.agentMessageId;
    this.snapshot.artifactId = result.artifactId;
    this.snapshot.artifactVersionId = result.artifactVersionId;
    this.snapshot.updatedAt = new Date(updatedAt);
    return true;
  }

  fail(code: StoryGenerationFailureCode, updatedAt: Date): boolean {
    this.assertStatus('processing');
    this.snapshot.status = 'failed';
    this.snapshot.failureCode = normalizeFailureCode(code);
    this.snapshot.completedAt = new Date(updatedAt);
    this.snapshot.agentMessageId = null;
    this.snapshot.artifactId = null;
    this.snapshot.artifactVersionId = null;
    this.snapshot.updatedAt = new Date(updatedAt);
    return true;
  }

  retry(updatedAt: Date): boolean {
    if (
      this.snapshot.status !== 'failed' &&
      this.snapshot.status !== 'processing'
    ) {
      throw new StoryGenerationRequestStateTransitionError();
    }
    this.snapshot.status = 'pending';
    this.snapshot.failureCode = null;
    this.snapshot.processingStartedAt = null;
    this.snapshot.completedAt = null;
    this.snapshot.agentMessageId = null;
    this.snapshot.artifactId = null;
    this.snapshot.artifactVersionId = null;
    this.snapshot.updatedAt = new Date(updatedAt);
    return true;
  }

  toSnapshot(): StoryGenerationRequestSnapshot {
    return {
      ...this.snapshot,
      inputSnapshot: { ...this.snapshot.inputSnapshot },
      processingStartedAt: cloneDate(this.snapshot.processingStartedAt),
      completedAt: cloneDate(this.snapshot.completedAt),
      createdAt: new Date(this.snapshot.createdAt),
      updatedAt: new Date(this.snapshot.updatedAt),
    };
  }

  private assertStatus(expected: StoryGenerationRequestStatus): void {
    if (this.snapshot.status !== expected) {
      throw new StoryGenerationRequestStateTransitionError();
    }
  }
}

function normalizeFailureCode(
  code: StoryGenerationFailureCode | null,
): StoryGenerationFailureCode | null {
  if (code === null) return null;
  if (
    code !== 'agent_unavailable' &&
    code !== 'timeout' &&
    code !== 'protocol_error'
  ) {
    throw new StoryGenerationFailureCodeInvalidError();
  }
  return code;
}

function cloneDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value);
}
