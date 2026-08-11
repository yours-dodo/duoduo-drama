import { createHmac, randomInt } from 'node:crypto';

import type { EmailCodePurpose } from '../../../domain/identity/email-verification-code.js';
import type { EmailCodeSecurity } from '../ports/email-code-security.js';

export class NodeEmailCodeSecurity implements EmailCodeSecurity {
  constructor(private readonly pepper: string) {}

  issueCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hashCode(email: string, purpose: EmailCodePurpose, code: string): string {
    return this.digest('email-code', `${purpose}\0${email}\0${code}`);
  }

  digestSource(sourceAddress: string): string {
    return this.digest('email-code-source', sourceAddress.trim());
  }

  private digest(purpose: string, value: string): string {
    return createHmac('sha256', this.pepper)
      .update(purpose)
      .update('\0')
      .update(value)
      .digest('hex');
  }
}
