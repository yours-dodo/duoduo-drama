import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { lstatSync, type Stats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { constants, lstat, open } from 'node:fs/promises';
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
import { createAllowlistNetworkPolicy } from '../transport/network-policy.js';
import type { NetworkPolicy, TransportDriver } from '../transport/types.js';
import {
  builtinProviderKinds,
  builtinProviders,
  type BuiltinProvidersOptions,
} from '../providers/all/index.js';
import type {
  CliModelDefinition,
  CliWriter,
  NodeCliDependencies,
} from './runner.js';

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
  readonly providerOptions?: BuiltinProvidersOptions;
  readonly transport?: TransportDriver;
  readonly platform?: NodeJS.Platform;
  readonly projectDirectory?: string;
}

interface NodeCliConfig {
  readonly providers: BuiltinProvidersOptions;
  readonly defaultAccount?: string;
  readonly networkAllowlist: readonly string[];
}

export function resolveNodeCliPaths(
  environment: EnvironmentSource = processEnvironmentSource(),
  projectDirectory: string = process.cwd(),
): NodeCliPaths {
  const override = trim(environment.get('DUODUO_AI_HOME'));
  const stateDirectory = override
    ? resolveStateDirectoryOverride(override)
    : join(discoverProjectRoot(projectDirectory), '.duoduo-drama');
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
  const defaults = resolveNodeCliPaths(environment, options.projectDirectory);
  const paths = resolvePaths(defaults, options.paths);
  const config = await readConfig(paths.configFile, options.platform);
  const providerOptions = Object.freeze({
    ...config.providers,
    ...(options.providerOptions ?? {}),
  });
  const builtins = await builtinProviders(providerOptions);
  const keySource =
    options.masterKeySource ?? createEnvironmentMasterKeySource(environment);
  const activeKey = await keySource.active();
  const local = createLocalScopeAuthority({
    tenantId: 'local',
    subjectId: 'local-cli',
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
  const runtime = createAi<LocalScopeHandle>({
    ...createRuntimeAssemblyOptions(
      builtins.providers,
      config.networkAllowlist,
      options.transport,
    ),
    ...(credentialStore
      ? { credentialStore, scopeAuthority: local.authority }
      : {}),
  });
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
    ...(config.defaultAccount ? { defaultAccount: config.defaultAccount } : {}),
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

function discoverProjectRoot(projectDirectory: string): string {
  const start = resolve(projectDirectory);
  const metadata = readDiscoveryPath(
    start,
    'CLI project directory does not exist or cannot be inspected',
  );
  if (!metadata.isDirectory())
    throw new Error('CLI project directory must be a directory');

  let current = start;
  let nearestGitRoot: string | undefined;
  while (true) {
    if (hasDiscoveryMarker(current, 'pnpm-workspace.yaml')) return current;
    if (!nearestGitRoot && hasDiscoveryMarker(current, '.git'))
      nearestGitRoot = current;
    const parent = dirname(current);
    if (parent === current) return nearestGitRoot ?? start;
    current = parent;
  }
}

function resolveStateDirectoryOverride(override: string): string {
  const stateDirectory = resolve(override);
  let metadata: Stats;
  try {
    metadata = lstatSync(stateDirectory);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return stateDirectory;
    throw new Error('DUODUO_AI_HOME cannot be inspected', { cause: error });
  }
  if (!metadata.isDirectory())
    throw new Error('DUODUO_AI_HOME must identify a directory');
  return stateDirectory;
}

function hasDiscoveryMarker(directory: string, name: string): boolean {
  const path = join(directory, name);
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return false;
    throw new Error('CLI workspace marker cannot be inspected: ' + path, {
      cause: error,
    });
  }
}

function readDiscoveryPath(path: string, message: string): Stats {
  try {
    return lstatSync(path);
  } catch (error) {
    throw new Error(message, { cause: error });
  }
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

async function readConfig(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<NodeCliConfig> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return emptyConfig();
    throw error;
  }
  if (metadata.isSymbolicLink())
    throw new Error('CLI config file must not be a symbolic link');
  if (!metadata.isFile()) throw new Error('CLI config path must be a file');
  if (platform !== 'win32') {
    const getuid = process.getuid;
    if (getuid && metadata.uid !== getuid())
      throw new Error('CLI config file must be owned by the current user');
    if ((metadata.mode & 0o077) !== 0)
      throw new Error('CLI config file permissions must be 0600');
  }

  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text) > 1024 * 1024)
      throw new Error('CLI config file exceeds the 1 MiB limit');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error('CLI config file contains invalid JSON', {
        cause: error,
      });
    }
    return parseConfig(parsed);
  } finally {
    await handle.close();
  }
}

