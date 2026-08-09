import { describe, expect, it } from 'vitest';

import { Message, MessageBodyInvalidError } from './message.js';

const NOW = new Date('2026-08-10T03:00:00.000Z');

describe('Message', () => {
  it('creates an immutable user message snapshot', () => {
    const message = Message.create({
      id: 'message-id',
      tenantId: 'team-id',
      conversationId: 'conversation-id',
      authorType: 'user',
      authorUserId: 'user-id',
      body: '  请先梳理人物关系  ',
      createdAt: NOW,
    });

    const first = message.toSnapshot();
    expect(first).toMatchObject({
      id: 'message-id',
      tenantId: 'team-id',
      conversationId: 'conversation-id',
      authorType: 'user',
      authorUserId: 'user-id',
      body: '请先梳理人物关系',
    });
    first.body = '修改后的历史消息';
    expect(message.toSnapshot().body).toBe('请先梳理人物关系');
  });

  it('rejects an empty or oversized message body', () => {
    expect(() =>
      Message.create({
        id: 'message-id',
        tenantId: 'team-id',
        conversationId: 'conversation-id',
        authorType: 'user',
        authorUserId: 'user-id',
        body: '   ',
        createdAt: NOW,
      }),
    ).toThrow(MessageBodyInvalidError);

    expect(() =>
      Message.create({
        id: 'message-id',
        tenantId: 'team-id',
        conversationId: 'conversation-id',
        authorType: 'user',
        authorUserId: 'user-id',
        body: 'a'.repeat(50_001),
        createdAt: NOW,
      }),
    ).toThrow(MessageBodyInvalidError);
  });
});
