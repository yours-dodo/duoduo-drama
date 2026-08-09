import { describe, expect, it } from 'vitest';

import { LocalEmailDelivery } from './local-email-delivery.js';

describe('LocalEmailDelivery', () => {
  it('exposes the latest login token only in the test environment', async () => {
    const delivery = new LocalEmailDelivery('test', 'https://app.example.com');
    const expiresAt = new Date('2026-08-09T10:10:00.000Z');

    await delivery.deliver({
      email: 'writer@example.com',
      token: 'raw-login-token',
      expiresAt,
    });

    expect(delivery.readLatestForTest()).toEqual({
      email: 'writer@example.com',
      token: 'raw-login-token',
      magicLink:
        'https://app.example.com/auth/email-login?token=raw-login-token',
      expiresAt,
    });
  });

  it('refuses token inspection outside tests', async () => {
    const delivery = new LocalEmailDelivery(
      'development',
      'http://localhost:3000',
    );
    await delivery.deliver({
      email: 'writer@example.com',
      token: 'raw-login-token',
      expiresAt: new Date('2026-08-09T10:10:00.000Z'),
    });

    expect(() => delivery.readLatestForTest()).toThrow(
      'Local email inspection is available only in tests',
    );
  });

  it('cannot be configured as a production delivery adapter', () => {
    expect(
      () => new LocalEmailDelivery('production', 'https://app.example.com'),
    ).toThrow('Local email delivery cannot run in production');
  });
});
