import type { RequestCredentialOverride } from '../auth/api-key.js';
import { revealSecret } from '../auth/secret-value.js';
import type { CredentialIdentityLifetime } from '../core/models.js';

export interface OperationCredentialProof {
  readonly keyId: string;
  readonly digest: string;
}

export type OperationCredentialCreateResult =
  | Readonly<{ status: 'created'; proof: OperationCredentialProof }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

export type OperationCredentialVerificationResult =
  | Readonly<{ status: 'match' }>
  | Readonly<{ status: 'mismatch' }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

export interface OperationCredentialDigestDriver {
  readonly identityLifetime: CredentialIdentityLifetime;
  create(
    canonicalCredential: Uint8Array,
    signal?: AbortSignal,
  ): Promise<OperationCredentialCreateResult>;
  verify(
    canonicalCredential: Uint8Array,
    proof: OperationCredentialProof,
    signal?: AbortSignal,
  ): Promise<OperationCredentialVerificationResult>;
}

declare const operationCredentialVerifierBrand: unique symbol;

export interface OperationCredentialVerifier {
  readonly [operationCredentialVerifierBrand]: true;
  readonly identityLifetime: CredentialIdentityLifetime;
  create(
    override: RequestCredentialOverride,
    signal?: AbortSignal,
  ): Promise<OperationCredentialCreateResult>;
  verify(
    override: RequestCredentialOverride,
    proof: OperationCredentialProof,
    signal?: AbortSignal,
  ): Promise<OperationCredentialVerificationResult>;
}

const tupleDomain = '@duoduo/ai/image-operation-credential';

export function createOperationCredentialVerifier(
  driver: OperationCredentialDigestDriver,
): OperationCredentialVerifier {
  if (
    driver.identityLifetime !== 'cross-runtime' &&
    driver.identityLifetime !== 'process-local'
  )
    throw new TypeError('invalid operation credential identity lifetime');
  const verifier = {
    identityLifetime: driver.identityLifetime,
    create: async (override: RequestCredentialOverride, signal?: AbortSignal) =>
      withCanonicalCredential(override, (value) =>
        driver.create(value, signal),
      ),
    verify: async (
      override: RequestCredentialOverride,
      proof: OperationCredentialProof,
      signal?: AbortSignal,
    ) => {
      validateProof(proof);
      return withCanonicalCredential(override, (value) =>
        driver.verify(value, proof, signal),
      );
    },
  } as OperationCredentialVerifier;
  return Object.freeze(verifier);
}

async function withCanonicalCredential<T>(
  override: RequestCredentialOverride,
  run: (value: Uint8Array) => Promise<T>,
): Promise<T> {
  const canonical = canonicalizeOverride(override);
  try {
    return await run(canonical);
  } finally {
    canonical.fill(0);
  }
}

function canonicalizeOverride(override: RequestCredentialOverride): Uint8Array {
  if (!['api_key', 'bearer_token', 'provider_secret'].includes(override.type))
    throw new TypeError('invalid credential override type');
  const scheme = normalizeScheme(
    override.scheme ?? `@default/${override.type}`,
  );
  const secretBytes = Buffer.from(revealSecret(override.secret), 'utf8');
  try {
    return encodeTuple([
      Buffer.from(tupleDomain, 'utf8'),
      Buffer.from([1]),
      Buffer.from(override.type, 'utf8'),
      Buffer.from(scheme, 'utf8'),
      secretBytes,
    ]);
  } finally {
    secretBytes.fill(0);
  }
}

function normalizeScheme(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    hasAsciiControlCharacter(normalized)
  )
    throw new TypeError('invalid credential scheme');
  return normalized;
}

function encodeTuple(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + 4 + part.byteLength, 0);
  const output = new Uint8Array(length);
  const view = new DataView(output.buffer);
  let offset = 0;
  for (const part of parts) {
    view.setUint32(offset, part.byteLength, false);
    offset += 4;
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function validateProof(proof: OperationCredentialProof): void {
  if (
    typeof proof.keyId !== 'string' ||
    proof.keyId.length === 0 ||
    proof.keyId.length > 256 ||
    typeof proof.digest !== 'string' ||
    proof.digest.length < 16 ||
    proof.digest.length > 1024 ||
    !/^[A-Za-z0-9_-]+$/u.test(proof.digest)
  )
    throw new TypeError('invalid operation credential proof');
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
