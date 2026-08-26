import { describe, expect, it } from 'vitest';

import {
  StoryArtifactContentInvalidError,
  StoryArtifactVersionStatusInvalidError,
  StoryArtifactVersion,
} from './story-artifact-version.js';

const CREATED_AT = new Date('2026-08-10T00:00:00.000Z');

describe('StoryArtifactVersion', () => {
  it('creates an immutable Agent draft version', () => {
    const version = StoryArtifactVersion.createDraft({
      id: 'version-id',
      tenantId: 'team-id',
      artifactId: 'artifact-id',
      versionNumber: 1,
      content: '  这是故事大纲。  ',
      contentFormat: 'markdown',
      sourceType: 'agent',
      sourceMessageId: 'agent-message-id',
      generationRequestId: 'generation-request-id',
      createdByUserId: null,
      createdAt: CREATED_AT,
    });

    expect(version.toSnapshot()).toEqual({
      id: 'version-id',
      tenantId: 'team-id',
      artifactId: 'artifact-id',
      versionNumber: 1,
      content: '这是故事大纲。',
      contentFormat: 'markdown',
      status: 'draft',
      sourceType: 'agent',
      sourceMessageId: 'agent-message-id',
      generationRequestId: 'generation-request-id',
      createdByUserId: null,
      createdAt: CREATED_AT,
    });
  });

  it('rejects empty or oversized content', () => {
    expect(() =>
      StoryArtifactVersion.createDraft({
        id: 'version-id',
        tenantId: 'team-id',
        artifactId: 'artifact-id',
        versionNumber: 1,
        content: '   ',
        contentFormat: 'text',
        sourceType: 'user',
        sourceMessageId: null,
        generationRequestId: null,
        createdByUserId: 'user-id',
        createdAt: CREATED_AT,
      }),
    ).toThrow(StoryArtifactContentInvalidError);

    expect(() =>
      StoryArtifactVersion.createDraft({
        id: 'version-id',
        tenantId: 'team-id',
        artifactId: 'artifact-id',
        versionNumber: 1,
        content: 'a'.repeat(5_000_001),
        contentFormat: 'text',
        sourceType: 'user',
        sourceMessageId: null,
        generationRequestId: null,
        createdByUserId: 'user-id',
        createdAt: CREATED_AT,
      }),
    ).toThrow(StoryArtifactContentInvalidError);
  });

  it('rejects unknown persisted status or content format', () => {
    expect(() =>
      StoryArtifactVersion.restore({
        id: 'version-id',
        tenantId: 'team-id',
        artifactId: 'artifact-id',
        versionNumber: 1,
        content: '故事正文',
        contentFormat: 'html' as never,
        status: 'draft',
        sourceType: 'agent',
        sourceMessageId: null,
        generationRequestId: null,
        createdByUserId: null,
        createdAt: CREATED_AT,
      }),
    ).toThrow();

    expect(() =>
      StoryArtifactVersion.restore({
        id: 'version-id',
        tenantId: 'team-id',
        artifactId: 'artifact-id',
        versionNumber: 1,
        content: '故事正文',
        contentFormat: 'text',
        status: 'published' as never,
        sourceType: 'agent',
        sourceMessageId: null,
        generationRequestId: null,
        createdByUserId: null,
        createdAt: CREATED_AT,
      }),
    ).toThrow(StoryArtifactVersionStatusInvalidError);
  });

  it('updates a draft in place for debounced structured-editor saves', () => {
    const version = StoryArtifactVersion.createDraft({
      id: 'version-id',
      tenantId: null,
      artifactId: 'artifact-id',
      versionNumber: 1,
      content: '{"schemaVersion":"narrative-planning.v1"}',
      contentFormat: 'json',
      sourceType: 'user',
      sourceMessageId: null,
      generationRequestId: null,
      createdByUserId: 'user-id',
      createdAt: CREATED_AT,
    });

    expect(
      version.updateDraftContent(
        ' {"schemaVersion":"narrative-planning.v1","v":2} ',
        'json',
      ),
    ).toBe(true);
    expect(version.toSnapshot()).toMatchObject({
      id: 'version-id',
      versionNumber: 1,
      content: '{"schemaVersion":"narrative-planning.v1","v":2}',
      contentFormat: 'json',
      status: 'draft',
    });
  });
});
