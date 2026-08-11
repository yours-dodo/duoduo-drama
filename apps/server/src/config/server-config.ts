export const SERVER_CONFIG = Symbol('SERVER_CONFIG');
export const OBJECT_STORAGE_CONFIG = Symbol('OBJECT_STORAGE_CONFIG');

export type ServerEnvironment = 'development' | 'test' | 'production';

export interface ServerConfig {
  environment: ServerEnvironment;
  port: number;
  cookieSecret: string;
  trustedOrigins: string[];
  databaseUrl: string;
  publicWebUrl: string;
  loginTokenPepper: string;
  trustedProxyHops: number;
}

export interface ObjectStorageConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  presignedUrlTtlSeconds: number;
  forcePathStyle: boolean;
}

const DEFAULT_PORT = 3001;
const DEFAULT_COOKIE_SECRET = 'local-development-cookie-secret-change-me';
const DEFAULT_TRUSTED_ORIGINS = ['http://localhost:3000'];
const DEFAULT_PUBLIC_WEB_URL = 'http://localhost:3000';
const DEFAULT_LOGIN_TOKEN_PEPPER =
  'local-development-login-token-pepper-change-me';
const DEFAULT_OBJECT_STORAGE_ENDPOINT = 'http://127.0.0.1:9000';
const DEFAULT_OBJECT_STORAGE_REGION = 'us-east-1';
const DEFAULT_OBJECT_STORAGE_ACCESS_KEY = 'duoduo_server';
const DEFAULT_OBJECT_STORAGE_SECRET_KEY = 'change-me';
const DEFAULT_OBJECT_STORAGE_BUCKET = 'duoduo-assets';
const DEFAULT_OBJECT_STORAGE_TTL_SECONDS = 600;
const DEFAULT_OBJECT_STORAGE_FORCE_PATH_STYLE = true;
const PRODUCTION_COOKIE_SECRET_MIN_LENGTH = 32;
const LOGIN_TOKEN_PEPPER_MIN_LENGTH = 32;

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerConfigError';
  }
}

export function parseServerConfig(
  environment: NodeJS.ProcessEnv,
): ServerConfig {
  const runtimeEnvironment = parseEnvironment(environment.NODE_ENV);

  return {
    environment: runtimeEnvironment,
    port: parsePort(environment.PORT),
    cookieSecret: parseCookieSecret(
      environment.COOKIE_SECRET,
      runtimeEnvironment,
    ),
    trustedOrigins: parseTrustedOrigins(
      environment.TRUSTED_ORIGINS,
      runtimeEnvironment,
    ),
    databaseUrl: parseDatabaseUrl(environment.SERVER_DATABASE_URL),
    publicWebUrl: parsePublicWebUrl(
      environment.PUBLIC_WEB_URL,
      runtimeEnvironment,
    ),
    loginTokenPepper: parseLoginTokenPepper(
      environment.LOGIN_TOKEN_PEPPER,
      runtimeEnvironment,
    ),
    trustedProxyHops: parseTrustedProxyHops(environment.TRUST_PROXY_HOPS),
  };
}

