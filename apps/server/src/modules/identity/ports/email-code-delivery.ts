import type { EmailCodePurpose } from '../../../domain/identity/email-verification-code.js';

export const EMAIL_CODE_DELIVERY = Symbol('EMAIL_CODE_DELIVERY');

export interface DeliverEmailCodeRequest {
  email: string;
  code: string;
  purpose: EmailCodePurpose;
  expiresAt: Date;
}

export interface EmailCodeDelivery {
  deliver(request: DeliverEmailCodeRequest): Promise<void>;
}
