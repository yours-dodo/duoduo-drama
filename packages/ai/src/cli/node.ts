import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

import type { EnvironmentSource } from '../auth/ambient.js';
import type {
  CredentialCodec,
  CredentialOpenResult,
  CredentialSealResult,
} from '../auth/record-sealer.js';
import { createCredentialRecordSealer } from '../auth/record-sealer.js';
import {
  revealSecret,
  secret,
  type SecretValue,
} from '../auth/secret-value.js';
import { createFileCredentialStore } from '../auth/node/file-store.js';
import {
  createLocalScopeAuthority,
  type LocalScopeHandle,
} from '../auth/node/local-scope.js';
import type { AuthInteraction } from '../auth/login.js';
import { createAi } from '../runtime/create-ai.js';
import type { Provider } from '../runtime/registry.js';
import {
  builtinProviders,
  type BuiltinProvidersOptions,
} from '../providers/all/index.js';
import type {
  CliModelDefinition,
  CliWriter,
  NodeCliDependencies,
} from './runner.js';
import { createFileCatalogStore } from './file-catalog-store.js';

export interface NodeCliPaths {
  readonly stateDirectory: string;
  readonly configFile: string;
  readonly credentialDirectory: string;
  readonly catalogDirectory: string;
}

export interface CredentialMasterKeySource {
  readonly identityLifetime: 'cross-runtime';
  active(
    signal?: AbortSignal,
  ): Promise<
    | { status: 'available'; keyId: string; key: SecretValue }
    | { status: 'unavailable'; retryable: boolean }
  >;
  byId(
    keyId: string,
    signal?: AbortSignal,
  ): Promise<
    | { status: 'available'; key: SecretValue }
    | { status: 'unavailable'; retryable: boolean }
  >;
}

export interface CreateNodeCliOptions {
  readonly paths?: Partial<NodeCliPaths>;
  readonly masterKeySource?: CredentialMasterKeySource;
  readonly environment?: EnvironmentSource;
  readonly clock?: { now(): number };
  readonly interaction?: AuthInteraction;
  readonly stdout?: CliWriter;
  readonly stderr?: CliWriter;
}

interface NodeCliConfig {
  readonly providers?: BuiltinProvidersOptions;
  readonly credentialSlotId?: string;
}

export function resolveNodeCliPaths(
  environment: EnvironmentSource = processEnvironmentSource(),
): NodeCliPaths {
  const override = trim(environment.get('DUODUO_AI_HOME'));
  const stateDirectory = override
    ? resolve(override)
    : defaultStateDirectory(environment);
  return Object.freeze({
    stateDirectory,
    configFile: join(stateDirectory, 'config.json'),
    credentialDirectory: join(stateDirectory, 'credentials'),
    catalogDirectory: join(stateDirectory, 'catalogs'),
  });
}