export function parseObjectStorageConfig(
  environment: NodeJS.ProcessEnv,
): ObjectStorageConfig {
  const runtimeEnvironment = parseEnvironment(environment.NODE_ENV);

  return {
    endpoint: parseObjectStorageEndpoint(
      environment.SERVER_OBJECT_STORAGE_ENDPOINT,
      runtimeEnvironment,
    ),
    region: parseRequiredObjectStorageValue(
      environment.SERVER_OBJECT_STORAGE_REGION,
      DEFAULT_OBJECT_STORAGE_REGION,
      'SERVER_OBJECT_STORAGE_REGION',
      runtimeEnvironment,
    ),
    accessKey: parseRequiredObjectStorageValue(
      environment.SERVER_OBJECT_STORAGE_ACCESS_KEY,
      DEFAULT_OBJECT_STORAGE_ACCESS_KEY,
      'SERVER_OBJECT_STORAGE_ACCESS_KEY',
      runtimeEnvironment,
    ),
    secretKey: parseRequiredObjectStorageValue(
      environment.SERVER_OBJECT_STORAGE_SECRET_KEY,
      DEFAULT_OBJECT_STORAGE_SECRET_KEY,
      'SERVER_OBJECT_STORAGE_SECRET_KEY',
      runtimeEnvironment,
    ),
    bucket: parseBucketName(
      environment.SERVER_OBJECT_STORAGE_BUCKET,
      runtimeEnvironment,
    ),
    presignedUrlTtlSeconds: parseObjectStorageTtl(
      environment.SERVER_OBJECT_STORAGE_PRESIGNED_TTL_SECONDS,
    ),
    forcePathStyle: parseBoolean(
      environment.SERVER_OBJECT_STORAGE_FORCE_PATH_STYLE,
      DEFAULT_OBJECT_STORAGE_FORCE_PATH_STYLE,
      'SERVER_OBJECT_STORAGE_FORCE_PATH_STYLE',
    ),
  };
}

function parseObjectStorageEndpoint(
  value: string | undefined,
  environment: ServerEnvironment,
): string {
  const endpoint = value?.trim() || DEFAULT_OBJECT_STORAGE_ENDPOINT;
  if ((!value || value.trim() === '') && environment === 'production') {
    throw new ServerConfigError(
      'SERVER_OBJECT_STORAGE_ENDPOINT is required in production',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ServerConfigError(
      'SERVER_OBJECT_STORAGE_ENDPOINT must be a valid HTTP(S) URL',
    );
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new ServerConfigError(
      'SERVER_OBJECT_STORAGE_ENDPOINT must be a valid HTTP(S) URL',
    );
  }

  return parsed.origin;
}

function parseRequiredObjectStorageValue(
  value: string | undefined,
  fallback: string,
  name: string,
  environment: ServerEnvironment,
): string {
  if (value === undefined || value.trim() === '') {
    if (environment === 'production') {
      throw new ServerConfigError(`${name} is required in production`);
    }
    return fallback;
  }
  return value.trim();
}

function parseBucketName(
  value: string | undefined,
  environment: ServerEnvironment,
): string {
  const bucket = value?.trim() || DEFAULT_OBJECT_STORAGE_BUCKET;
  if ((!value || value.trim() === '') && environment === 'production') {
    throw new ServerConfigError(
      'SERVER_OBJECT_STORAGE_BUCKET is required in production',
    );
  }
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket.includes('..') ||
    bucket.includes('.-') ||
    bucket.includes('-.')
  ) {
    throw new ServerConfigError(
      'SERVER_OBJECT_STORAGE_BUCKET must be a valid bucket name',
    );
  }
  return bucket;
}

function parseObjectStorageTtl(value: string | undefined): number {
  if (value === undefined) return DEFAULT_OBJECT_STORAGE_TTL_SECONDS;
  if (!/^\d+$/.test(value)) {
    throw new ServerConfigError(
      'SERVER_OBJECT_STORAGE_PRESIGNED_TTL_SECONDS must be between 60 and 3600',
    );
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 3600) {
    throw new ServerConfigError(
      'SERVER_OBJECT_STORAGE_PRESIGNED_TTL_SECONDS must be between 60 and 3600',
    );
  }
  return seconds;
}

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ServerConfigError(`${name} must be true or false`);
}

function parseTrustedProxyHops(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (!/^\d+$/.test(value)) {
    throw invalidTrustedProxyHops();
  }

  const hops = Number(value);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 10) {
    throw invalidTrustedProxyHops();
  }

  return hops;
}

function invalidTrustedProxyHops(): ServerConfigError {
  return new ServerConfigError(
    'TRUST_PROXY_HOPS must be an integer between 0 and 10',
  );
}

