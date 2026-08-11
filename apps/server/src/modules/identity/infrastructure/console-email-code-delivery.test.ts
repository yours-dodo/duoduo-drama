import { describe, expect, it } from 'vitest';

import { ConsoleEmailCodeDelivery } from './console-email-code-delivery.js';

describe('ConsoleEmailCodeDelivery', () => {
  it('keeps the latest code inspectable only in tests', async () => {
    const delivery = new ConsoleEmailCodeDelivery('test');
    const expiresAt = new Date('2026-08-11T10:10:00.000Z');

    await delivery.deliver({
      email: 'writer@example.com',
      code: '012345',
      purpose: 'login',
      expiresAt,
    });

    expect(delivery.readLatestForTest()).toEqual({
      email: 'writer@example.com',
      code: '012345',
      purpose: 'login',
      expiresAt,
    });
  });

  it('refuses to run in production', () => {
    expect(() => new ConsoleEmailCodeDelivery('production')).toThrow(
      'Console email code delivery cannot run in production',
    );
  });
});
