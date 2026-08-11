import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';

import {
  OBJECT_STORAGE_CONFIG,
  type ObjectStorageConfig,
} from '../../../config/server-config.js';
import {
  ObjectStorageObjectNotFoundError,
  ObjectStorageUnavailableError,
  type ObjectStorage,
} from '../object-storage.js';

@Injectable()
export class S3ObjectStorage implements ObjectStorage, OnModuleDestroy {
  private readonly client: S3Client;

  constructor(
    @Inject(OBJECT_STORAGE_CONFIG) private readonly config: ObjectStorageConfig,
  ) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });
  }

  async createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<{
    url: string;
    expiresAt: string;
    requiredHeaders: Readonly<Record<string, string>>;
  }> {
    const expiresAt = new Date(
      Date.now() + input.expiresInSeconds * 1000,
    ).toISOString();
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });

    try {
      return {
        url: await getSignedUrl(this.client, command, {
          expiresIn: input.expiresInSeconds,
        }),
        expiresAt,
        requiredHeaders: { 'content-type': input.contentType },
      };
    } catch (error) {
      throw new ObjectStorageUnavailableError(readErrorMessage(error));
    }
  }

  async headObject(objectKey: string): Promise<{
    contentType?: string;
    contentLength: number;
    etag?: string;
  }> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
        }),
      );
      if (result.ContentLength === undefined) {
        throw new ObjectStorageUnavailableError(
          'Object storage did not return an object size',
        );
      }
      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        etag: result.ETag,
      };
    } catch (error) {
      if (isNotFound(error)) {
        throw new ObjectStorageObjectNotFoundError(objectKey);
      }
      if (error instanceof ObjectStorageUnavailableError) {
        throw error;
      }
      throw new ObjectStorageUnavailableError(readErrorMessage(error));
    }
  }

  async createDownloadUrl(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: string }> {
    const expiresAt = new Date(
      Date.now() + input.expiresInSeconds * 1000,
    ).toISOString();
    try {
      return {
        url: await getSignedUrl(
          this.client,
          new GetObjectCommand({
            Bucket: this.config.bucket,
            Key: input.objectKey,
          }),
          { expiresIn: input.expiresInSeconds },
        ),
        expiresAt,
      };
    } catch (error) {
      throw new ObjectStorageUnavailableError(readErrorMessage(error));
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
        }),
      );
    } catch (error) {
      throw new ObjectStorageUnavailableError(readErrorMessage(error));
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.destroy();
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unknown object storage error';
}
