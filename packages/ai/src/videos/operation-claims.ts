import { createHash } from 'node:crypto';

import type { RequestCredentialOverride } from '../auth/api-key.js';
import type { JsonValue } from '../core/content.js';
import { AiRuntimeError } from '../core/errors.js';
import type { CredentialIdentityLifetime } from '../core/models.js';
import type {
  GenerationOperationAuthClaims,
  GenerationOperationEnvelope,
  OperationCredentialProof,
} from '../generation/index.js';
import { isSerializedOperationTokenShape } from '../generation/index.js';
import type { ResolvedVideoGenerationInput } from './input.js';
import type { VideoOperationKind } from './models.js';

export type { GenerationOperationAuthClaims } from '../generation/operation-auth.js';

declare const videoOperationRefBrand: unique symbol;
declare const serializedVideoOperationRefBrand: unique symbol;

export interface VideoOperationRef {
  readonly [videoOperationRefBrand]: true;
  readonly version: 1;
  toString(): '[REDACTED]';
  toJSON(): '[REDACTED]';
}

export type SerializedVideoOperationRef = string & {
  readonly [serializedVideoOperationRefBrand]: true;
};

export interface VideoOperationClaimsBase {
  readonly providerInstanceId: string;
  readonly protocol: string;
  readonly modelId: string;
  readonly upstreamModelId: string;
  readonly protocolProfileId: string;
  readonly modelProtocolProfileFingerprint: string;
  readonly providerOperationBindingFingerprint: string;
  readonly providerConfigFingerprint: string;
  readonly authBindingFingerprint: string;
  readonly credentialScopeFingerprint: string;
  readonly operationId: string;
  readonly operationKind: VideoOperationKind;
  readonly inputDigest: string;
  readonly outputSpecification: JsonValue;
  readonly operationState?: JsonValue;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export type VideoOperationClaims = Readonly<
  VideoOperationClaimsBase & GenerationOperationAuthClaims
>;

export interface VideoOperationRefRecord {
  readonly kind: 'memory' | 'serialized';
  readonly runtimeId?: symbol;
  readonly claims?: VideoOperationClaims;
  readonly sealedToken?: string;
  readonly authIdentityLifetime?: CredentialIdentityLifetime;
  readonly scopeIdentityLifetime?: CredentialIdentityLifetime;
  readonly requestCredential?: RequestCredentialOverride;
}

const operationRecords = new WeakMap<object, VideoOperationRefRecord>();

class RedactedVideoOperationRef implements VideoOperationRef {
  declare readonly [videoOperationRefBrand]: true;
  readonly version = 1 as const;

  constructor(record: VideoOperationRefRecord) {
    operationRecords.set(this, Object.freeze({ ...record }));
    Object.freeze(this);
  }

  toString(): '[REDACTED]' {
    return '[REDACTED]';
  }

