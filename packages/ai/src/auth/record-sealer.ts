import { TextDecoder, TextEncoder } from 'node:util';

import { AiRuntimeError } from '../core/errors.js';
import type { JsonValue } from '../core/content.js';
import type {
  ActiveCredentialRecord,
  Credential,
  CredentialRecord,
  CredentialScopeKey,
} from './credential-store.js';
import { canonicalizeCredentialScope } from './scope-authority.js';
import { revealSecret, secret } from './secret-value.js';

export interface SealedCredentialEnvelope {
  readonly version: number;
  readonly keyId: string;
  readonly ciphertext: string;
}

export type CredentialSealResult =
  | Readonly<{ status: 'sealed'; envelope: SealedCredentialEnvelope }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

export type CredentialOpenResult =
  | Readonly<{ status: 'opened'; plaintext: Uint8Array }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

export interface CredentialCodec {
  seal(
    plaintext: Uint8Array,
    aad: Uint8Array,
    signal?: AbortSignal,
  ): Promise<CredentialSealResult>;
  open(
    envelope: SealedCredentialEnvelope,
    aad: Uint8Array,
    signal?: AbortSignal,
  ): Promise<CredentialOpenResult>;
}

export type PersistedCredentialHeader =
  | Readonly<{
      state: 'empty';
      revision: string;
      credentialInstanceId: null;
      authBindingFingerprint: null;
    }>
  | Readonly<{
      state: 'active';
      revision: string;
      credentialInstanceId: string;
      authBindingFingerprint: string;
    }>;

export interface PersistedCredentialRecord {
  readonly format: '@duoduo/ai/credential-record';
  readonly schemaVersion: 1;
  readonly header: PersistedCredentialHeader;
  readonly sealedPayload: SealedCredentialEnvelope;
}

export interface CredentialRecordSealer {
  seal(
    scope: CredentialScopeKey,
    record: CredentialRecord,
    signal?: AbortSignal,
  ): Promise<PersistedCredentialRecord>;
  open(
    scope: CredentialScopeKey,
    persisted: PersistedCredentialRecord,
    signal?: AbortSignal,
  ): Promise<CredentialRecord>;
}

export function createCredentialRecordSealer(options: {
  readonly codec: CredentialCodec;
  readonly storeNamespace: string;
}): CredentialRecordSealer {
  if (options.storeNamespace.length === 0)
    throw new TypeError('credential store namespace must not be empty');
  const sealer: CredentialRecordSealer = {
    seal: async (scope, record, signal) => {
      const header = makeHeader(record);
      const result = await options.codec.seal(
        encodeJson(serializeRecord(record)),
        makeAad(options.storeNamespace, scope, header),
        signal,
      );
      if (result.status === 'key_unavailable')
        throw new AiRuntimeError(
          'CREDENTIAL_CODEC_KEY_UNAVAILABLE',
          'auth',
          'credential encryption key is unavailable',
          result.retryable,
        );
      return Object.freeze({
        format: '@duoduo/ai/credential-record' as const,
        schemaVersion: 1 as const,
        header,
        sealedPayload: result.envelope,
      });
    },
    open: async (scope, persisted, signal) => {
      if (
        persisted.format !== '@duoduo/ai/credential-record' ||
        persisted.schemaVersion !== 1
      )
        throw corruptError();
      const result = await options.codec.open(
        persisted.sealedPayload,
        makeAad(options.storeNamespace, scope, persisted.header),
        signal,
      );
      if (result.status === 'key_unavailable')
        throw new AiRuntimeError(
          'CREDENTIAL_CODEC_KEY_UNAVAILABLE',
          'auth',
          'credential encryption key is unavailable',
          result.retryable,
        );
      if (result.status === 'invalid') throw corruptError();
      try {
        const record = deserializeRecord(decodeJson(result.plaintext));
        if (!headerMatches(record, persisted.header)) throw corruptError();
        return record;
      } catch (error) {
        if (error instanceof AiRuntimeError) throw error;
        throw corruptError();
      }
    },
  };
  return Object.freeze(sealer);
}

