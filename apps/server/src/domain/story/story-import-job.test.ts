import { describe, expect, it } from 'vitest';

import {
  MAX_STORY_IMPORT_BYTES,
  StoryImportFileInvalidError,
  StoryImportJob,
} from './story-import-job.js';

const NOW = new Date('2026-08-15T05:00:00.000Z');

describe('StoryImportJob', () => {
  it('creates a pending import job from normalized file metadata', () => {
    expect(
      StoryImportJob.create({
        id: 'import-id',
        tenantId: null,
        projectId: 'project-id',
        createdByUserId: 'user-id',
        sourceFileName: '  旧故事.md  ',
        sourceContentType: '',
        sourceByteSize: 1024,
        createdAt: NOW,
      }).toSnapshot(),
    ).toMatchObject({
      sourceFileName: '旧故事.md',
      sourceContentType: 'application/octet-stream',
      sourceByteSize: 1024,
      status: 'pending',
      failureCode: null,
    });
  });

  it('rejects unsupported or oversized files', () => {
    expect(() =>
      StoryImportJob.create({
        id: 'import-id',
        tenantId: null,
        projectId: 'project-id',
        createdByUserId: 'user-id',
        sourceFileName: 'story.exe',
        sourceContentType: 'application/x-msdownload',
        sourceByteSize: 1,
        createdAt: NOW,
      }),
    ).toThrow(StoryImportFileInvalidError);

    expect(() =>
      StoryImportJob.create({
        id: 'import-id',
        tenantId: null,
        projectId: 'project-id',
        createdByUserId: 'user-id',
        sourceFileName: 'story.pdf',
        sourceContentType: 'application/pdf',
        sourceByteSize: MAX_STORY_IMPORT_BYTES + 1,
        createdAt: NOW,
      }),
    ).toThrow(StoryImportFileInvalidError);
  });
});
