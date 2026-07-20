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

export type { GenerationOperationAuthClaims } from '../generation/operation-auth.js';

declare const imageOperationRefBrand: unique symbol;
declare const serializedImageOperationRefBrand: unique symbol;

export interface ImageOperationRef {
  readonly [imageOperationRefBrand]: true;
  readonly version: 1;
  toString(): '[REDACTED]';
  toJSON(): '[REDACTED]';
}

export type SerializedImageOperationRef = string & {
  readonly [serializedImageOperationRefBrand]: true;
};

export interface ImageOperationClaimsBase {
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
  readonly operationState?: JsonValue;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export type ImageOperationClaims = Readonly<
  ImageOperationClaimsBase & GenerationOperationAuthClaims
>;

export interface ImageOperationRefRecord {
  readonly kind: 'memory' | 'serialized';
  readonly runtimeId?: symbol;
  readonly claims?: ImageOperationClaims;
  readonly sealedToken?: string;
  readonly authIdentityLifetime?: CredentialIdentityLifetime;
  readonly scopeIdentityLifetime?: CredentialIdentityLifetime;
  readonly requestCredential?: RequestCredentialOverride;
}

const operationRecords = new WeakMap<object, ImageOperationRefRecord>();

class RedactedImageOperationRef implements ImageOperationRef {
  declare readonly [imageOperationRefBrand]: true;
  readonly version = 1 as const;

  constructor(record: ImageOperationRefRecord) {
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

export function createImageOperationRef(
  record: ImageOperationRefRecord,
): ImageOperationRef {
  return new RedactedImageOperationRef(record);
}

export function inspectImageOperationRef(
  operation: ImageOperationRef,
): ImageOperationRefRecord {
  const record = operationRecords.get(operation as object);
  if (!record)
    throw new AiRuntimeError(
      'OPERATION_REF_INVALID',
      'invalid_request',
      'image operation ref was not created by this package',
    );
  return record;
}

export function parseSerializedImageOperationRef(
  serialized: string,
): ImageOperationRef {
  if (!isSerializedOperationTokenShape(serialized))
    throw new AiRuntimeError(
      'OPERATION_TOKEN_INVALID',
      'invalid_request',
      'image operation token is malformed',
    );
  return createImageOperationRef({
    kind: 'serialized',
    sealedToken: serialized,
  });
}

export function asSerializedImageOperationRef(
  token: string,
): SerializedImageOperationRef {
  if (!isSerializedOperationTokenShape(token))
    throw new AiRuntimeError(
      'OPERATION_TOKEN_INVALID',
      'invalid_request',
      'image operation token is malformed',
    );
  return token as SerializedImageOperationRef;
}

export function imageClaimsEnvelope(
  claims: ImageOperationClaims,
): GenerationOperationEnvelope {
  return Object.freeze({
    domain: 'images',
    claimsVersion: 1,
    claims: claims as unknown as JsonValue,
  });
}

export function parseImageOperationEnvelope(
  envelope: GenerationOperationEnvelope,
): ImageOperationClaims {
  if (envelope.domain !== 'images' || envelope.claimsVersion !== 1)
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
    'authSource',
    'credentialIdentityLifetime',
  ] as const;
  for (const key of requiredStrings)
    if (!validString(input[key], key === 'operationId' ? 1024 : 2048))
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
  return Object.freeze({ ...input }) as unknown as ImageOperationClaims;
}

export function fingerprintImageProtocolProfile(input: unknown): string {
  return digest(['@duoduo/ai/image-protocol-profile', 1, canonicalJson(input)]);
}

export function fingerprintImageOperationBinding(input: {
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
    '@duoduo/ai/image-operation-binding',
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
    'image operation token is invalid',
  );
}
