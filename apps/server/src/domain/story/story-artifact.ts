export type StoryArtifactType =
  'idea' | 'world_setting' | 'character' | 'outline' | 'script';

export type StoryArtifactStatus = 'active' | 'archived';

export interface StoryArtifactSnapshot {
  id: string;
  tenantId: string;
  projectId: string;
  type: StoryArtifactType;
  title: string;
  status: StoryArtifactStatus;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class StoryArtifactTypeInvalidError extends Error {
  constructor() {
    super('Story artifact type is invalid');
    this.name = 'StoryArtifactTypeInvalidError';
  }
}

export class StoryArtifactTitleInvalidError extends Error {
  constructor() {
    super('Story artifact title must contain between 1 and 200 characters');
    this.name = 'StoryArtifactTitleInvalidError';
  }
}

export class StoryArtifactStatusInvalidError extends Error {
  constructor() {
    super('Story artifact status is invalid');
    this.name = 'StoryArtifactStatusInvalidError';
  }
}

export class StoryArtifact {
  private constructor(private readonly snapshot: StoryArtifactSnapshot) {}

  static create(input: {
    id: string;
    tenantId: string;
    projectId: string;
    type: StoryArtifactType;
    title: string;
    createdAt: Date;
  }): StoryArtifact {
    return new StoryArtifact({
      id: input.id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      type: normalizeType(input.type),
      title: normalizeTitle(input.title),
      status: 'active',
      currentVersionId: null,
      createdAt: new Date(input.createdAt),
      updatedAt: new Date(input.createdAt),
    });
  }

  static restore(snapshot: StoryArtifactSnapshot): StoryArtifact {
    return new StoryArtifact({
      ...snapshot,
      type: normalizeType(snapshot.type),
      title: normalizeTitle(snapshot.title),
      status: normalizeStatus(snapshot.status),
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
    });
  }

  toSnapshot(): StoryArtifactSnapshot {
    return {
      ...this.snapshot,
      createdAt: new Date(this.snapshot.createdAt),
      updatedAt: new Date(this.snapshot.updatedAt),
    };
  }

  setCurrentVersion(versionId: string | null, updatedAt: Date): boolean {
    this.snapshot.currentVersionId = versionId;
    this.snapshot.updatedAt = new Date(updatedAt);
    return true;
  }
}

function normalizeType(type: StoryArtifactType): StoryArtifactType {
  if (
    type !== 'idea' &&
    type !== 'world_setting' &&
    type !== 'character' &&
    type !== 'outline' &&
    type !== 'script'
  ) {
    throw new StoryArtifactTypeInvalidError();
  }
  return type;
}

function normalizeStatus(status: StoryArtifactStatus): StoryArtifactStatus {
  if (status !== 'active' && status !== 'archived') {
    throw new StoryArtifactStatusInvalidError();
  }
  return status;
}

function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length < 1 || normalized.length > 200) {
    throw new StoryArtifactTitleInvalidError();
  }
  return normalized;
}
