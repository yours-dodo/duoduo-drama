export type StoryProjectVisibility = 'team' | 'private';
export type StoryProjectStatus = 'active' | 'archived';

export interface StoryProjectSnapshot {
  id: string;
  tenantId: string | null;
  spaceId: string;
  spaceKind?: 'personal' | 'team';
  createdByUserId: string;
  ownerUserId: string;
  title: string;
  visibility: StoryProjectVisibility;
  status: StoryProjectStatus;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export class StoryProjectTitleInvalidError extends Error {
  constructor() {
    super('Story project title must contain between 1 and 200 characters');
    this.name = 'StoryProjectTitleInvalidError';
  }
}

export class StoryProjectRevisionConflictError extends Error {
  constructor() {
    super('Story project revision does not match the expected revision');
    this.name = 'StoryProjectRevisionConflictError';
  }
}

export class StoryProjectArchivedError extends Error {
  constructor() {
    super('Archived story projects cannot be changed');
    this.name = 'StoryProjectArchivedError';
  }
}

export class StoryProject {
  private constructor(private readonly snapshot: StoryProjectSnapshot) {}

  static create(input: {
    id: string;
    tenantId: string | null;
    spaceId: string;
    spaceKind?: 'personal' | 'team';
    createdByUserId: string;
    ownerUserId: string;
    title: string;
    visibility: StoryProjectVisibility;
    createdAt: Date;
  }): StoryProject {
    return new StoryProject({
      id: input.id,
      tenantId: input.tenantId,
      spaceId: input.spaceId,
      spaceKind: input.spaceKind,
      createdByUserId: input.createdByUserId,
      ownerUserId: input.ownerUserId,
      title: normalizeTitle(input.title),
      visibility: input.visibility,
      status: 'active',
      revision: 1,
      createdAt: new Date(input.createdAt),
      updatedAt: new Date(input.createdAt),
    });
  }

  static restore(snapshot: StoryProjectSnapshot): StoryProject {
    return new StoryProject({
      ...snapshot,
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
    });
  }

  update(
    input: {
      title?: string;
      visibility?: StoryProjectVisibility;
    },
    expectedRevision: number,
    updatedAt: Date,
  ): boolean {
    this.assertRevision(expectedRevision);
    this.assertActive();

    const title =
      input.title === undefined
        ? this.snapshot.title
        : normalizeTitle(input.title);
    const visibility = input.visibility ?? this.snapshot.visibility;
    if (
      title === this.snapshot.title &&
      visibility === this.snapshot.visibility
    ) {
      return false;
    }

    this.snapshot.title = title;
    this.snapshot.visibility = visibility;
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

  toSnapshot(): StoryProjectSnapshot {
    return {
      ...this.snapshot,
      createdAt: new Date(this.snapshot.createdAt),
      updatedAt: new Date(this.snapshot.updatedAt),
    };
  }

  private assertRevision(expectedRevision: number): void {
    if (expectedRevision !== this.snapshot.revision) {
      throw new StoryProjectRevisionConflictError();
    }
  }

  private assertActive(): void {
    if (this.snapshot.status === 'archived') {
      throw new StoryProjectArchivedError();
    }
  }
}

function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length < 1 || normalized.length > 200) {
    throw new StoryProjectTitleInvalidError();
  }
  return normalized;
}
