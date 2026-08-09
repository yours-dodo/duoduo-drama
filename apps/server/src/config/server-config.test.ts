import { describe, expect, it } from 'vitest';

import { parseServerConfig } from './server-config.js';

const TEST_DATABASE_URL =
  'postgresql://duoduo_server:local@127.0.0.1:5432/duoduo_server';
const TEST_DATABASE_ENVIRONMENT = { SERVER_DATABASE_URL: TEST_DATABASE_URL };

describe('parseServerConfig', () => {
  it('provides safe local-development defaults', () => {
    expect(parseServerConfig(TEST_DATABASE_ENVIRONMENT)).toEqual({
      environment: 'development',
      port: 3001,
      cookieSecret: 'local-development-cookie-secret-change-me',
      trustedOrigins: ['http://localhost:3000'],
      databaseUrl: TEST_DATABASE_URL,
    });
  });

  it('parses explicit production configuration', () => {
    expect(
      parseServerConfig({
        NODE_ENV: 'production',
        PORT: '4100',
        COOKIE_SECRET: 'a-production-cookie-secret-with-32-chars',
        TRUSTED_ORIGINS: 'https://app.example.com, https://admin.example.com',
        SERVER_DATABASE_URL:
          'postgresql://duoduo_server:production@db.example.com:5432/duoduo_server',
      }),
    ).toEqual({
      environment: 'production',
      port: 4100,
      cookieSecret: 'a-production-cookie-secret-with-32-chars',
      trustedOrigins: ['https://app.example.com', 'https://admin.example.com'],
      databaseUrl:
        'postgresql://duoduo_server:production@db.example.com:5432/duoduo_server',
    });
  });

  it('requires the dedicated Server database URL', () => {
    expect(() => parseServerConfig({})).toThrow(
      'SERVER_DATABASE_URL is required',
    );
  });

  it.each([
    'not-a-url',
    'mysql://duoduo_server:local@127.0.0.1:3306/duoduo_server',
    'postgresql://duoduo_server:local@127.0.0.1:5432/',
  ])('rejects an invalid Server database URL: %s', (databaseUrl) => {
    expect(() =>
      parseServerConfig({ SERVER_DATABASE_URL: databaseUrl }),
    ).toThrow('SERVER_DATABASE_URL must be a valid PostgreSQL database URL');
  });

  it.each(['0', '65536', '3001.5', 'not-a-port'])(
    'rejects an invalid port: %s',
    (port) => {
      expect(() =>
        parseServerConfig({ ...TEST_DATABASE_ENVIRONMENT, PORT: port }),
      ).toThrow('PORT must be an integer between 1 and 65535');
    },
  );

  it('rejects an unsupported environment', () => {
    expect(() =>
      parseServerConfig({
        ...TEST_DATABASE_ENVIRONMENT,
        NODE_ENV: 'staging',
      }),
    ).toThrow('NODE_ENV must be one of: development, test, production');
  });

  it.each([undefined, 'too-short'])(
    'requires a strong cookie secret in production',
    (cookieSecret) => {
      expect(() =>
        parseServerConfig({
          ...TEST_DATABASE_ENVIRONMENT,
          NODE_ENV: 'production',
          COOKIE_SECRET: cookieSecret,
          TRUSTED_ORIGINS: 'https://app.example.com',
        }),
      ).toThrow(
        'COOKIE_SECRET must contain at least 32 characters in production',
      );
    },
  );

  it('requires trusted origins in production', () => {
    expect(() =>
      parseServerConfig({
        ...TEST_DATABASE_ENVIRONMENT,
        NODE_ENV: 'production',
        COOKIE_SECRET: 'a-production-cookie-secret-with-32-chars',
      }),
    ).toThrow('TRUSTED_ORIGINS is required in production');
  });

  it('rejects malformed trusted origins', () => {
    expect(() =>
      parseServerConfig({
        ...TEST_DATABASE_ENVIRONMENT,
        TRUSTED_ORIGINS: 'http://localhost:3000,not-a-url',
      }),
    ).toThrow('TRUSTED_ORIGINS must contain valid HTTP(S) origins');
  });

  it('rejects trusted origins containing a path', () => {
    expect(() =>
      parseServerConfig({
        ...TEST_DATABASE_ENVIRONMENT,
        TRUSTED_ORIGINS: 'https://app.example.com/dashboard',
      }),
    ).toThrow('TRUSTED_ORIGINS must contain URL origins without paths');
  });
});
