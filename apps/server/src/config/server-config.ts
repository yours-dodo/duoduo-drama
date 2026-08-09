export const SERVER_CONFIG = Symbol('SERVER_CONFIG');

export type ServerEnvironment = 'development' | 'test' | 'production';

export interface ServerConfig {
  environment: ServerEnvironment;
  port: number;
  cookieSecret: string;
  trustedOrigins: string[];
  databaseUrl: string;
}

const DEFAULT_PORT = 3001;
const DEFAULT_COOKIE_SECRET = 'local-development-cookie-secret-change-me';
const DEFAULT_TRUSTED_ORIGINS = ['http://localhost:3000'];
const PRODUCTION_COOKIE_SECRET_MIN_LENGTH = 32;

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
  };
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
