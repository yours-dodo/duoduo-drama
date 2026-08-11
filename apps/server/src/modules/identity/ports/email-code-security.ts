import type { EmailCodePurpose } from '../../../domain/identity/email-verification-code.js';

export const EMAIL_CODE_SECURITY = Symbol('EMAIL_CODE_SECURITY');

export interface EmailCodeSecurity {
  issueCode(): string;
  hashCode(email: string, purpose: EmailCodePurpose, code: string): string;
  digestSource(sourceAddress: string): string;
}
