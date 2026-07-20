import { AiRuntimeError } from '../core/errors.js';
import type { ModelDefinition } from '../core/models.js';
import type { ImageModelDefinition } from '../images/models.js';
import type { VideoModelDefinition } from '../videos/models.js';
import type { AiRuntime } from '../runtime/create-ai.js';
import type { AuthInteraction } from '../auth/login.js';
import type { BuiltinProviderKind } from '../providers/all/index.js';

export interface CliWriter {
  write(text: string): void;
}

export type CliModelDefinition =
  | Readonly<{ capability: 'chat'; definition: Readonly<ModelDefinition> }>
  | Readonly<{
      capability: 'images';
      definition: Readonly<ImageModelDefinition>;
    }>
  | Readonly<{
      capability: 'videos';
      definition: Readonly<VideoModelDefinition>;
    }>;

export interface NodeCliDependencies<TScopeHandle = unknown> {
  readonly runtime: AiRuntime<TScopeHandle>;
  readonly scope: TScopeHandle;
  readonly interaction: AuthInteraction;
  readonly stdout: CliWriter;
  readonly stderr: CliWriter;
  readonly inventory: readonly CliModelDefinition[];
  readonly unconfigured: readonly Readonly<{
    kind: BuiltinProviderKind;
    missingOptions: readonly string[];
  }>[];
  readonly credentialKeyAvailable: boolean;
  readonly defaultAccount?: string;
}

export const CLI_SKIPPED_EXIT_CODE = 3;
export const CLI_USAGE_EXIT_CODE = 64;
export const CLI_UNAVAILABLE_EXIT_CODE = 69;
export const CLI_EXIT_CREDENTIAL_KEY_UNAVAILABLE = CLI_UNAVAILABLE_EXIT_CODE;

export async function runCli<TScopeHandle>(
  argv: readonly string[],
  dependencies: NodeCliDependencies<TScopeHandle>,
): Promise<number> {
  const json = argv.includes('--json');
  try {
    const explicitAccount = readOption(argv, '--account');
    const account = explicitAccount ?? dependencies.defaultAccount;
    const scopedDependencies = account
      ? Object.freeze({
          ...dependencies,
          scope: scopeForAccount(dependencies.scope, account),
        })
      : dependencies;
    const args = removeOption(
      argv.filter((argument) => argument !== '--json'),
      '--account',
    );
    switch (args[0]) {
      case 'providers':
        return providersCommand(scopedDependencies, json);
      case 'models':
        return await modelsCommand(args.slice(1), scopedDependencies, json);
      case 'auth':
        return await authCommand(args.slice(1), scopedDependencies, json);
      case 'diagnose':
        return await diagnoseCommand(args.slice(1), scopedDependencies, json);
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        writeResult(dependencies.stdout, json, {
          usage:
            'duoduo-ai <providers|models|auth|diagnose> [arguments] [--json]',
        });
        return 0;
      default:
        return usageError(dependencies, json, `unknown command: ${args[0]}`);
    }
  } catch (error) {
    const safe = safeError(error);
    writeResult(dependencies.stderr, json, { error: safe });
    return safe.code === 'CREDENTIAL_CODEC_KEY_UNAVAILABLE'
      ? CLI_UNAVAILABLE_EXIT_CODE
      : 1;
  }
}

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--'))
    throw new AiRuntimeError(
      'CLI_USAGE',
      'invalid_request',
      `${name} requires a non-empty value`,
    );
  return value;
}

function removeOption(
  args: readonly string[],
  name: string,
): readonly string[] {
  const index = args.indexOf(name);
  if (index < 0) return args;
  return Object.freeze([...args.slice(0, index), ...args.slice(index + 2)]);
}

function scopeForAccount<TScopeHandle>(
  scope: TScopeHandle,
  account: string,
): TScopeHandle {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope))
    throw new AiRuntimeError(
      'CLI_USAGE',
      'invalid_request',
      '--account requires an object-shaped credential scope',
    );
  return Object.freeze({
    ...(scope as Readonly<Record<string, unknown>>),
    credentialSlotId: account,
  }) as TScopeHandle;
}

function providersCommand<TScopeHandle>(
  dependencies: NodeCliDependencies<TScopeHandle>,
  json: boolean,
): number {
  const registered = new Map(
    dependencies.runtime.providers
      .list()
      .map((provider) => [provider.kind, provider]),
  );
  const unconfigured = new Map(
    dependencies.unconfigured.map((entry) => [entry.kind, entry]),
  );
  const kinds = new Set<BuiltinProviderKind>([
    ...registered.keys(),
    ...unconfigured.keys(),
  ] as BuiltinProviderKind[]);
  const providers = [...kinds].sort().map((kind) => {
    const active = registered.get(kind);
    const missing = unconfigured.get(kind);
    return {
      kind,
      status: active ? 'registered' : 'unconfigured',
      ...(active ? { id: active.id, name: active.name } : {}),
      ...(missing ? { missingOptions: missing.missingOptions } : {}),
    };
  });
  writeResult(dependencies.stdout, json, { providers });
  return 0;
}

