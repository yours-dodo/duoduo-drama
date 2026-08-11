import type { ServerEnvironment } from '../../../config/server-config.js';
import type {
  DeliverEmailCodeRequest,
  EmailCodeDelivery,
} from '../ports/email-code-delivery.js';

export interface LatestEmailCode {
  email: string;
  code: string;
  purpose: DeliverEmailCodeRequest['purpose'];
  expiresAt: Date;
}

export class ConsoleEmailCodeDelivery implements EmailCodeDelivery {
  private latest: LatestEmailCode | null = null;

  constructor(private readonly environment: ServerEnvironment) {
    if (environment === 'production') {
      throw new Error('Console email code delivery cannot run in production');
    }
  }

  async deliver(request: DeliverEmailCodeRequest): Promise<void> {
    this.latest = {
      email: request.email,
      code: request.code,
      purpose: request.purpose,
      expiresAt: new Date(request.expiresAt),
    };

    if (this.environment === 'development') {
      console.info(
        `[auth] email code purpose=${request.purpose} email=${request.email} code=${request.code} expiresAt=${request.expiresAt.toISOString()}`,
      );
    }
  }

  readLatestForTest(): LatestEmailCode | null {
    if (this.environment !== 'test') {
      throw new Error(
        'Console email code inspection is available only in tests',
      );
    }

    return this.latest === null
      ? null
      : { ...this.latest, expiresAt: new Date(this.latest.expiresAt) };
  }
}
