import { createHash } from 'node:crypto';

export interface SafeRemoteCatalogModel {
  readonly id: string;
  readonly name?: string;
  readonly capabilities?: readonly string[];
  readonly limits?: Readonly<Record<string, number>>;
  readonly pricing?: Readonly<Record<string, number>>;
  readonly region?: string;
  readonly deprecated?: boolean;
}

export interface SafeRemoteCatalogShard {
  readonly providerKind: string;
  readonly models: readonly SafeRemoteCatalogModel[];
  readonly sourceDigest?: string;
}

export interface GeneratedBuiltinCatalog {
  readonly schemaVersion: 1;
  readonly providers: readonly Readonly<{
    kind: string;
    requiredNonSecretOptions: readonly string[];
    models: readonly SafeRemoteCatalogModel[];
    sourceDigest?: string;
  }>[];
  readonly digest: string;
}

const forbiddenRemoteKeys =
  /(?:^|_)(?:auth|authorization|credential|endpoint|host|operation|profile|protocol|route|secret|token|url)(?:$|_)/iu;
const allowedModelKeys = new Set([
  'id',
  'name',
  'capabilities',
  'limits',
  'pricing',
  'region',
  'deprecated',
]);

export function createBuiltinCatalog(input: {
  readonly providerKinds: readonly string[];
  readonly requiredNonSecretOptions?: Readonly<
    Record<string, readonly string[]>
  >;
  readonly remoteShards?: readonly unknown[];
}): GeneratedBuiltinCatalog {
  const kinds = [...input.providerKinds].sort();
  if (new Set(kinds).size !== kinds.length)
    throw new Error('builtin provider kinds must be unique');
  const shards = new Map<string, SafeRemoteCatalogShard>();
  for (const value of input.remoteShards ?? []) {
    const shard = validateRemoteCatalogShard(value);
    if (!kinds.includes(shard.providerKind))
      throw new Error(
        `catalog shard references unknown provider ${shard.providerKind}`,
      );
    if (shards.has(shard.providerKind))
      throw new Error(`duplicate catalog shard for ${shard.providerKind}`);
    shards.set(shard.providerKind, shard);
  }
  const providers = Object.freeze(
    kinds.map((kind) => {
      const shard = shards.get(kind);
      return Object.freeze({
        kind,
        requiredNonSecretOptions: Object.freeze([
          ...(input.requiredNonSecretOptions?.[kind] ?? []),
        ]),
        models: shard?.models ?? Object.freeze([]),
        ...(shard?.sourceDigest ? { sourceDigest: shard.sourceDigest } : {}),
      });
    }),
  );
  const body = Object.freeze({ schemaVersion: 1 as const, providers });
  return Object.freeze({
    ...body,
    digest: digestCanonicalJson(body),
  });
}

export function validateRemoteCatalogShard(
  input: unknown,
): SafeRemoteCatalogShard {
  rejectForbiddenRemoteFields(input, '$');
  if (!isRecord(input))
    throw new Error('remote catalog shard must be an object');
  const topLevelKeys = new Set(['providerKind', 'models', 'sourceDigest']);
  for (const key of Object.keys(input))
    if (!topLevelKeys.has(key))
      throw new Error(`remote catalog field is not allowlisted: ${key}`);
  if (typeof input.providerKind !== 'string' || input.providerKind.length === 0)
    throw new Error('remote catalog providerKind is required');
  if (!Array.isArray(input.models))
    throw new Error('remote catalog models must be an array');
  const models = input.models.map((model, index) =>
    validateRemoteModel(model, index),
  );
  const ids = models.map(({ id }) => id);
  if (new Set(ids).size !== ids.length)
    throw new Error(
      `remote catalog model IDs must be unique for ${input.providerKind}`,
    );
  if (
    input.sourceDigest !== undefined &&
    (typeof input.sourceDigest !== 'string' ||
      !/^[a-f0-9]{32,128}$/iu.test(input.sourceDigest))
  )
    throw new Error('remote catalog sourceDigest is invalid');
  return Object.freeze({
    providerKind: input.providerKind,
    models: Object.freeze(
      models.sort((left, right) => left.id.localeCompare(right.id)),
    ),
    ...(typeof input.sourceDigest === 'string'
      ? { sourceDigest: input.sourceDigest }
      : {}),
  });
}

export function digestCanonicalJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function validateRemoteModel(
  input: unknown,
  index: number,
): SafeRemoteCatalogModel {
  if (!isRecord(input))
    throw new Error(`remote model ${index} must be an object`);
  for (const key of Object.keys(input))
    if (!allowedModelKeys.has(key))
      throw new Error(`remote model field is not allowlisted: ${key}`);
  if (typeof input.id !== 'string' || input.id.length === 0)
    throw new Error(`remote model ${index} requires an id`);
  if (input.name !== undefined && typeof input.name !== 'string')
    throw new Error(`remote model ${input.id} name must be a string`);
  if (
    input.capabilities !== undefined &&
    (!Array.isArray(input.capabilities) ||
      !input.capabilities.every((value) => typeof value === 'string'))
  )
    throw new Error(`remote model ${input.id} capabilities are invalid`);
  validateNumberRecord(input.limits, `remote model ${input.id} limits`);
  validateNumberRecord(input.pricing, `remote model ${input.id} pricing`);
  if (input.region !== undefined && typeof input.region !== 'string')
    throw new Error(`remote model ${input.id} region must be a string`);
  if (input.deprecated !== undefined && typeof input.deprecated !== 'boolean')
    throw new Error(`remote model ${input.id} deprecated must be boolean`);
  return Object.freeze({
    id: input.id,
    ...(typeof input.name === 'string' ? { name: input.name } : {}),
    ...(Array.isArray(input.capabilities)
      ? { capabilities: Object.freeze([...input.capabilities] as string[]) }
      : {}),
    ...(isRecord(input.limits)
      ? {
          limits: Object.freeze({
            ...(input.limits as Record<string, number>),
          }),
        }
      : {}),
    ...(isRecord(input.pricing)
      ? {
          pricing: Object.freeze({
            ...(input.pricing as Record<string, number>),
          }),
        }
      : {}),
    ...(typeof input.region === 'string' ? { region: input.region } : {}),
    ...(typeof input.deprecated === 'boolean'
      ? { deprecated: input.deprecated }
      : {}),
  });
}

function rejectForbiddenRemoteFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      rejectForbiddenRemoteFields(item, `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenRemoteKeys.test(key))
      throw new Error(`remote catalog may not control ${path}.${key}`);
    rejectForbiddenRemoteFields(item, `${path}.${key}`);
  }
}

function validateNumberRecord(value: unknown, label: string): void {
  if (value === undefined) return;
  if (
    !isRecord(value) ||
    Object.values(value).some(
      (entry) => typeof entry !== 'number' || !Number.isFinite(entry),
    )
  )
    throw new Error(`${label} must contain finite numbers`);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