function makeHeader(record: CredentialRecord): PersistedCredentialHeader {
  return record.state === 'empty'
    ? Object.freeze({
        state: 'empty' as const,
        revision: record.revision,
        credentialInstanceId: null,
        authBindingFingerprint: null,
      })
    : Object.freeze({
        state: 'active' as const,
        revision: record.revision,
        credentialInstanceId: record.credentialInstanceId,
        authBindingFingerprint: record.authBinding.fingerprint,
      });
}

function makeAad(
  storeNamespace: string,
  scope: CredentialScopeKey,
  header: PersistedCredentialHeader,
): Uint8Array {
  return encodeJson({
    domain: '@duoduo/ai/credential-record',
    schemaVersion: 1,
    storeNamespace,
    canonicalScope: canonicalizeCredentialScope(scope),
    ...header,
  });
}

function serializeRecord(record: CredentialRecord): JsonValue {
  if (record.state === 'empty') return { ...record };
  return {
    ...record,
    credential: serializeCredential(record.credential),
  } as unknown as JsonValue;
}

function serializeCredential(credential: Credential): JsonValue {
  switch (credential.type) {
    case 'api_key':
      return {
        ...credential,
        secret: revealSecret(credential.secret),
      } as unknown as JsonValue;
    case 'oauth':
      return {
        ...credential,
        accessToken: revealSecret(credential.accessToken),
        refreshToken: revealSecret(credential.refreshToken),
      } as unknown as JsonValue;
    case 'ambient_config':
      return {
        type: credential.type,
        config: Object.fromEntries(
          Object.entries(credential.config).map(([name, value]) => [
            name,
            typeof value === 'string'
              ? { kind: 'string', value }
              : { kind: 'secret', value: revealSecret(value) },
          ]),
        ),
      } as unknown as JsonValue;
  }
}

function deserializeRecord(value: unknown): CredentialRecord {
  if (!isRecord(value) || typeof value.revision !== 'string')
    throw corruptError();
  if (value.state === 'empty')
    return Object.freeze({ state: 'empty', revision: value.revision });
  if (
    value.state !== 'active' ||
    typeof value.credentialInstanceId !== 'string' ||
    !isRecord(value.catalogAuth) ||
    !isRecord(value.authBinding) ||
    !isRecord(value.authState)
  )
    throw corruptError();
  return Object.freeze({
    ...value,
    state: 'active' as const,
    credential: deserializeCredential(value.credential),
  }) as unknown as ActiveCredentialRecord;
}

function deserializeCredential(value: unknown): Credential {
  if (!isRecord(value) || typeof value.type !== 'string') throw corruptError();
  if (
    value.type === 'api_key' &&
    typeof value.secret === 'string' &&
    typeof value.scheme === 'string'
  )
    return Object.freeze({
      ...value,
      secret: secret(value.secret),
    }) as Credential;
  if (
    value.type === 'oauth' &&
    typeof value.accessToken === 'string' &&
    typeof value.refreshToken === 'string' &&
    typeof value.expiresAt === 'number'
  )
    return Object.freeze({
      ...value,
      accessToken: secret(value.accessToken),
      refreshToken: secret(value.refreshToken),
    }) as Credential;
  if (value.type === 'ambient_config' && isRecord(value.config)) {
    const config: Record<string, string | ReturnType<typeof secret>> = {};
    for (const [name, item] of Object.entries(value.config)) {
      if (
        !isRecord(item) ||
        typeof item.kind !== 'string' ||
        typeof item.value !== 'string'
      )
        throw corruptError();
      config[name] = item.kind === 'secret' ? secret(item.value) : item.value;
    }
    return Object.freeze({
      type: 'ambient_config',
      config: Object.freeze(config),
    });
  }
  throw corruptError();
}

function headerMatches(
  record: CredentialRecord,
  header: PersistedCredentialHeader,
): boolean {
  return record.state === header.state &&
    record.revision === header.revision &&
    record.state === 'active' &&
    header.state === 'active'
    ? record.credentialInstanceId === header.credentialInstanceId &&
        record.authBinding.fingerprint === header.authBindingFingerprint
    : record.state === 'empty' && header.state === 'empty';
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decodeJson(value: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function corruptError(): AiRuntimeError {
  return new AiRuntimeError(
    'CREDENTIAL_STORE_CORRUPT',
    'auth',
    'credential store record is invalid',
  );
}
