import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import type { ObjectStorageConfig } from '../../../config/server-config.js';
import {
  ObjectStorageObjectNotFoundError,
  ObjectStorageUnavailableError,
} from '../object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

const CONFIG: ObjectStorageConfig = {
  endpoint: 'http://minio.test',
  region: 'us-east-1',
  accessKey: 'access',
  secretKey: 'secret',
  bucket: 'duoduo-assets',
  presignedUrlTtlSeconds: 600,
  forcePathStyle: true,
};

describe('S3ObjectStorage', () => {
  it('creates a presigned upload URL with required content headers', async () => {
    const storage = new S3ObjectStorage(CONFIG);

    const result = await storage.createUploadUrl({
      objectKey: 'tenants/team-1/assets/asset-1/original',
      contentType: 'image/png',
      contentLength: 2048,
      expiresInSeconds: 600,
    });

    expect(result.url).toContain('minio.test');
    expect(result.url).toContain('X-Amz-Signature');
    expect(result.requiredHeaders).toEqual({ 'content-type': 'image/png' });
    expect(Number.isNaN(Date.parse(result.expiresAt))).toBe(false);
  });

  it('maps object metadata from HEAD and uses the configured bucket', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValueOnce({
      ContentLength: 2048,
      ContentType: 'image/png',
      ETag: '"etag"',
    } as never);
    const storage = new S3ObjectStorage(CONFIG);

    await expect(
      storage.headObject('tenants/team-1/assets/asset-1/original'),
    ).resolves.toEqual({
      contentLength: 2048,
      contentType: 'image/png',
      etag: '"etag"',
    });
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      input: {
        Bucket: 'duoduo-assets',
        Key: 'tenants/team-1/assets/asset-1/original',
      },
    });
    send.mockRestore();
  });

  it('maps a missing HEAD object to a domain storage error', async () => {
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockRejectedValueOnce(
        Object.assign(new Error('missing'), { name: 'NotFound' }),
      );
    const storage = new S3ObjectStorage(CONFIG);

    await expect(storage.headObject('missing')).rejects.toBeInstanceOf(
      ObjectStorageObjectNotFoundError,
    );
    send.mockRestore();
  });

  it('maps unexpected S3 errors to an unavailable error', async () => {
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockRejectedValueOnce(new Error('connection refused'));
    const storage = new S3ObjectStorage(CONFIG);

    await expect(storage.deleteObject('asset-key')).rejects.toEqual(
      new ObjectStorageUnavailableError('connection refused'),
    );
    send.mockRestore();
  });

  it('creates a presigned download URL', async () => {
    const storage = new S3ObjectStorage(CONFIG);

    await expect(
      storage.createDownloadUrl({
        objectKey: 'tenants/team-1/assets/asset-1/original',
        expiresInSeconds: 600,
      }),
    ).resolves.toMatchObject({
      url: expect.stringContaining('X-Amz-Signature'),
    });
  });
});