async function modelsCommand<TScopeHandle>(
  args: readonly string[],
  dependencies: NodeCliDependencies<TScopeHandle>,
  json: boolean,
): Promise<number> {
  if (args[0] === 'refresh')
    return refreshModels(args.slice(1), dependencies, json);
  const provider = args.find((argument) => !argument.startsWith('--'));
  const available = args.includes('--available');
  const rows = available
    ? await availableModels(provider, dependencies)
    : dependencies.inventory
        .filter(
          (entry) =>
            !provider || entry.definition.providerInstanceId === provider,
        )
        .map((entry) => modelRow(entry, 'unknown'));
  writeResult(dependencies.stdout, json, {
    mode: available ? 'available' : 'inventory',
    models: rows,
  });
  return 0;
}

async function refreshModels<TScopeHandle>(
  args: readonly string[],
  dependencies: NodeCliDependencies<TScopeHandle>,
  json: boolean,
): Promise<number> {
  requireCredentialKey(dependencies);
  const provider = args.find((argument) => !argument.startsWith('--'));
  const providers = provider
    ? [provider]
    : dependencies.runtime.providers.list().map((item) => item.id);
  const refreshed: string[] = [];
  const unavailable: Array<{ provider: string; code: string }> = [];
  for (const providerInstanceId of providers) {
    try {
      await dependencies.runtime.models.list(
        dependencies.scope,
        { providerInstanceId },
        { allowNetwork: true, force: true },
      );
      await dependencies.runtime.images.models.list(dependencies.scope, {
        providerInstanceId,
      });
      await dependencies.runtime.videos.models.list(dependencies.scope, {
        providerInstanceId,
      });
      refreshed.push(providerInstanceId);
    } catch (error) {
      unavailable.push({
        provider: providerInstanceId,
        code: safeError(error).code,
      });
    }
  }
  writeResult(dependencies.stdout, json, { refreshed, unavailable });
  return unavailable.length === providers.length && providers.length > 0
    ? CLI_UNAVAILABLE_EXIT_CODE
    : 0;
}

async function availableModels<TScopeHandle>(
  provider: string | undefined,
  dependencies: NodeCliDependencies<TScopeHandle>,
): Promise<readonly Record<string, unknown>[]> {
  requireCredentialKey(dependencies);
  const providers = provider
    ? [provider]
    : dependencies.runtime.providers.list().map((item) => item.id);
  const rows: Record<string, unknown>[] = [];
  for (const providerInstanceId of providers) {
    for (const capability of ['chat', 'images', 'videos'] as const) {
      try {
        const handles =
          capability === 'chat'
            ? (
                await dependencies.runtime.models.list(dependencies.scope, {
                  providerInstanceId,
                })
              ).models
            : capability === 'images'
              ? (
                  await dependencies.runtime.images.models.list(
                    dependencies.scope,
                    { providerInstanceId },
                  )
                ).models
              : (
                  await dependencies.runtime.videos.models.list(
                    dependencies.scope,
                    { providerInstanceId },
                  )
                ).models;
        rows.push(
          ...handles.map((handle) => ({
            capability,
            providerInstanceId: handle.definition.providerInstanceId,
            modelId: handle.definition.id,
            protocol: handle.definition.protocol,
            availability: 'available',
          })),
        );
      } catch {
        // Availability is intentionally omitted when authentication is absent.
      }
    }
  }
  return Object.freeze(rows);
}

