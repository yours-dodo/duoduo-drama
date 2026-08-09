import type { CookieOptions } from 'express';

import type { ServerConfig } from '../../../config/server-config.js';

export function buildSessionCookieOptions(
  config: ServerConfig,
  expires?: Date,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.environment === 'production',
    path: '/',
    ...(expires === undefined ? {} : { expires }),
  };
}
