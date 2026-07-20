import { createHash } from 'node:crypto';

export const klingApiKeyCredential = Object.freeze({
  headerName: 'authorization',
  defaultScheme: 'Bearer',
});

export function klingAuthPolicyFingerprint(input: {
  readonly providerInstanceId: string;
  readonly baseUrl: string;
  readonly modelIdentity: string;
}): string {
  return `${createHash('sha256')
    .update(
      JSON.stringify([
        'kling',
        input.providerInstanceId,
        input.baseUrl,
        input.modelIdentity,
      ]),
    )
    .digest('base64url')}:KLING_API_KEY`;
}