  toJSON(): '[REDACTED]' {
    return '[REDACTED]';
  }
}

export function createVideoOperationRef(
  record: VideoOperationRefRecord,
): VideoOperationRef {
  return new RedactedVideoOperationRef(record);
}

export function inspectVideoOperationRef(
  operation: VideoOperationRef,
): VideoOperationRefRecord {
  const record = operationRecords.get(operation as object);
  if (!record)
    throw new AiRuntimeError(
      'OPERATION_REF_INVALID',
      'invalid_request',
      'video operation ref was not created by this package',
    );
  return record;
}

export function parseSerializedVideoOperationRef(
  serialized: string,
): VideoOperationRef {
  if (!isSerializedOperationTokenShape(serialized))
    throw new AiRuntimeError(
      'OPERATION_TOKEN_INVALID',
      'invalid_request',
      'video operation token is malformed',
    );
  return createVideoOperationRef({
    kind: 'serialized',
    sealedToken: serialized,
  });
}

export function asSerializedVideoOperationRef(
  token: string,
): SerializedVideoOperationRef {
  if (!isSerializedOperationTokenShape(token))
    throw new AiRuntimeError(
      'OPERATION_TOKEN_INVALID',
      'invalid_request',
      'video operation token is malformed',
    );
  return token as SerializedVideoOperationRef;
}

export function videoClaimsEnvelope(
  claims: VideoOperationClaims,
): GenerationOperationEnvelope {
  return Object.freeze({
    domain: 'videos',
    claimsVersion: 1,
    claims: claims as unknown as JsonValue,
  });
}

export function parseVideoOperationEnvelope(
  envelope: GenerationOperationEnvelope,
): VideoOperationClaims {
  if (envelope.domain !== 'videos' || envelope.claimsVersion !== 1)
    throw invalidToken();
  const input = envelope.claims;
  if (!isPlainRecord(input)) throw invalidToken();
  const requiredStrings = [
    'providerInstanceId',
    'protocol',
    'modelId',
    'upstreamModelId',
    'protocolProfileId',
    'modelProtocolProfileFingerprint',
    'providerOperationBindingFingerprint',
    'providerConfigFingerprint',
    'authBindingFingerprint',
    'credentialScopeFingerprint',
    'operationId',
    'inputDigest',
    'authSource',
    'credentialIdentityLifetime',
  ] as const;
  for (const key of requiredStrings)
    if (!validString(input[key], key === 'operationId' ? 1024 : 2048))
      throw invalidToken();
  if (
    input.operationKind !== 'generate' &&
    input.operationKind !== 'edit' &&
    input.operationKind !== 'extend'
  )
    throw invalidToken();
  if (
    !isSha256Digest(input.inputDigest) ||
    !isValidOutputSpecification(input.outputSpecification)
  )
    throw invalidToken();
  if (
    !Number.isInteger(input.issuedAt) ||
    !Number.isInteger(input.expiresAt) ||
    (input.credentialIdentityLifetime !== 'cross-runtime' &&
      input.credentialIdentityLifetime !== 'process-local')
  )
    throw invalidToken();
  if (
    input.operationState !== undefined &&
    JSON.stringify(input.operationState).length > 16_384
  )
    throw invalidToken();
  if (input.authSource === 'stored' || input.authSource === 'ambient') {
    if (!validString(input.credentialInstanceId, 2048)) throw invalidToken();
    if (input.overrideCredentialProof !== undefined) throw invalidToken();
  } else if (input.authSource === 'override') {
    if (input.credentialInstanceId !== undefined) throw invalidToken();
    validateProof(input.overrideCredentialProof);
  } else throw invalidToken();
  return Object.freeze({ ...input }) as unknown as VideoOperationClaims;
}

export function fingerprintVideoProtocolProfile(input: unknown): string {
  return digest(['@duoduo/ai/video-protocol-profile', 1, canonicalJson(input)]);
}

export function fingerprintVideoGenerationInput(
  input: Readonly<ResolvedVideoGenerationInput>,
): string {
  return digest([
    '@duoduo/ai/video-generation-input',
    1,
    {
      operation: input.operation,
      content: input.content.map((part) => {
        if (part.type === 'text')
          return {
            type: 'text',
            digest: digest(['text', part.text]),
          };
        const resource =
          part.type === 'image'
            ? part.image
            : part.type === 'video'
              ? part.video
              : part.audio;
        return {
          type: part.type,
          role: part.role,
          mediaType: resource.mediaType,
          sourceDigest: digest([
            resource.source.type,
            resource.source.type === 'url'
              ? resource.source.url
              : resource.source.data,
          ]),
          ...('durationSeconds' in resource &&
          resource.durationSeconds !== undefined
            ? { durationSeconds: resource.durationSeconds }
            : {}),
        };
      }),
      durationSeconds: input.durationSeconds ?? null,
      resolution: input.resolution ?? null,
      aspectRatio: input.aspectRatio ?? null,
      fps: input.fps ?? null,
      seed: input.seed ?? null,
      generateAudio: input.generateAudio,
      count: input.count,
    },
  ]);
}

export function fingerprintVideoOperationBinding(input: {
  readonly providerKind: string;
  readonly providerInstanceId: string;
  readonly providerConfigFingerprint: string;
  readonly protocol: string;
  readonly operationCompatibilityVersion: string;
  readonly modelId: string;
  readonly upstreamModelId: string;
  readonly modelProtocolProfileFingerprint: string;
}): string {
  return digest([
    '@duoduo/ai/video-operation-binding',
    1,
    input.providerKind,
    input.providerInstanceId,
    input.providerConfigFingerprint,
    input.protocol,
    input.operationCompatibilityVersion,
    input.modelId,
    input.upstreamModelId,
    input.modelProtocolProfileFingerprint,
  ]);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('base64url');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function isValidOutputSpecification(value: unknown): value is JsonValue {
  if (!isPlainRecord(value)) return false;
  const allowedKeys = new Set([
    'durationSeconds',
    'resolution',
    'aspectRatio',
    'fps',
    'generateAudio',
    'count',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (JSON.stringify(value).length > 16_384) return false;
  if (
    value.durationSeconds !== undefined &&
    !positiveFiniteNumber(value.durationSeconds, 86_400)
  )
    return false;
  if (value.resolution !== undefined && !isValidResolution(value.resolution))
    return false;
  if (value.aspectRatio !== undefined && !validString(value.aspectRatio, 64))
    return false;
  if (value.fps !== undefined && !positiveFiniteNumber(value.fps, 1_000))
    return false;
  if (
    value.generateAudio !== undefined &&
    typeof value.generateAudio !== 'boolean'
  )
    return false;
  const count = value.count;
  if (
    count !== undefined &&
    (typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 1_024)
  )
    return false;
  return true;
}

function isValidResolution(value: unknown): boolean {
  if (typeof value === 'string') return validString(value, 64);
  if (!isPlainRecord(value) || Object.keys(value).length !== 2) return false;
  const width = value.width;
  const height = value.height;
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= 100_000 &&
    height <= 100_000
  );
}

function positiveFiniteNumber(value: unknown, max: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= max
  );
}

function validateProof(
  value: unknown,
): asserts value is OperationCredentialProof {
  if (
    !isPlainRecord(value) ||
    !validString(value.keyId, 256) ||
    !validString(value.digest, 1024) ||
    !/^[A-Za-z0-9_-]+$/u.test(value.digest)
  )
    throw invalidToken();
}

function invalidToken(): AiRuntimeError {
  return new AiRuntimeError(
    'OPERATION_TOKEN_INVALID',
    'invalid_request',
    'video operation token is invalid',
  );
}
