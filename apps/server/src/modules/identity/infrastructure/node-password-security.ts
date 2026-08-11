import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

import type { PasswordSecurity } from '../ports/password-security.js';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 32 * 1024 * 1024;

export class NodePasswordSecurity implements PasswordSecurity {
  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await derive(password, salt);

    return [
      'scrypt',
      SCRYPT_N,
      SCRYPT_R,
      SCRYPT_P,
      salt.toString('base64url'),
      derivedKey.toString('base64url'),
    ].join('$');
  }

  async verifyPassword(
    password: string,
    passwordHash: string,
  ): Promise<boolean> {
    const parts = passwordHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return false;
    }

    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
      return false;
    }

    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(parts[4] ?? '', 'base64url');
      expected = Buffer.from(parts[5] ?? '', 'base64url');
    } catch {
      return false;
    }

    if (salt.length !== 16 || expected.length !== KEY_LENGTH) {
      return false;
    }

    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected);
  }
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}
