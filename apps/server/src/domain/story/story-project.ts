export type StoryProjectVisibility = 'team' | 'private';
export type StoryProjectStatus = 'active' | 'archived';
export type StoryCreationMode = 'standard' | 'immersive';
export type StoryProjectEra = '现代' | '古代';

export const STORY_PROJECT_RETENTION_DAYS = 30;
export const STORY_PROJECT_RETENTION_MS =
  STORY_PROJECT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface StoryProjectSnapshot {
  id: string;
  tenantId: string | null;
  spaceId: string;
  spaceKind?: 'personal' | 'team';
  createdByUserId: string;
  ownerUserId: string;
  title: string;
  description?: string;
  era?: StoryProjectEra;
  tags?: string[];
  creationMode: StoryCreationMode;
  visibility: StoryProjectVisibility;
  status: StoryProjectStatus;
  archivedAt: Date | null;
  purgeAt: Date | null;
  purgeStartedAt: Date | null;
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

export class StoryProjectDescriptionInvalidError extends Error {
  constructor() {
    super('Story project description must contain at most 2000 characters');
    this.name = 'StoryProjectDescriptionInvalidError';
  }
}

export class StoryProjectEraInvalidError extends Error {
  constructor() {
    super('Story project era must be modern or ancient');
    this.name = 'StoryProjectEraInvalidError';
  }
}

export class StoryProjectTagsInvalidError extends Error {
  constructor() {
    super('Story project tags must contain at most 16 non-empty labels');
    this.name = 'StoryProjectTagsInvalidError';
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

export class StoryProjectPurgeUnavailableError extends Error {
  constructor() {
    super('Archived story project is no longer available for restoration');
    this.name = 'StoryProjectPurgeUnavailableError';
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
    description?: string;
    era?: StoryProjectEra;
    tags?: string[];
    creationMode: StoryCreationMode;
    visibility: StoryProjectVisibility;
    createdAt: Date;
  }): StoryProject {
    const snapshot: StoryProjectSnapshot = {
      id: input.id,
      tenantId: input.tenantId,
      spaceId: input.spaceId,
      spaceKind: input.spaceKind,
      createdByUserId: input.createdByUserId,
      ownerUserId: input.ownerUserId,
      title: normalizeTitle(input.title),
      creationMode: normalizeCreationMode(input.creationMode),
      visibility: input.visibility,
      status: 'active',
      archivedAt: null,
      purgeAt: null,
      purgeStartedAt: null,
      revision: 1,
      createdAt: new Date(input.createdAt),
      updatedAt: new Date(input.createdAt),
    };
    if (input.description !== undefined) {
      snapshot.description = normalizeDescription(input.description);
    }
    if (input.era !== undefined) snapshot.era = normalizeEra(input.era);
    if (input.tags !== undefined) snapshot.tags = normalizeTags(input.tags);
    return new StoryProject(snapshot);
  }

  static restore(snapshot: StoryProjectSnapshot): StoryProject {
    return new StoryProject({
      ...snapshot,
      description: normalizeDescription(snapshot.description ?? ''),
      era: normalizeEra(snapshot.era ?? '现代'),
      tags: normalizeTags(snapshot.tags ?? []),
      creationMode: normalizeCreationMode(snapshot.creationMode),
      archivedAt:
        snapshot.archivedAt === null ? null : new Date(snapshot.archivedAt),
      purgeAt: snapshot.purgeAt === null ? null : new Date(snapshot.purgeAt),
      purgeStartedAt:
        snapshot.purgeStartedAt === null
          ? null
          : new Date(snapshot.purgeStartedAt),
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
    });
  }

  update(
    input: {
      title?: string;
      description?: string;
      era?: StoryProjectEra;
      tags?: string[];
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
    const description =
      input.description === undefined
        ? (this.snapshot.description ?? '')
        : normalizeDescription(input.description);
    const era =
      input.era === undefined
        ? (this.snapshot.era ?? '现代')
        : normalizeEra(input.era);
    const tags =
      input.tags === undefined
        ? (this.snapshot.tags ?? [])
        : normalizeTags(input.tags);
    const visibility = input.visibility ?? this.snapshot.visibility;
    if (
      title === this.snapshot.title &&
      description === (this.snapshot.description ?? '') &&
      era === (this.snapshot.era ?? '现代') &&
      sameTags(tags, this.snapshot.tags ?? []) &&
      visibility === this.snapshot.visibility
    ) {
      return false;
    }

    this.snapshot.title = title;
    this.snapshot.description = description;
    this.snapshot.era = era;
    this.snapshot.tags = [...tags];
    this.snapshot.visibility = visibility;
    this.snapshot.revision += 1;
    this.snapshot.updatedAt = new Date(updatedAt);
    return true;
  }

  archive(expectedRevision: number, updatedAt: Date): boolean {
    if (this.snapshot.status === 'archived') return false;
    this.assertRevision(expectedRevision);
    this.snapshot.status = 'archived';
    this.snapshot.archivedAt = new Date(updatedAt);
    this.snapshot.purgeAt = new Date(
      updatedAt.getTime() + STORY_PROJECT_RETENTION_MS,
    );
    this.snapshot.purgeStartedAt = null;
    this.snapshot.revision += 1;
    this.snapshot.updatedAt = new Date(updatedAt);
    return true;
  }

  restoreFromArchive(expectedRevision: number, restoredAt: Date): boolean {
    if (this.snapshot.status === 'active') return false;
    this.assertRevision(expectedRevision);
    if (
      this.snapshot.purgeStartedAt !== null ||
      this.snapshot.purgeAt === null ||
      this.snapshot.purgeAt.getTime() <= restoredAt.getTime()
    ) {
      throw new StoryProjectPurgeUnavailableError();
    }
    this.snapshot.status = 'active';
    this.snapshot.archivedAt = null;
    this.snapshot.purgeAt = null;
    this.snapshot.purgeStartedAt = null;
    this.snapshot.revision += 1;
    this.snapshot.updatedAt = new Date(restoredAt);
    return true;
  }

  toSnapshot(): StoryProjectSnapshot {
    return {
      ...this.snapshot,
      archivedAt:
        this.snapshot.archivedAt === null
          ? null
          : new Date(this.snapshot.archivedAt),
      purgeAt:
        this.snapshot.purgeAt === null ? null : new Date(this.snapshot.purgeAt),
      purgeStartedAt:
        this.snapshot.purgeStartedAt === null
          ? null
          : new Date(this.snapshot.purgeStartedAt),
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

function normalizeDescription(description: string): string {
  if (typeof description !== 'string') {
    throw new StoryProjectDescriptionInvalidError();
  }
  const normalized = description.trim();
  if (normalized.length > 2000) {
    throw new StoryProjectDescriptionInvalidError();
  }
  return normalized;
}

function normalizeEra(era: StoryProjectEra): StoryProjectEra {
  if (era !== '现代' && era !== '古代') {
    throw new StoryProjectEraInvalidError();
  }
  return era;
}

function normalizeTags(tags: string[]): string[] {
  if (!Array.isArray(tags) || tags.length > 16) {
    throw new StoryProjectTagsInvalidError();
  }
  const normalized: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      throw new StoryProjectTagsInvalidError();
    }
    const value = tag.trim();
    if (value.length < 1 || value.length > 50 || normalized.includes(value)) {
      if (value.length < 1 || value.length > 50) {
        throw new StoryProjectTagsInvalidError();
      }
      continue;
    }
    normalized.push(value);
  }
  return normalized;
}

function sameTags(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((tag, index) => tag === right[index])
  );
}

function normalizeCreationMode(mode: StoryCreationMode): StoryCreationMode {
  if (mode !== 'standard' && mode !== 'immersive') {
    throw new Error('Story creation mode is invalid');
  }
  return mode;
}

function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length < 1 || normalized.length > 200) {
    throw new StoryProjectTitleInvalidError();
  }
  return normalized;
}