async function authCommand<TScopeHandle>(
  args: readonly string[],
  dependencies: NodeCliDependencies<TScopeHandle>,
  json: boolean,
): Promise<number> {
  requireCredentialKey(dependencies);
  const action = args[0];
  const provider = args[1];
  if (action === 'status') {
    const requested = provider
      ? [provider]
      : dependencies.runtime.providers.list().map((item) => item.id);
    const statuses = [];
    for (const providerInstanceId of requested) {
      statuses.push({
        provider: providerInstanceId,
        ...(await dependencies.runtime.auth.status(
          providerInstanceId,
          dependencies.scope,
        )),
      });
    }
    writeResult(dependencies.stdout, json, { statuses });
    return 0;
  }
  if (!provider)
    return usageError(
      dependencies,
      json,
      `auth ${action ?? '<action>'} requires a provider`,
    );
  if (action === 'login') {
    const method = optionValue(args, '--method');
    if (
      method !== 'api_key' &&
      method !== 'oauth' &&
      method !== 'ambient_config'
    )
      return usageError(
        dependencies,
        json,
        'auth login requires --method api_key|oauth|ambient_config',
      );
    const status = await dependencies.runtime.auth.login(
      provider,
      method,
      dependencies.scope,
      dependencies.interaction,
    );
    writeResult(dependencies.stdout, json, { provider, ...status });
    return 0;
  }
  if (action === 'logout') {
    const result = await dependencies.runtime.auth.logout(
      provider,
      dependencies.scope,
      { revokeRemote: args.includes('--revoke-remote') },
    );
    writeResult(dependencies.stdout, json, { provider, ...result });
    return 0;
  }
  return usageError(
    dependencies,
    json,
    `unknown auth action: ${action ?? '<missing>'}`,
  );
}

async function diagnoseCommand<TScopeHandle>(
  args: readonly string[],
  dependencies: NodeCliDependencies<TScopeHandle>,
  json: boolean,
): Promise<number> {
  const provider = args[0];
  const model = args[1];
  if (!provider || !model)
    return usageError(
      dependencies,
      json,
      'diagnose requires <provider> <model>',
    );
  const snapshot = dependencies.runtime.providers
    .list()
    .find((candidate) => candidate.id === provider);
  const inventory = dependencies.inventory.filter(
    (entry) =>
      entry.definition.providerInstanceId === provider &&
      entry.definition.id === model,
  );
  const auth = dependencies.credentialKeyAvailable
    ? await dependencies.runtime.auth.status(provider, dependencies.scope)
    : { status: 'unavailable', code: 'CREDENTIAL_CODEC_KEY_UNAVAILABLE' };
  writeResult(dependencies.stdout, json, {
    provider: snapshot
      ? { id: snapshot.id, kind: snapshot.kind, registered: true }
      : { id: provider, registered: false },
    model: inventory.map((entry) => ({ capability: entry.capability })),
    auth,
  });
  return snapshot && inventory.length > 0 ? 0 : CLI_UNAVAILABLE_EXIT_CODE;
}

function modelRow(
  entry: CliModelDefinition,
  availability: 'unknown' | 'available',
): Record<string, unknown> {
  return {
    capability: entry.capability,
    providerInstanceId: entry.definition.providerInstanceId,
    modelId: entry.definition.id,
    protocol: entry.definition.protocol,
    availability,
  };
}

function requireCredentialKey<TScopeHandle>(
  dependencies: NodeCliDependencies<TScopeHandle>,
): void {
  if (!dependencies.credentialKeyAvailable)
    throw new AiRuntimeError(
      'CREDENTIAL_CODEC_KEY_UNAVAILABLE',
      'auth',
      'credential encryption key is unavailable',
    );
}

function optionValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usageError<TScopeHandle>(
  dependencies: NodeCliDependencies<TScopeHandle>,
  json: boolean,
  message: string,
): number {
  writeResult(dependencies.stderr, json, {
    error: { code: 'CLI_USAGE', message },
  });
  return CLI_USAGE_EXIT_CODE;
}

function writeResult(
  writer: CliWriter,
  json: boolean,
  value: Readonly<Record<string, unknown>>,
): void {
  const safe = redactCliValue(value);
  writer.write(
    json
      ? `${JSON.stringify(safe)}\n`
      : `${formatText(safe as Readonly<Record<string, unknown>>)}\n`,
  );
}

export function redactCliValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCliValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSecretField(key) ? '[REDACTED]' : redactCliValue(item),
      ]),
    );
  if (typeof value === 'string') return redactString(value);
  return value;
}

function isSecretField(name: string): boolean {
  if (
    /^(?:input|output|cached|cacheRead|cacheWrite|reasoning|total)Tokens$/i.test(
      name,
    )
  )
    return false;
  return /(?:secret|token|password|authorization|cookie|api[-_]?key|credential)/i.test(
    name,
  );
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:sk|key|token)[-_][A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(
      /([?&](?:key|token|signature|credential)=)[^&\s]+/gi,
      '$1[REDACTED]',
    );
}

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof AiRuntimeError)
    return { code: error.code, message: redactString(error.message) };
  if (error instanceof Error)
    return { code: 'CLI_FAILED', message: redactString(error.message) };
  return { code: 'CLI_FAILED', message: 'unknown CLI failure' };
}

function formatText(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(value, null, 2);
}
