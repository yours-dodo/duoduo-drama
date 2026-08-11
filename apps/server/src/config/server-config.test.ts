import { describe, expect, it } from 'vitest';

import {
  parseObjectStorageConfig,
  parseServerConfig,
} from './server-config.js';

const TEST_DATABASE_URL =
  'postgresql://duoduo_server:local@127.0.0.1:5432/duoduo_server';
const TEST_DATABASE_ENVIRONMENT = { SERVER_DATABASE_URL: TEST_DATABASE_URL };
const PRODUCTION_OBJECT_STORAGE_ENVIRONMENT = {
  ...TEST_DATABASE_ENVIRONMENT,
  NODE_ENV: 'production',
  SERVER_OBJECT_STORAGE_ENDPOINT: 'https://s3.example.com',
  SERVER_OBJECT_STORAGE_REGION: 'us-east-1',
  SERVER_OBJECT_STORAGE_ACCESS_KEY: 'server-access',
  SERVER_OBJECT_STORAGE_SECRET_KEY: 'server-secret',
  SERVER_OBJECT_STORAGE_BUCKET: 'duoduo-assets-prod',
};

describe('parseServerConfig', () => {
  it('provides safe local-development defaults', () => {
    expect(parseServerConfig(TEST_DATABASE_ENVIRONMENT)).toEqual({
      environment: 'development',
      port: 3001,
      cookieSecret: 'local-development-cookie-secret-change-me',
      trustedOrigins: ['http://localhost:3000'],
      databaseUrl: TEST_DATABASE_URL,
      publicWebUrl: 'http://localhost:3000',
      loginTokenPepper: 'local-development-login-token-pepper-change-me',
      trustedProxyHops: 0,
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
        PUBLIC_WEB_URL: 'https://app.example.com',
        LOGIN_TOKEN_PEPPER: 'a-production-login-token-pepper-32-chars',
        TRUST_PROXY_HOPS: '1',
      }),
    ).toEqual({
      environment: 'production',
      port: 4100,
      cookieSecret: 'a-production-cookie-secret-with-32-chars',
      trustedOrigins: ['https://app.example.com', 'https://admin.example.com'],
      databaseUrl:
        'postgresql://duoduo_server:production@db.example.com:5432/duoduo_server',
      publicWebUrl: 'https://app.example.com',
      loginTokenPepper: 'a-production-login-token-pepper-32-chars',
      trustedProxyHops: 1,
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

  it.each([undefined, 'too-short'])(
    'requires a strong login token pepper in production',
    (loginTokenPepper) => {
      expect(() =>
        parseServerConfig({
          ...TEST_DATABASE_ENVIRONMENT,
          NODE_ENV: 'production',
          COOKIE_SECRET: 'a-production-cookie-secret-with-32-chars',
          TRUSTED_ORIGINS: 'https://app.example.com',
          PUBLIC_WEB_URL: 'https://app.example.com',
          LOGIN_TOKEN_PEPPER: loginTokenPepper,
        }),
      ).toThrow(
        'LOGIN_TOKEN_PEPPER must contain at least 32 characters in production',
      );
    },
  );

  it('requires a public Web URL in production', () => {
    expect(() =>
      parseServerConfig({
        ...TEST_DATABASE_ENVIRONMENT,
        NODE_ENV: 'production',
        COOKIE_SECRET: 'a-production-cookie-secret-with-32-chars',
        TRUSTED_ORIGINS: 'https://app.example.com',
        LOGIN_TOKEN_PEPPER: 'a-production-login-token-pepper-32-chars',
      }),
    ).toThrow('PUBLIC_WEB_URL is required in production');
  });

  it('requires HTTPS for the production public Web URL', () => {
    expect(() =>
      parseServerConfig({
        ...TEST_DATABASE_ENVIRONMENT,
        NODE_ENV: 'production',
        COOKIE_SECRET: 'a-production-cookie-secret-with-32-chars',
        TRUSTED_ORIGINS: 'https://app.example.com',
        LOGIN_TOKEN_PEPPER: 'a-production-login-token-pepper-32-chars',
        PUBLIC_WEB_URL: 'http://app.example.com',
      }),
    ).toThrow('PUBLIC_WEB_URL must use HTTPS in production');
  });

  it.each(['-1', '1.5', '11', 'many'])(
    'rejects an invalid trusted proxy hop count: %s',
    (trustedProxyHops) => {
      expect(() =>
        parseServerConfig({
          ...TEST_DATABASE_ENVIRONMENT,
          TRUST_PROXY_HOPS: trustedProxyHops,
        }),
      ).toThrow('TRUST_PROXY_HOPS must be an integer between 0 and 10');
    },
  );

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

describe('parseObjectStorageConfig', () => {
  it('provides local MinIO defaults', () => {
    expect(parseObjectStorageConfig(TEST_DATABASE_ENVIRONMENT)).toEqual({
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      accessKey: 'duoduo_server',
      secretKey: 'change-me',
      bucket: 'duoduo-assets',
      presignedUrlTtlSeconds: 600,
      forcePathStyle: true,
    });
  });

  it('parses explicit object storage configuration', () => {
    expect(
      parseObjectStorageConfig({
        ...TEST_DATABASE_ENVIRONMENT,
        SERVER_OBJECT_STORAGE_ENDPOINT: 'https://s3.example.com/',
        SERVER_OBJECT_STORAGE_REGION: 'cn-shanghai',
        SERVER_OBJECT_STORAGE_ACCESS_KEY: 'server-access',
        SERVER_OBJECT_STORAGE_SECRET_KEY: 'server-secret',
        SERVER_OBJECT_STORAGE_BUCKET: 'duoduo-assets-prod',
        SERVER_OBJECT_STORAGE_PRESIGNED_TTL_SECONDS: '1800',
        SERVER_OBJECT_STORAGE_FORCE_PATH_STYLE: 'false',
      }),
    ).toEqual({
      endpoint: 'https://s3.example.com',
      region: 'cn-shanghai',
      accessKey: 'server-access',
      secretKey: 'server-secret',
      bucket: 'duoduo-assets-prod',
      presignedUrlTtlSeconds: 1800,
      forcePathStyle: false,
    });
  });

  it.each([
    ['SERVER_OBJECT_STORAGE_ENDPOINT', 'not-a-url'],
    ['SERVER_OBJECT_STORAGE_ENDPOINT', 'https://s3.example.com/path'],
    ['SERVER_OBJECT_STORAGE_BUCKET', 'Invalid_Bucket'],
    ['SERVER_OBJECT_STORAGE_PRESIGNED_TTL_SECONDS', '59'],
    ['SERVER_OBJECT_STORAGE_PRESIGNED_TTL_SECONDS', '3601'],
    ['SERVER_OBJECT_STORAGE_FORCE_PATH_STYLE', 'yes'],
  ])('rejects invalid object storage configuration: %s=%s', (name, value) => {
    expect(() =>
      parseObjectStorageConfig({
        ...TEST_DATABASE_ENVIRONMENT,
        [name]: value,
      }),
    ).toThrow();
  });

  it.each([
    'SERVER_OBJECT_STORAGE_ENDPOINT',
    'SERVER_OBJECT_STORAGE_REGION',
    'SERVER_OBJECT_STORAGE_ACCESS_KEY',
    'SERVER_OBJECT_STORAGE_SECRET_KEY',
    'SERVER_OBJECT_STORAGE_BUCKET',
  ])('requires %s in production', (name) => {
    expect(() =>
      parseObjectStorageConfig({
        ...PRODUCTION_OBJECT_STORAGE_ENVIRONMENT,
        [name]: ' ',
      }),
    ).toThrow(`${name} is required in production`);
  });
});