export function createEnvironmentMasterKeySource(
  environment: EnvironmentSource = processEnvironmentSource(),
): CredentialMasterKeySource {
  const read = ():
    | { status: 'available'; keyId: string; key: SecretValue }
    | { status: 'unavailable'; retryable: boolean } => {
    const encoded = trim(environment.get('DUODUO_AI_MASTER_KEY'));
    if (!encoded) return { status: 'unavailable', retryable: false };
    const key = decodeMasterKey(encoded);
    const keyId = `env-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    return {
      status: 'available',
      keyId,
      key: secret(key.toString('base64url')),
    };
  };
  return Object.freeze({
    identityLifetime: 'cross-runtime' as const,
    active: async (signal?: AbortSignal) => {
      throwIfAborted(signal);
      return read();
    },
    byId: async (keyId: string, signal?: AbortSignal) => {
      throwIfAborted(signal);
      const active = read();
      return active.status === 'available' && active.keyId === keyId
        ? { status: 'available' as const, key: active.key }
        : { status: 'unavailable' as const, retryable: false };
    },
  });
}

export function createAeadCredentialCodec(options: {
  readonly keySource: CredentialMasterKeySource;
  readonly algorithm?: 'AES-256-GCM';
}): CredentialCodec {
  if (options.algorithm && options.algorithm !== 'AES-256-GCM')
    throw new TypeError('unsupported credential codec algorithm');
  const codec: CredentialCodec = {
    seal: async (plaintext, aad, signal): Promise<CredentialSealResult> => {
      const active = await options.keySource.active(signal);
      if (active.status === 'unavailable')
        return { status: 'key_unavailable', retryable: active.retryable };
      const key = materializeKey(active.key);
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(aad));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      return Object.freeze({
        status: 'sealed' as const,
        envelope: Object.freeze({
          version: 1,
          keyId: active.keyId,
          ciphertext: Buffer.concat([
            nonce,
            cipher.getAuthTag(),
            ciphertext,
          ]).toString('base64url'),
        }),
      });
    },
    open: async (envelope, aad, signal): Promise<CredentialOpenResult> => {
      if (envelope.version !== 1) return { status: 'invalid' };
      const resolved = await options.keySource.byId(envelope.keyId, signal);
      if (resolved.status === 'unavailable')
        return { status: 'key_unavailable', retryable: resolved.retryable };
      try {
        const payload = Buffer.from(envelope.ciphertext, 'base64url');
        if (payload.byteLength < 29) return { status: 'invalid' };
        const decipher = createDecipheriv(
          'aes-256-gcm',
          materializeKey(resolved.key),
          payload.subarray(0, 12),
        );
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(payload.subarray(12, 28));
        return Object.freeze({
          status: 'opened' as const,
          plaintext: Buffer.concat([
            decipher.update(payload.subarray(28)),
            decipher.final(),
          ]),
        });
      } catch {
        return { status: 'invalid' };
      }
    },
  };
  return Object.freeze(codec);
}

export async function createNodeCliDependencies(
  options: CreateNodeCliOptions = {},
): Promise<NodeCliDependencies<LocalScopeHandle>> {
  const environment = options.environment ?? processEnvironmentSource();
  const defaults = resolveNodeCliPaths(environment);
  const paths = resolvePaths(defaults, options.paths);
  const config = await readConfig(paths.configFile);
  const keySource =
    options.masterKeySource ?? createEnvironmentMasterKeySource(environment);
  const activeKey = await keySource.active();
  const local = createLocalScopeAuthority({
    tenantId: 'local',
    subjectId: 'local-cli',
    ...(config.credentialSlotId
      ? { credentialSlotId: config.credentialSlotId }
      : {}),
    ...(activeKey.status === 'available'
      ? {
          activeKeyId: activeKey.keyId,
          keys: { [activeKey.keyId]: materializeKey(activeKey.key) },
          fingerprintLifetime: 'cross-runtime' as const,
        }
      : {}),
  });
  const credentialStore =
    activeKey.status === 'available'
      ? createFileCredentialStore({
          directory: paths.credentialDirectory,
          sealer: createCredentialRecordSealer({
            codec: createAeadCredentialCodec({ keySource }),
            storeNamespace: '@duoduo/ai/cli',
          }),
          fileNameKey: deriveKey(
            materializeKey(activeKey.key),
            'credential-filename',
          ),
          ...(options.clock ? { clock: options.clock } : {}),
        })
      : undefined;
  // Construct the public catalog store during assembly so path and permission
  // policy are validated independently from encrypted credential persistence.
  createFileCatalogStore({
    directory: paths.catalogDirectory,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  const runtime = createAi<LocalScopeHandle>({
    ...(credentialStore
      ? { credentialStore, scopeAuthority: local.authority }
      : {}),
  });
  const builtins = await builtinProviders(config.providers ?? {});
  runtime.providers.registerAll(builtins.providers);
  return Object.freeze({
    runtime,
    scope: local.scope,
    interaction: options.interaction ?? createTerminalAuthInteraction(),
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
    inventory: collectProviderInventory(builtins.providers),
    unconfigured: builtins.unconfigured,
    credentialKeyAvailable: activeKey.status === 'available',
  });
}

export function collectProviderInventory(
  providers: readonly Provider[],
): readonly CliModelDefinition[] {
  return Object.freeze(
    providers.flatMap((provider): CliModelDefinition[] => [
      ...(provider.chat?.models ?? []).map((definition) => ({
        capability: 'chat' as const,
        definition,
      })),
      ...(provider.images?.models ?? []).map((definition) => ({
        capability: 'images' as const,
        definition,
      })),
      ...(provider.videos?.models ?? []).map((definition) => ({
        capability: 'videos' as const,
        definition,
      })),
    ]),
  );
}

function defaultStateDirectory(environment: EnvironmentSource): string {
  if (process.platform === 'win32') {
    const localAppData = trim(environment.get('LOCALAPPDATA'));
    if (!localAppData)
      throw new Error('LOCALAPPDATA is required to resolve CLI state path');
    return join(localAppData, 'duoduo-ai');
  }
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'duoduo-ai');
  return join(
    trim(environment.get('XDG_STATE_HOME')) ??
      join(homedir(), '.local', 'state'),
    'duoduo-ai',
  );
}

function resolvePaths(
  defaults: NodeCliPaths,
  overrides: Partial<NodeCliPaths> | undefined,
): NodeCliPaths {
  const stateDirectory = resolve(
    overrides?.stateDirectory ?? defaults.stateDirectory,
  );
  return Object.freeze({
    stateDirectory,
    configFile: resolve(
      overrides?.configFile ?? join(stateDirectory, 'config.json'),
    ),
    credentialDirectory: resolve(
      overrides?.credentialDirectory ?? join(stateDirectory, 'credentials'),
    ),
    catalogDirectory: resolve(
      overrides?.catalogDirectory ?? join(stateDirectory, 'catalogs'),
    ),
  });
}

async function readConfig(path: string): Promise<NodeCliConfig> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!isRecord(parsed)) throw new Error('CLI config must be an object');
    rejectSecretFields(parsed, 'config');
    const providers = parsed.providers;
    if (providers !== undefined && !isRecord(providers))
      throw new Error('CLI config providers must be an object');
    const credentialSlotId = parsed.credentialSlotId;
    if (
      credentialSlotId !== undefined &&
      (typeof credentialSlotId !== 'string' || credentialSlotId.length === 0)
    )
      throw new Error('CLI credentialSlotId must be a non-empty string');
    return Object.freeze({
      ...(providers ? { providers: providers as BuiltinProvidersOptions } : {}),
      ...(typeof credentialSlotId === 'string' ? { credentialSlotId } : {}),
    });
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return Object.freeze({});
    throw error;
  }
}

function rejectSecretFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      rejectSecretFields(item, `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (
      /(?:secret|token|password|authorization|cookie|api[-_]?key|credential)/iu.test(
        key,
      )
    )
      throw new Error(
        `CLI config must not contain secret field ${path}.${key}`,
      );
    rejectSecretFields(item, `${path}.${key}`);
  }
}

