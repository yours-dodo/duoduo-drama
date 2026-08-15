export const MAX_STORY_IMPORT_BYTES = 20 * 1024 * 1024;

export const STORY_IMPORT_CONTENT_TYPES = [
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream',
] as const;

export type StoryImportContentType =
  (typeof STORY_IMPORT_CONTENT_TYPES)[number];
export type StoryImportJobStatus =
  'pending' | 'processing' | 'succeeded' | 'failed';

export interface StoryImportJobSnapshot {
  id: string;
  tenantId: string | null;
  projectId: string;
  createdByUserId: string;
  sourceFileName: string;
  sourceContentType: StoryImportContentType;
  sourceByteSize: number;
  status: StoryImportJobStatus;
  failureCode: string | null;
  processingStartedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class StoryImportFileInvalidError extends Error {
  constructor(message = 'Story import file metadata is invalid') {
    super(message);
    this.name = 'StoryImportFileInvalidError';
  }
}

export class StoryImportJob {
  private constructor(private readonly snapshot: StoryImportJobSnapshot) {}

  static create(input: {
    id: string;
    tenantId: string | null;
    projectId: string;
    createdByUserId: string;
    sourceFileName: string;
    sourceContentType: string;
    sourceByteSize: number;
    createdAt: Date;
  }): StoryImportJob {
    return new StoryImportJob({
      id: input.id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      createdByUserId: input.createdByUserId,
      sourceFileName: normalizeFileName(input.sourceFileName),
      sourceContentType: normalizeContentType(input.sourceContentType),
      sourceByteSize: normalizeByteSize(input.sourceByteSize),
      status: 'pending',
      failureCode: null,
      processingStartedAt: null,
      completedAt: null,
      createdAt: new Date(input.createdAt),
      updatedAt: new Date(input.createdAt),
    });
  }

  static restore(snapshot: StoryImportJobSnapshot): StoryImportJob {
    return new StoryImportJob({
      ...snapshot,
      sourceFileName: normalizeFileName(snapshot.sourceFileName),
      sourceContentType: normalizeContentType(snapshot.sourceContentType),
      sourceByteSize: normalizeByteSize(snapshot.sourceByteSize),
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
      processingStartedAt:
        snapshot.processingStartedAt === null
          ? null
          : new Date(snapshot.processingStartedAt),
      completedAt:
        snapshot.completedAt === null ? null : new Date(snapshot.completedAt),
    });
  }

  toSnapshot(): StoryImportJobSnapshot {
    return {
      ...this.snapshot,
      createdAt: new Date(this.snapshot.createdAt),
      updatedAt: new Date(this.snapshot.updatedAt),
      processingStartedAt:
        this.snapshot.processingStartedAt === null
          ? null
          : new Date(this.snapshot.processingStartedAt),
      completedAt:
        this.snapshot.completedAt === null
          ? null
          : new Date(this.snapshot.completedAt),
    };
  }
}

function normalizeFileName(value: string): string {
  const fileName = value.trim();
  if (
    fileName.length < 1 ||
    fileName.length > 255 ||
    [...fileName].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  ) {
    throw new StoryImportFileInvalidError('Story import file name is invalid');
  }
  return fileName;
}

function normalizeContentType(value: string): StoryImportContentType {
  const contentType = value.trim() || 'application/octet-stream';
  if (
    !STORY_IMPORT_CONTENT_TYPES.includes(contentType as StoryImportContentType)
  ) {
    throw new StoryImportFileInvalidError(
      'Story import content type is not supported',
    );
  }
  return contentType as StoryImportContentType;
}

function normalizeByteSize(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_STORY_IMPORT_BYTES
  ) {
    throw new StoryImportFileInvalidError(
      `Story import file must be between 1 byte and ${MAX_STORY_IMPORT_BYTES} bytes`,
    );
  }
  return value;
}
