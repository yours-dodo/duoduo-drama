import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import { SESSION_COOKIE_NAME } from './session-auth.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';

const CONFIG = {
  environment: 'test',
  port: 3001,
  cookieSecret: 'local-test-cookie-secret-change-me',
  trustedOrigins: ['https://app.example.com'],
  databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
  publicWebUrl: 'https://app.example.com',
  loginTokenPepper: 'local-test-login-token-pepper-change-me',
  trustedProxyHops: 0,
} satisfies ServerConfig;

describe('TrustedOriginGuard', () => {
  const guard = new TrustedOriginGuard(CONFIG);

  it.each(['GET', 'HEAD', 'OPTIONS'])('allows safe %s requests', (method) => {
    expect(
      guard.canActivate(
        contextFor({
          method,
          cookies: { [SESSION_COOKIE_NAME]: 'session-token' },
        }),
      ),
    ).toBe(true);
  });

  it('allows public writes that do not carry the session Cookie', () => {
    expect(
      guard.canActivate(
        contextFor({ method: 'POST', cookies: {}, headers: {} }),
      ),
    ).toBe(true);
  });

  it('allows a Cookie-authenticated write from an exact trusted Origin', () => {
    expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          cookies: { [SESSION_COOKIE_NAME]: 'session-token' },
          headers: { origin: 'https://app.example.com' },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    undefined,
    'https://evil.example.com',
    'https://app.example.com.evil.test',
  ])('rejects an untrusted Cookie-authenticated write Origin: %s', (origin) => {
    expect(() =>
      guard.canActivate(
        contextFor({
          method: 'DELETE',
          cookies: { [SESSION_COOKIE_NAME]: 'session-token' },
          headers: { origin },
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'UNTRUSTED_ORIGIN',
        statusCode: 403,
      }),
    );
  });
});

function contextFor(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}
