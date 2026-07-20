import { describe, expect, it } from 'vitest';

import { parseVideoOperationEnvelope } from './operation-claims.js';

const validClaims = {
  providerInstanceId: 'provider',
  protocol: 'protocol',
  modelId: 'model',
  upstreamModelId: 'upstream',
  protocolProfileId: 'profile',
  modelProtocolProfileFingerprint: 'profile-fingerprint',
  providerOperationBindingFingerprint: 'binding-fingerprint',
  providerConfigFingerprint: 'config-fingerprint',
  authBindingFingerprint: 'auth-fingerprint',
  credentialScopeFingerprint: 'scope-fingerprint',
  operationId: 'operation-1',
  operationKind: 'generate',
  inputDigest: '3q2-7wT7oM4cM3B7Hxwqz01f1NqKQmE-k5FmydjOr20',
  outputSpecification: { durationSeconds: 5, count: 1 },
  issuedAt: 1,
  expiresAt: 2,
  authSource: 'stored',
  credentialInstanceId: 'credential-1',
  credentialIdentityLifetime: 'cross-runtime',
} as const;

describe('video operation envelope', () => {
  it('fails closed for another generation domain', () => {
    expect(() =>
      parseVideoOperationEnvelope({
        domain: 'images',
        claimsVersion: 1,
        claims: validClaims,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'OPERATION_TOKEN_INVALID' }),
    );
  });

  it.each(['operationKind', 'inputDigest', 'outputSpecification'] as const)(
    'requires %s in serialized claims',
    (field) => {
      const claims = { ...validClaims } as Record<string, unknown>;
      delete claims[field];
      expect(() =>
        parseVideoOperationEnvelope({
          domain: 'videos',
          claimsVersion: 1,
          claims,
        }),
      ).toThrowError(
        expect.objectContaining({ code: 'OPERATION_TOKEN_INVALID' }),
      );
    },
  );

  it.each([
    ['inputDigest', 'not-a-digest'],
    ['inputDigest', 'a'.repeat(44)],
    ['outputSpecification', []],
    ['outputSpecification', { unexpected: true }],
    ['outputSpecification', { durationSeconds: 0 }],
    ['outputSpecification', { resolution: { width: 0, height: 720 } }],
    ['outputSpecification', { aspectRatio: '' }],
    ['outputSpecification', { fps: 0 }],
    ['outputSpecification', { generateAudio: 'yes' }],
    ['outputSpecification', { count: 0 }],
  ] as const)('rejects invalid serialized %s', (field, value) => {
    expect(() =>
      parseVideoOperationEnvelope({
        domain: 'videos',
        claimsVersion: 1,
        claims: { ...validClaims, [field]: value },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'OPERATION_TOKEN_INVALID' }),
    );
  });
});
