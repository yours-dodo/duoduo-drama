import { createHmac, timingSafeEqual } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { secret } from '../auth/secret-value.js';
import {
  createOperationCredentialVerifier,
  GenerationOperationMachine,
  resolveGenerationOperationPolicy,
  validateGenerationOperationEnvelope,
  validateGenerationOperationTimes,
  type OperationCredentialDigestDriver,
} from './index.js';

describe('generation operation policy', () => {
  it('uses the frozen defaults and rejects unsafe ranges', () => {
    expect(resolveGenerationOperationPolicy()).toEqual({
      maxTtlMs: 86_400_000,
      allowedClockSkewMs: 60_000,
    });
    expect(() =>
      resolveGenerationOperationPolicy({
        maxTtlMs: 59_999,
        allowedClockSkewMs: 0,
      }),
    ).toThrow(/maxTtlMs/);
    expect(() =>
      resolveGenerationOperationPolicy({
        maxTtlMs: 60_000,
        allowedClockSkewMs: 300_001,
      }),
    ).toThrow(/allowedClockSkewMs/);
  });

  it('validates domain envelopes and authoritative TTL/skew bounds', () => {
    expect(
      validateGenerationOperationEnvelope({
        domain: 'images',
        claimsVersion: 1,
        claims: { operationId: 'task-1' },
      }),
    ).toEqual({
      domain: 'images',
      claimsVersion: 1,
      claims: { operationId: 'task-1' },
    });
    expect(() =>
      validateGenerationOperationEnvelope({
        domain: 'audio',
        claimsVersion: 1,
        claims: {},
      }),
    ).toThrow(/domain/);
    expect(() =>
      validateGenerationOperationTimes(
        { issuedAt: 1_000, expiresAt: 87_400_001 },
        { maxTtlMs: 86_400_000, allowedClockSkewMs: 60_000 },
        1_000,
      ),
    ).toThrow(/TTL/);
    expect(() =>
      validateGenerationOperationTimes(
        { issuedAt: 61_001, expiresAt: 62_001 },
        { maxTtlMs: 86_400_000, allowedClockSkewMs: 60_000 },
        1_000,
      ),
    ).toThrow(/future/);
  });
});

describe('operation credential verifier', () => {
  it('uses a domain-separated length-prefixed tuple and clears temporary bytes', async () => {
    const key = Buffer.from('test-operation-key');
    const seen: Uint8Array[] = [];
    const driver: OperationCredentialDigestDriver = {
      identityLifetime: 'cross-runtime',
      create: async (canonical) => {
        seen.push(canonical);
        return {
          status: 'created',
          proof: {
            keyId: 'k1',
            digest: createHmac('sha256', key)
              .update(canonical)
              .digest('base64url'),
          },
        };
      },
      verify: async (canonical, proof) => {
        const actual = createHmac('sha256', key).update(canonical).digest();
        const expected = Buffer.from(proof.digest, 'base64url');
        return {
          status:
            actual.length === expected.length &&
            timingSafeEqual(actual, expected)
              ? 'match'
              : 'mismatch',
        };
      },
    };
    const verifier = createOperationCredentialVerifier(driver);
    const override = {
      type: 'api_key' as const,
      secret: secret('credential-value'),
    };
    const created = await verifier.create(override);
    expect(created.status).toBe('created');
    if (created.status !== 'created') throw new Error('proof not created');
    await expect(verifier.verify(override, created.proof)).resolves.toEqual({
      status: 'match',
    });
    await expect(
      verifier.verify(
        { ...override, secret: secret('different-value') },
        created.proof,
      ),
    ).resolves.toEqual({ status: 'mismatch' });
    expect(seen).toHaveLength(1);
    expect([...seen[0]!]).toEqual(new Array(seen[0]!.length).fill(0));
  });
});

describe('generation operation machine', () => {
  it('fails closed before set, rejects duplicate set, and arbitrates one terminal', () => {
    const machine = new GenerationOperationMachine<string>();
    expect(() => machine.requireOperation()).toThrow(/not available/);
    expect(machine.tryWin('detach')).toBe(false);
    machine.setOperation('task-1');
    expect(machine.requireOperation()).toBe('task-1');
    expect(() => machine.setOperation('task-2')).toThrow(/already set/);
    expect(machine.tryWin('detach')).toBe(true);
    expect(machine.tryWin('abort')).toBe(false);
    expect(machine.tryWin('remote_terminal')).toBe(false);
    expect(machine.requestRemoteCancel()).toBe(false);
    expect(machine.snapshot()).toEqual({
      operation: 'task-1',
      winner: 'detach',
      remoteCancelRequested: false,
    });
  });

  it('requests remote cancellation exactly once only after abort wins', () => {
    const machine = new GenerationOperationMachine<string>();
    machine.setOperation('task-1');
    expect(machine.requestRemoteCancel()).toBe(false);
    expect(machine.tryWin('abort')).toBe(true);
    expect(machine.requestRemoteCancel()).toBe(true);
    expect(machine.requestRemoteCancel()).toBe(false);
    expect(machine.tryWin('remote_terminal')).toBe(false);
    expect(machine.snapshot()).toEqual({
      operation: 'task-1',
      winner: 'abort',
      remoteCancelRequested: true,
    });
  });
});
