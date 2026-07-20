import type { CredentialIdentityLifetime } from '../core/models.js';
import type { OperationCredentialProof } from './credential-proof.js';

export type GenerationOperationAuthClaims =
  | Readonly<{
      authSource: 'stored' | 'ambient';
      credentialInstanceId: string;
      credentialIdentityLifetime: CredentialIdentityLifetime;
      overrideCredentialProof?: never;
    }>
  | Readonly<{
      authSource: 'override';
      credentialInstanceId?: never;
      credentialIdentityLifetime: CredentialIdentityLifetime;
      overrideCredentialProof: OperationCredentialProof;
    }>;
