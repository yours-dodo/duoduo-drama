import { describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import { buildSessionCookieOptions } from './session-cookie.js';

describe('buildSessionCookieOptions', () => {
  it('uses HttpOnly, SameSite=Lax and Secure in production', () => {
    const expires = new Date('2026-09-08T00:00:00.000Z');

    expect(buildSessionCookieOptions(configFor('production'), expires)).toEqual(
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        expires,
      },
    );
  });

  it('allows local HTTP only outside production', () => {
    expect(buildSessionCookieOptions(configFor('test'))).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    });
  });
});

function configFor(environment: ServerConfig['environment']): ServerConfig {
  return {
    environment,
    port: 3001,
    cookieSecret: 'test-cookie-secret-with-at-least-32-chars',
    trustedOrigins: ['https://app.example.com'],
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
    publicWebUrl: 'https://app.example.com',
    loginTokenPepper: 'test-login-token-pepper-with-32-chars',
    trustedProxyHops: 0,
  };
}
