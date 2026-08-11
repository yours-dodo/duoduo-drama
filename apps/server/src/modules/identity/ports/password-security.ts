export const PASSWORD_SECURITY = Symbol('PASSWORD_SECURITY');

export interface PasswordSecurity {
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
}
