import { describe, expect, it } from 'vitest';

import {
  StoryArtifactVersion,
  StoryArtifactVersionStateTransitionError,
} from './story-artifact-version.js';

const NOW = new Date('2026-08-10T04:00:00.000Z');

describe('StoryArtifactVersion lifecycle', () => {
  it('confirms a draft without changing its immutable content', () => {
    const version = StoryArtifactVersion.createDraft({
      id: 'version-id',
      tenantId: 'team-id',
      artifactId: 'artifact-id',
      versionNumber: 1,
      content: '故事大纲',
      contentFormat: 'text',
      sourceType: 'agent',
      sourceMessageId: 'message-id',
      generationRequestId: 'generation-id',
      createdByUserId: null,
      createdAt: NOW,
    });

    expect(version.confirm()).toBe(true);
    expect(version.toSnapshot()).toMatchObject({
      content: '故事大纲',
      status: 'confirmed',
      sourceType: 'agent',
    });
    expect(version.confirm()).toBe(false);
  });

  it('discards a draft and rejects lifecycle changes after confirmation', () => {
    const version = StoryArtifactVersion.createDraft({
      id: 'version-id',
      tenantId: 'team-id',
      artifactId: 'artifact-id',
      versionNumber: 1,
      content: '故事大纲',
      contentFormat: 'markdown',
      sourceType: 'user',
      sourceMessageId: null,
      generationRequestId: null,
      createdByUserId: 'user-id',
      createdAt: NOW,
    });

    expect(version.discard()).toBe(true);
    expect(version.discard()).toBe(false);
    expect(() => version.confirm()).toThrow(
      StoryArtifactVersionStateTransitionError,
    );

    const confirmed = StoryArtifactVersion.createDraft({
      id: 'confirmed-version-id',
      tenantId: 'team-id',
      artifactId: 'artifact-id',
      versionNumber: 2,
      content: '第二版故事大纲',
      contentFormat: 'markdown',
      sourceType: 'user',
      sourceMessageId: null,
      generationRequestId: null,
      createdByUserId: 'user-id',
      createdAt: NOW,
    });
    confirmed.confirm();
    expect(() => confirmed.discard()).toThrow(
      StoryArtifactVersionStateTransitionError,
    );
  });
});