function createTerminalAuthInteraction(): AuthInteraction {
  return Object.freeze({
    openBrowser: async () => 'unavailable' as const,
    prompt: async (prompt: import('../auth/oauth.js').AuthPrompt) =>
      terminalQuestion(`${prompt.message}: `),
    promptSecret: async ({
      label,
    }: {
      providerInstanceId: string;
      method: 'api_key';
      label: string;
    }) => secret(await terminalQuestion(`${label}: `)),
    notify: async (
      message: Parameters<NonNullable<AuthInteraction['notify']>>[0],
    ) => {
      process.stderr.write(`${JSON.stringify(message)}\n`);
    },
  });
}

async function terminalQuestion(message: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error('interactive authentication requires a TTY');
  const terminal = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    return await terminal.question(message);
  } finally {
    terminal.close();
  }
}

function processEnvironmentSource(): EnvironmentSource {
  return Object.freeze({ get: (name: string) => process.env[name] });
}

function decodeMasterKey(value: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(value, 'base64url');
  } catch {
    throw new Error('DUODUO_AI_MASTER_KEY must be base64url');
  }
  if (key.byteLength !== 32)
    throw new Error('DUODUO_AI_MASTER_KEY must encode exactly 32 bytes');
  return key;
}

function materializeKey(value: SecretValue): Buffer {
  return decodeMasterKey(revealSecret(value));
}

function deriveKey(key: Uint8Array, label: string): Buffer {
  return createHash('sha256')
    .update('@duoduo/ai/cli-key-v1\0')
    .update(label)
    .update(key)
    .digest();
}

function trim(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