function parsePublicWebUrl(
  value: string | undefined,
  environment: ServerEnvironment,
): string {
  if (value === undefined || value.trim() === '') {
    if (environment === 'production') {
      throw new ServerConfigError('PUBLIC_WEB_URL is required in production');
    }

    return DEFAULT_PUBLIC_WEB_URL;
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ServerConfigError(
      'PUBLIC_WEB_URL must be a valid HTTP(S) origin',
    );
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new ServerConfigError(
      'PUBLIC_WEB_URL must be a valid HTTP(S) origin',
    );
  }

  if (environment === 'production' && url.protocol !== 'https:') {
    throw new ServerConfigError('PUBLIC_WEB_URL must use HTTPS in production');
  }

  return url.origin;
}

function parseLoginTokenPepper(
  value: string | undefined,
  environment: ServerEnvironment,
): string {
  if (value === undefined) {
    if (environment === 'production') {
      throw new ServerConfigError(
        'LOGIN_TOKEN_PEPPER must contain at least 32 characters in production',
      );
    }

    return DEFAULT_LOGIN_TOKEN_PEPPER;
  }

  if (value.length < LOGIN_TOKEN_PEPPER_MIN_LENGTH) {
    throw new ServerConfigError(
      environment === 'production'
        ? 'LOGIN_TOKEN_PEPPER must contain at least 32 characters in production'
        : 'LOGIN_TOKEN_PEPPER must contain at least 32 characters',
    );
  }

  return value;
}

function parseDatabaseUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new ServerConfigError('SERVER_DATABASE_URL is required');
  }

  const databaseUrl = value.trim();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw invalidDatabaseUrl();
  }

  if (
    (parsedUrl.protocol !== 'postgresql:' &&
      parsedUrl.protocol !== 'postgres:') ||
    parsedUrl.hostname === '' ||
    parsedUrl.username === '' ||
    parsedUrl.pathname.length <= 1 ||
    parsedUrl.hash !== ''
  ) {
    throw invalidDatabaseUrl();
  }

  return databaseUrl;
}

function invalidDatabaseUrl(): ServerConfigError {
  return new ServerConfigError(
    'SERVER_DATABASE_URL must be a valid PostgreSQL database URL',
  );
}

function parseEnvironment(value: string | undefined): ServerEnvironment {
  const environment = value ?? 'development';

  if (
    environment !== 'development' &&
    environment !== 'test' &&
    environment !== 'production'
  ) {
    throw new ServerConfigError(
      'NODE_ENV must be one of: development, test, production',
    );
  }

  return environment;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  if (!/^\d+$/.test(value)) {
    throw new ServerConfigError('PORT must be an integer between 1 and 65535');
  }

  const port = Number(value);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new ServerConfigError('PORT must be an integer between 1 and 65535');
  }

  return port;
}

function parseCookieSecret(
  value: string | undefined,
  environment: ServerEnvironment,
): string {
  if (environment === 'production') {
    if (
      value === undefined ||
      value.length < PRODUCTION_COOKIE_SECRET_MIN_LENGTH
    ) {
      throw new ServerConfigError(
        'COOKIE_SECRET must contain at least 32 characters in production',
      );
    }

    return value;
  }

  return value ?? DEFAULT_COOKIE_SECRET;
}

function parseTrustedOrigins(
  value: string | undefined,
  environment: ServerEnvironment,
): string[] {
  if (value === undefined || value.trim() === '') {
    if (environment === 'production') {
      throw new ServerConfigError('TRUSTED_ORIGINS is required in production');
    }

    return [...DEFAULT_TRUSTED_ORIGINS];
  }

  return value.split(',').map((candidate) => parseOrigin(candidate.trim()));
}

function parseOrigin(candidate: string): string {
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new ServerConfigError(
      'TRUSTED_ORIGINS must contain valid HTTP(S) origins',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ServerConfigError(
      'TRUSTED_ORIGINS must contain valid HTTP(S) origins',
    );
  }

  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new ServerConfigError(
      'TRUSTED_ORIGINS must contain URL origins without paths',
    );
  }

  return url.origin;
}
