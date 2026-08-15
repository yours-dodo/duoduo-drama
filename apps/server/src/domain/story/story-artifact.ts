export type StoryArtifactType = 'outline' | 'roles' | 'worldview' | 'story';

export const STORY_MODULE_DEFINITIONS: ReadonlyArray<{
  type: StoryArtifactType;
  title: string;
}> = [
  { type: 'outline', title: '大纲' },
  { type: 'roles', title: '角色资产' },
  { type: 'worldview', title: '世界观' },
  { type: 'story', title: '故事页' },
];

export function storyModuleOrder(type: StoryArtifactType): number {
  return STORY_MODULE_DEFINITIONS.findIndex((module) => module.type === type);
}

export type StoryArtifactStatus = 'active' | 'archived';

export interface StoryArtifactSnapshot {
  id: string;
  tenantId: string | null;
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
    tenantId: string | null;
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
    type !== 'outline' &&
    type !== 'roles' &&
    type !== 'worldview' &&
    type !== 'story'
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
