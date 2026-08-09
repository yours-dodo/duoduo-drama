export const IDENTITY_TOKEN_SECURITY = Symbol('IDENTITY_TOKEN_SECURITY');

export interface IdentityTokenSecurity {
  issueToken(): string;
  hashToken(token: string): string;
  digestSource(sourceAddress: string): string;
  issueSessionToken(): string;
  hashLoginToken(token: string): string;
  hashSessionToken(token: string): string;
}
