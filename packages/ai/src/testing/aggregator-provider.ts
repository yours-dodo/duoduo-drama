import type { JsonValue } from '../core/content.js';
import type {
  Provider,
  ProviderAuth,
  ProviderContractManifest,
} from '../runtime/registry.js';
import {
  capabilityModelIds,
  type AggregatorCapabilityMap,
  validateAggregatorCapabilityMap,
} from './contracts/capability-map.js';
import type { AggregatorCapability } from './contracts/channel-isolation.js';

const unsafeRemoteCatalogFields = new Set([
  'endpoint',
  'baseUrl',
  'origin',
  'headers',
  'auth',
  'credential',
  'protocol',
  'protocolProfileId',
  'profile',
  'compatibility',
  'operationMode',
  'operationActions',
  'resolveEndpoint',
  'resolveOperationEndpoint',
  'route',
]);

const remoteCatalogFields = new Set([
  'capability',
  'id',
  'upstreamModelId',
  'name',
  'publisher',
  'family',
  'pricing',
  'providerMetadata',
  'availability',
]);

export interface AggregatorCatalogFact {
  readonly capability: AggregatorCapability;
  readonly id: string;
  readonly upstreamModelId: string;
  readonly name: string;
  readonly publisher?: string;
  readonly family?: string;
  readonly pricing?: JsonValue;
  readonly providerMetadata?: Readonly<Record<string, JsonValue>>;
  readonly availability?: 'available' | 'unavailable' | 'deprecated';
}

export interface AggregatorModelTarget {
  readonly providerInstanceId: string;
  readonly modelId: string;
}

export interface AggregatorFallbackProfile {
  readonly id: string;
  readonly capability: AggregatorCapability;
  readonly source: AggregatorModelTarget;
  readonly fallbacks: readonly AggregatorModelTarget[];
}

export interface AggregatorProvider extends Provider {
  readonly remoteCatalogFacts: readonly AggregatorCatalogFact[];
  readonly fallbackProfiles: readonly AggregatorFallbackProfile[];
}

export interface CreateAggregatorProviderOptions {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly identity?: Readonly<Record<string, string>>;
  readonly auth?: ProviderAuth;
  readonly contractManifest?: ProviderContractManifest;
  readonly capabilities: Readonly<AggregatorCapabilityMap>;
  readonly remoteCatalogFacts?: unknown;
  readonly fallbackProfiles?: readonly AggregatorFallbackProfile[];
}

export function createAggregatorProvider(
  options: CreateAggregatorProviderOptions,
): AggregatorProvider {
  requireText(options.id, 'aggregator provider id');
  requireText(options.kind, 'aggregator provider kind');
  requireText(options.name, 'aggregator provider name');
  const capabilities = validateAggregatorCapabilityMap(
    options.id,
    options.capabilities,
  );
  const remoteCatalogFacts = validateAggregatorCatalogFacts(
    options.remoteCatalogFacts ?? [],
  );
  const fallbackProfiles = validateAggregatorFallbackProfiles(
    options.id,
    capabilities,
    options.fallbackProfiles ?? [],
  );
  const identity = Object.freeze({
    ...(options.identity ?? {}),
    aggregatorCatalogFacts: JSON.stringify(remoteCatalogFacts),
    aggregatorFallbackProfiles: JSON.stringify(fallbackProfiles),
  });

  return Object.freeze({
    id: options.id,
    kind: options.kind,
    name: options.name,
    identity,
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.contractManifest
      ? { contractManifest: options.contractManifest }
      : {}),
    ...capabilities,
    remoteCatalogFacts,
    fallbackProfiles,
  });
}

export function validateAggregatorCatalogFacts(
  input: unknown,
): readonly AggregatorCatalogFact[] {
  if (!Array.isArray(input))
    throw new TypeError('remote catalog facts must be an array');
  const identities = new Set<string>();
  const facts = input.map((value, index) => {
    rejectUnsafeRemoteCatalogFields(value);
    const fact = parseCatalogFact(value, index);
    const identity = `${fact.capability}\0${fact.id}`;
    if (identities.has(identity))
      throw new TypeError(
        `remote catalog model fact must be unique: ${fact.id}`,
      );
    identities.add(identity);
    return fact;
  });
  return Object.freeze(facts);
}

