export const PASSWORD_CREDENTIAL_REPOSITORY = Symbol(
  'PASSWORD_CREDENTIAL_REPOSITORY',
);

export interface PasswordCredentialSnapshot {
  userId: string;
  email: string;
  passwordHash: string | null;
}

export interface PasswordCredentialRepository {
  findByEmail(email: string): Promise<PasswordCredentialSnapshot | null>;
  findByUserId(userId: string): Promise<PasswordCredentialSnapshot | null>;
  setPasswordHash(userId: string, passwordHash: string): Promise<void>;
}
