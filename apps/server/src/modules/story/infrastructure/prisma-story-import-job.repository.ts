import { Inject, Injectable } from '@nestjs/common';

import type {
  StoryImportContentType,
  StoryImportJobSnapshot,
  StoryImportJobStatus,
} from '../../../domain/story/story-import-job.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { StoryImportJobRepository } from '../ports/story-import-job-repository.js';

interface StoryImportJobRow {
  id: string;
  tenantId: string | null;
  projectId: string;
  createdByUserId: string;
  sourceFileName: string;
  sourceContentType: string;
  sourceByteSize: number;
  status: string;
  failureCode: string | null;
  processingStartedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PrismaStoryImportJobRepository implements StoryImportJobRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(job: StoryImportJobSnapshot): Promise<StoryImportJobSnapshot> {
    return this.database.withClient(async (client) => {
      const row = await client.storyImportJob.create({ data: job });
      return readImportJob(row);
    });
  }

  findById(request: {
    tenantId: string | null;
    jobId: string;
  }): Promise<StoryImportJobSnapshot | null> {
    return this.database.withClient(async (client) => {
      const row = await client.storyImportJob.findFirst({
        where: { tenantId: request.tenantId, id: request.jobId },
      });
      return row === null ? null : readImportJob(row);
    });
  }
}

function readImportJob(row: StoryImportJobRow): StoryImportJobSnapshot {
  if (!isStoryImportContentType(row.sourceContentType)) {
    throw new Error('Database returned an invalid story import content type');
  }
  if (!isStoryImportStatus(row.status)) {
    throw new Error('Database returned an invalid story import status');
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    createdByUserId: row.createdByUserId,
    sourceFileName: row.sourceFileName,
    sourceContentType: row.sourceContentType,
    sourceByteSize: Number(row.sourceByteSize),
    status: row.status,
    failureCode: row.failureCode,
    processingStartedAt:
      row.processingStartedAt === null
        ? null
        : new Date(row.processingStartedAt),
    completedAt: row.completedAt === null ? null : new Date(row.completedAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function isStoryImportContentType(
  value: string,
): value is StoryImportContentType {
  return (
    value === 'text/plain' ||
    value === 'text/markdown' ||
    value === 'application/pdf' ||
    value === 'application/msword' ||
    value ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    value === 'application/octet-stream'
  );
}

function isStoryImportStatus(value: string): value is StoryImportJobStatus {
  return (
    value === 'pending' ||
    value === 'processing' ||
    value === 'succeeded' ||
    value === 'failed'
  );
}