export function validateAggregatorFallbackProfiles(
  providerInstanceId: string,
  capabilities: Readonly<AggregatorCapabilityMap>,
  input: readonly AggregatorFallbackProfile[],
): readonly AggregatorFallbackProfile[] {
  const ids = new Set<string>();
  const profiles = input.map((profile, index) => {
    if (!isPlainRecord(profile))
      throw new TypeError(`fallback profile ${index} must be an object`);
    requireText(profile.id, `fallback profile ${index} id`);
    if (ids.has(profile.id))
      throw new TypeError(`fallback profile id must be unique: ${profile.id}`);
    ids.add(profile.id);
    const capability = parseCapability(profile.capability, 'fallback profile');
    const availableModels = capabilityModelIds(capabilities, capability);
    const source = parseTarget(
      profile.source,
      providerInstanceId,
      availableModels,
      'source',
    );
    if (!Array.isArray(profile.fallbacks))
      throw new TypeError('fallback profile fallbacks must be an array');
    const fallbacks = Object.freeze(
      profile.fallbacks.map((target) =>
        parseTarget(target, providerInstanceId, availableModels, 'fallback'),
      ),
    );
    return Object.freeze({
      id: profile.id,
      capability,
      source,
      fallbacks,
    });
  });
  return Object.freeze(profiles);
}

function rejectUnsafeRemoteCatalogFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) rejectUnsafeRemoteCatalogFields(entry);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (unsafeRemoteCatalogFields.has(key))
      throw new TypeError(`remote catalog field is forbidden: ${key}`);
    rejectUnsafeRemoteCatalogFields(entry);
  }
}

function parseCatalogFact(
  value: unknown,
  index: number,
): AggregatorCatalogFact {
  if (!isPlainRecord(value))
    throw new TypeError(`remote catalog fact ${index} must be an object`);
  const unknownField = Object.keys(value).find(
    (field) => !remoteCatalogFields.has(field),
  );
  if (unknownField)
    throw new TypeError(
      `remote catalog field is not a model fact: ${unknownField}`,
    );
  const capability = parseCapability(value.capability, 'remote catalog fact');
  const id = requireText(value.id, `remote catalog fact ${index} id`);
  const upstreamModelId = requireText(
    value.upstreamModelId,
    `remote catalog fact ${index} upstreamModelId`,
  );
  const name = requireText(value.name, `remote catalog fact ${index} name`);
  const publisher = optionalText(value.publisher, 'publisher');
  const family = optionalText(value.family, 'family');
  const pricing = optionalJson(value.pricing, 'pricing');
  const providerMetadata = optionalJsonRecord(
    value.providerMetadata,
    'providerMetadata',
  );
  const availability = value.availability;
  if (
    availability !== undefined &&
    availability !== 'available' &&
    availability !== 'unavailable' &&
    availability !== 'deprecated'
  )
    throw new TypeError('remote catalog availability is invalid');

  return Object.freeze({
    capability,
    id,
    upstreamModelId,
    name,
    ...(publisher ? { publisher } : {}),
    ...(family ? { family } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
    ...(availability ? { availability } : {}),
  });
}

function parseTarget(
  value: unknown,
  providerInstanceId: string,
  availableModels: ReadonlySet<string>,
  role: string,
): AggregatorModelTarget {
  if (!isPlainRecord(value))
    throw new TypeError(`${role} target must be an object`);
  const targetProvider = requireText(
    value.providerInstanceId,
    `${role} providerInstanceId`,
  );
  if (targetProvider !== providerInstanceId)
    throw new TypeError(
      `cross-provider fallback is forbidden: ${targetProvider}`,
    );
  const modelId = requireText(value.modelId, `${role} modelId`);
  if (!availableModels.has(modelId))
    throw new TypeError(`${role} model is not in the Provider capability map`);
  return Object.freeze({ providerInstanceId: targetProvider, modelId });
}

function parseCapability(
  value: unknown,
  context: string,
): AggregatorCapability {
  if (value !== 'chat' && value !== 'images' && value !== 'videos')
    throw new TypeError(`${context} capability is invalid`);
  return value;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 1024)
    throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function optionalText(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requireText(value, name);
}

function optionalJson(value: unknown, name: string): JsonValue | undefined {
  if (value === undefined) return undefined;
  return freezeJson(value, name);
}

function optionalJsonRecord(
  value: unknown,
  name: string,
): Readonly<Record<string, JsonValue>> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value))
    throw new TypeError(`remote catalog ${name} must be an object`);
  return freezeJson(value, name) as Readonly<Record<string, JsonValue>>;
}

function freezeJson(value: unknown, name: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError(`remote catalog ${name} must contain finite numbers`);
    return value;
  }
  if (Array.isArray(value))
    return Object.freeze(
      value.map((entry) => freezeJson(entry, name)),
    ) as JsonValue;
  if (isPlainRecord(value)) {
    const output: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value))
      output[key] = freezeJson(entry, name);
    return Object.freeze(output);
  }
  throw new TypeError(`remote catalog ${name} must be JSON data`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
