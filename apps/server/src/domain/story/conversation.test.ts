import { describe, expect, it } from 'vitest';

import {
  Conversation,
  ConversationArchivedError,
  ConversationRevisionConflictError,
} from './conversation.js';

const NOW = new Date('2026-08-10T03:00:00.000Z');

describe('Conversation', () => {
  it('creates with a normalized title and first revision', () => {
    expect(
      Conversation.create({
        id: 'conversation-id',
        tenantId: 'team-id',
        projectId: 'project-id',
        title: '  第一轮构思  ',
        createdAt: NOW,
      }).toSnapshot(),
    ).toMatchObject({
      id: 'conversation-id',
      tenantId: 'team-id',
      projectId: 'project-id',
      title: '第一轮构思',
      status: 'active',
      revision: 1,
    });
  });

  it('renames with optimistic concurrency and archives independently', () => {
    const conversation = Conversation.create({
      id: 'conversation-id',
      tenantId: 'team-id',
      projectId: 'project-id',
      title: '第一轮构思',
      createdAt: NOW,
    });

    expect(conversation.rename('人物关系', 1, NOW)).toBe(true);
    expect(conversation.archive(2, NOW)).toBe(true);
    expect(conversation.toSnapshot()).toMatchObject({
      title: '人物关系',
      status: 'archived',
      revision: 3,
    });
  });

  it('rejects stale edits and changes after archive', () => {
    const conversation = Conversation.create({
      id: 'conversation-id',
      tenantId: 'team-id',
      projectId: 'project-id',
      title: '第一轮构思',
      createdAt: NOW,
    });

    expect(() => conversation.rename('冲突', 2, NOW)).toThrow(
      ConversationRevisionConflictError,
    );
    conversation.archive(1, NOW);
    expect(() => conversation.rename('不应生效', 2, NOW)).toThrow(
      ConversationArchivedError,
    );
  });
});
