export type StoryArtifactContentFormat = 'markdown' | 'text' | 'json';
export type StoryArtifactVersionStatus = 'draft' | 'confirmed' | 'discarded';
export type StoryArtifactVersionSource = 'user' | 'agent' | 'import';

export interface StoryArtifactVersionSnapshot {
  id: string;
  tenantId: string | null;
  artifactId: string;
  versionNumber: number;
  content: string;
  contentFormat: StoryArtifactContentFormat;
  status: StoryArtifactVersionStatus;
  sourceType: StoryArtifactVersionSource;
  sourceMessageId: string | null;
  generationRequestId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}

export class StoryArtifactContentInvalidError extends Error {
  constructor() {
    super(
      'Story artifact content must contain between 1 and 5000000 characters',
    );
    this.name = 'StoryArtifactContentInvalidError';
  }
}

export class StoryArtifactVersionNumberInvalidError extends Error {
  constructor() {
    super('Story artifact version number must be a positive integer');
    this.name = 'StoryArtifactVersionNumberInvalidError';
  }
}

export class StoryArtifactVersionStatusInvalidError extends Error {
  constructor() {
    super('Story artifact version status is invalid');
    this.name = 'StoryArtifactVersionStatusInvalidError';
  }
}

export class StoryArtifactContentFormatInvalidError extends Error {
  constructor() {
    super('Story artifact content format is invalid');
    this.name = 'StoryArtifactContentFormatInvalidError';
  }
}

export class StoryArtifactVersionSourceInvalidError extends Error {
  constructor() {
    super('Story artifact version source is invalid');
    this.name = 'StoryArtifactVersionSourceInvalidError';
  }
}

export class StoryArtifactVersionStateTransitionError extends Error {
  constructor() {
    super('Story artifact version cannot perform this state transition');
    this.name = 'StoryArtifactVersionStateTransitionError';
  }
}

export class StoryArtifactVersion {
  private constructor(
    private readonly snapshot: StoryArtifactVersionSnapshot,
  ) {}

  static createDraft(input: {
    id: string;
    tenantId: string | null;
    artifactId: string;
    versionNumber: number;
    content: string;
    contentFormat: StoryArtifactContentFormat;
    sourceType: StoryArtifactVersionSource;
    sourceMessageId: string | null;
    generationRequestId: string | null;
    createdByUserId: string | null;
    createdAt: Date;
  }): StoryArtifactVersion {
    return new StoryArtifactVersion({
      id: input.id,
      tenantId: input.tenantId,
      artifactId: input.artifactId,
      versionNumber: normalizeVersionNumber(input.versionNumber),
      content: normalizeContent(input.content),
      contentFormat: normalizeContentFormat(input.contentFormat),
      status: 'draft',
      sourceType: normalizeSourceType(input.sourceType),
      sourceMessageId: input.sourceMessageId,
      generationRequestId: input.generationRequestId,
      createdByUserId: input.createdByUserId,
      createdAt: new Date(input.createdAt),
    });
  }

  static restore(snapshot: StoryArtifactVersionSnapshot): StoryArtifactVersion {
    return new StoryArtifactVersion({
      ...snapshot,
      versionNumber: normalizeVersionNumber(snapshot.versionNumber),
      content: normalizeContent(snapshot.content),
      contentFormat: normalizeContentFormat(snapshot.contentFormat),
      status: normalizeStatus(snapshot.status),
      sourceType: normalizeSourceType(snapshot.sourceType),
      createdAt: new Date(snapshot.createdAt),
    });
  }

  toSnapshot(): StoryArtifactVersionSnapshot {
    return {
      ...this.snapshot,
      createdAt: new Date(this.snapshot.createdAt),
    };
  }

  updateDraftContent(
    content: string,
    contentFormat: StoryArtifactContentFormat,
  ): boolean {
    this.assertDraft();
    this.snapshot.content = normalizeContent(content);
    this.snapshot.contentFormat = normalizeContentFormat(contentFormat);
    return true;
  }

  confirm(): boolean {
    if (this.snapshot.status === 'confirmed') return false;
    this.assertDraft();
    this.snapshot.status = 'confirmed';
    return true;
  }

  discard(): boolean {
    if (this.snapshot.status === 'discarded') return false;
    this.assertDraft();
    this.snapshot.status = 'discarded';
    return true;
  }

  private assertDraft(): void {
    if (this.snapshot.status !== 'draft') {
      throw new StoryArtifactVersionStateTransitionError();
    }
  }
}

function normalizeContent(content: string): string {
  const normalized = content.trim();
  if (normalized.length < 1 || normalized.length > 5_000_000) {
    throw new StoryArtifactContentInvalidError();
  }
  return normalized;
}

function normalizeVersionNumber(versionNumber: number): number {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new StoryArtifactVersionNumberInvalidError();
  }
  return versionNumber;
}

function normalizeContentFormat(
  contentFormat: StoryArtifactContentFormat,
): StoryArtifactContentFormat {
  if (
    contentFormat !== 'markdown' &&
    contentFormat !== 'text' &&
    contentFormat !== 'json'
  ) {
    throw new StoryArtifactContentFormatInvalidError();
  }
  return contentFormat;
}

function normalizeStatus(
  status: StoryArtifactVersionStatus,
): StoryArtifactVersionStatus {
  if (status !== 'draft' && status !== 'confirmed' && status !== 'discarded') {
    throw new StoryArtifactVersionStatusInvalidError();
  }
  return status;
}

function normalizeSourceType(
  sourceType: StoryArtifactVersionSource,
): StoryArtifactVersionSource {
  if (
    sourceType !== 'user' &&
    sourceType !== 'agent' &&
    sourceType !== 'import'
  ) {
    throw new StoryArtifactVersionSourceInvalidError();
  }
  return sourceType;
}
