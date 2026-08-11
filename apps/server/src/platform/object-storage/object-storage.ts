export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectStorage {
  createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<{
    url: string;
    expiresAt: string;
    requiredHeaders: Readonly<Record<string, string>>;
  }>;

  headObject(objectKey: string): Promise<{
    contentType?: string;
    contentLength: number;
    etag?: string;
  }>;

  createDownloadUrl(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: string }>;

  deleteObject(objectKey: string): Promise<void>;
}

export class ObjectStorageObjectNotFoundError extends Error {
  constructor(objectKey: string) {
    super(`Object was not found: ${objectKey}`);
    this.name = 'ObjectStorageObjectNotFoundError';
  }
}

export class ObjectStorageUnavailableError extends Error {
  constructor(message = 'Object storage is unavailable') {
    super(message);
    this.name = 'ObjectStorageUnavailableError';
  }
}