function parseConfig(parsed: unknown): NodeCliConfig {
  if (!isRecord(parsed)) throw new Error('CLI config must be an object');
  const supportedKeys = new Set([
    'schemaVersion',
    'providers',
    'defaultAccount',
    'networkAllowlist',
  ]);
  for (const key of Object.keys(parsed))
    if (!supportedKeys.has(key))
      throw new Error(`unsupported CLI config field: ${key}`);
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1)
    throw new Error('CLI config schemaVersion must be 1');

  const providers = parsed.providers ?? {};
  if (!isRecord(providers))
    throw new Error('CLI config providers must be an object');
  const kinds = new Set<string>(builtinProviderKinds);
  for (const [kind, providerOptions] of Object.entries(providers)) {
    if (!kinds.has(kind)) throw new Error(`unknown built-in provider: ${kind}`);
    if (!isRecord(providerOptions))
      throw new Error(`provider config must be an object: ${kind}`);
    rejectSecretFields(providerOptions, `providers.${kind}`);
  }
  const defaultAccount = optionalConfigString(
    parsed.defaultAccount,
    'defaultAccount',
  );
  const networkAllowlist = parseNetworkAllowlist(parsed.networkAllowlist);
  return Object.freeze({
    providers: Object.freeze({ ...providers }) as BuiltinProvidersOptions,
    ...(defaultAccount ? { defaultAccount } : {}),
    networkAllowlist,
  });
}

function emptyConfig(): NodeCliConfig {
  return Object.freeze({
    providers: Object.freeze({}),
    networkAllowlist: Object.freeze([]),
  });
}

function parseNetworkAllowlist(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value))
    throw new Error('CLI config networkAllowlist must be an array');
  return Object.freeze(
    value.map((entry, index) => {
      if (typeof entry !== 'string')
        throw new Error(
          `CLI config networkAllowlist[${index}] must be a string`,
        );
      return normalizeHttpsOrigin(entry);
    }),
  );
}

function optionalConfigString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string')
    throw new Error(`CLI config ${field} must be a string`);
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    [...normalized].some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x1f || code === 0x7f;
    })
  )
    throw new Error(`CLI config ${field} is invalid`);
  return normalized;
}

function normalizeHttpsOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`invalid HTTPS origin: ${value}`, { cause: error });
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(`invalid HTTPS origin: ${value}`);
  return url.origin;
}

function providerEndpointOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`invalid provider HTTPS endpoint: ${value}`, {
      cause: error,
    });
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error(`invalid provider HTTPS endpoint: ${value}`);
  return url.origin;
}

function createRuntimeAssemblyOptions(
  providers: readonly Provider[],
  configuredOrigins: readonly string[],
  transport: TransportDriver | undefined,
): Readonly<{
  transport?: TransportDriver;
  networkPolicy: NetworkPolicy;
  ambientAuthPolicy: Readonly<{
    allow(scope: LocalScopeHandle): boolean;
  }>;
  credentialOverridePolicy: Readonly<{
    allow(scope: LocalScopeHandle): boolean;
  }>;
}> {
  const origins = new Set(configuredOrigins);
  for (const provider of providers) {
    if (provider.chat?.transport?.endpoint)
      origins.add(providerEndpointOrigin(provider.chat.transport.endpoint));
    for (const protocol of provider.images?.protocols ?? [])
      origins.add(providerEndpointOrigin(protocol.endpoint));
    for (const protocol of provider.videos?.protocols ?? [])
      origins.add(providerEndpointOrigin(protocol.endpoint));
  }
  const allowLocalCli = (scope: LocalScopeHandle): boolean =>
    scope.tenantId === 'local' && scope.subjectId === 'local-cli';
  return Object.freeze({
    ...(transport ? { transport } : {}),
    networkPolicy: createAllowlistNetworkPolicy({ origins: [...origins] }),
    ambientAuthPolicy: Object.freeze({ allow: allowLocalCli }),
    credentialOverridePolicy: Object.freeze({ allow: allowLocalCli }),
  });
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
      /(?:secret|token|password|authorization|cookie|api[-_]?key|credential|private[-_]?key)/iu.test(
        key,
      )
    )
      throw new Error(
        `CLI config must not contain secret or credential field ${path}.${key}`,
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
