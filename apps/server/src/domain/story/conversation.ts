export type ConversationStatus = 'active' | 'archived';

export interface ConversationSnapshot {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  status: ConversationStatus;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export class ConversationTitleInvalidError extends Error {
  constructor() {
    super('Conversation title must contain between 1 and 200 characters');
    this.name = 'ConversationTitleInvalidError';
  }
}

export class ConversationRevisionConflictError extends Error {
  constructor() {
    super('Conversation revision does not match the expected revision');
    this.name = 'ConversationRevisionConflictError';
  }
}

export class ConversationArchivedError extends Error {
  constructor() {
    super('Archived conversations cannot be changed');
    this.name = 'ConversationArchivedError';
  }
}

export class Conversation {
  private constructor(private readonly snapshot: ConversationSnapshot) {}

  static create(input: {
    id: string;
    tenantId: string;
    projectId: string;
    title: string;
    createdAt: Date;
  }): Conversation {
    return new Conversation({
      id: input.id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      title: normalizeTitle(input.title),
      status: 'active',
      revision: 1,
      createdAt: new Date(input.createdAt),
      updatedAt: new Date(input.createdAt),
    });
  }

  static restore(snapshot: ConversationSnapshot): Conversation {
    return new Conversation({
      ...snapshot,
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
    });
  }

  rename(title: string, expectedRevision: number, updatedAt: Date): boolean {
    this.assertRevision(expectedRevision);
    this.assertActive();
    const normalized = normalizeTitle(title);
    if (normalized === this.snapshot.title) return false;

    this.snapshot.title = normalized;
    this.snapshot.revision += 1;
    this.snapshot.updatedAt = new Date(updatedAt);
    return true;
  }

  archive(expectedRevision: number, updatedAt: Date): boolean {
    if (this.snapshot.status === 'archived') return false;
    this.assertRevision(expectedRevision);
    this.snapshot.status = 'archived';
    this.snapshot.revision += 1;
    this.snapshot.updatedAt = new Date(updatedAt);
    return true;
  }

  toSnapshot(): ConversationSnapshot {
    return {
      ...this.snapshot,
      createdAt: new Date(this.snapshot.createdAt),
      updatedAt: new Date(this.snapshot.updatedAt),
    };
  }

  private assertRevision(expectedRevision: number): void {
    if (expectedRevision !== this.snapshot.revision) {
      throw new ConversationRevisionConflictError();
    }
  }

  private assertActive(): void {
    if (this.snapshot.status === 'archived') {
      throw new ConversationArchivedError();
    }
  }
}

function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length < 1 || normalized.length > 200) {
    throw new ConversationTitleInvalidError();
  }
  return normalized;
}
