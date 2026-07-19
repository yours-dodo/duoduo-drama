import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type {
  CredentialCodec,
  CredentialOpenResult,
  CredentialSealResult,
} from '../record-sealer.js';

export function createAesGcmCredentialCodec(options: {
  readonly activeKeyId: string;
  readonly keys: Readonly<Record<string, Uint8Array>>;
}): CredentialCodec {
  const keys = new Map(
    Object.entries(options.keys).map(([id, key]) => {
      if (key.byteLength !== 32)
        throw new TypeError(`credential codec key ${id} must be 32 bytes`);
      return [id, Buffer.from(key)] as const;
    }),
  );
  if (!keys.has(options.activeKeyId))
    throw new TypeError('active credential codec key is unavailable');

  const codec: CredentialCodec = {
    seal: async (plaintext, aad, signal): Promise<CredentialSealResult> => {
      throwIfAborted(signal);
      const key = keys.get(options.activeKeyId);
      if (!key) return { status: 'key_unavailable', retryable: false };
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(aad));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return {
        status: 'sealed',
        envelope: {
          version: 1,
          keyId: options.activeKeyId,
          ciphertext: Buffer.concat([nonce, tag, ciphertext]).toString(
            'base64url',
          ),
        },
      };
    },
    open: async (envelope, aad, signal): Promise<CredentialOpenResult> => {
      throwIfAborted(signal);
      if (envelope.version !== 1) return { status: 'invalid' };
      const key = keys.get(envelope.keyId);
      if (!key) return { status: 'key_unavailable', retryable: false };
      try {
        const payload = Buffer.from(envelope.ciphertext, 'base64url');
        if (payload.byteLength < 29) return { status: 'invalid' };
        const nonce = payload.subarray(0, 12);
        const tag = payload.subarray(12, 28);
        const ciphertext = payload.subarray(28);
        const decipher = createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(tag);
        return {
          status: 'opened',
          plaintext: Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
          ]),
        };
      } catch {
        return { status: 'invalid' };
      }
    },
  };
  return Object.freeze(codec);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

export function createNodeEnvironmentSource(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): import('../ambient.js').EnvironmentSource {
  return Object.freeze({ get: (name: string) => environment[name] });
}
