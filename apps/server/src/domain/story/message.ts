export type MessageAuthorType = 'user' | 'agent' | 'system';

export interface MessageSnapshot {
  id: string;
  tenantId: string | null;
  conversationId: string;
  authorType: MessageAuthorType;
  authorUserId: string | null;
  body: string;
  createdAt: Date;
}

export class MessageBodyInvalidError extends Error {
  constructor() {
    super('Message body must contain between 1 and 50000 characters');
    this.name = 'MessageBodyInvalidError';
  }
}

export class MessageAuthorInvalidError extends Error {
  constructor() {
    super(
      'User messages require an author and Agent or system messages do not',
    );
    this.name = 'MessageAuthorInvalidError';
  }
}

export class Message {
  private constructor(private readonly snapshot: MessageSnapshot) {}

  static create(input: {
    id: string;
    tenantId: string | null;
    conversationId: string;
    authorType: MessageAuthorType;
    authorUserId: string | null;
    body: string;
    createdAt: Date;
  }): Message {
    if (
      (input.authorType === 'user' && input.authorUserId === null) ||
      (input.authorType !== 'user' && input.authorUserId !== null)
    ) {
      throw new MessageAuthorInvalidError();
    }
    return new Message({
      id: input.id,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      authorType: input.authorType,
      authorUserId: input.authorUserId,
      body: normalizeBody(input.body),
      createdAt: new Date(input.createdAt),
    });
  }

  static restore(snapshot: MessageSnapshot): Message {
    return new Message({
      ...snapshot,
      createdAt: new Date(snapshot.createdAt),
    });
  }

  toSnapshot(): MessageSnapshot {
    return {
      ...this.snapshot,
      createdAt: new Date(this.snapshot.createdAt),
    };
  }
}

function normalizeBody(body: string): string {
  const normalized = body.trim();
  if (normalized.length < 1 || normalized.length > 50_000) {
    throw new MessageBodyInvalidError();
  }
  return normalized;
}
