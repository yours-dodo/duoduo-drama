import type { ServerEnvironment } from '../../../config/server-config.js';
import type {
  DeliverLoginEmailRequest,
  EmailDelivery,
} from '../ports/email-delivery.js';

export interface LocalLoginEmail {
  email: string;
  token: string;
  magicLink: string;
  expiresAt: Date;
}

export class LocalEmailDelivery implements EmailDelivery {
  private latest: LocalLoginEmail | null = null;

  constructor(
    private readonly environment: ServerEnvironment,
    private readonly publicWebUrl: string,
  ) {
    if (environment === 'production') {
      throw new Error('Local email delivery cannot run in production');
    }
  }

  async deliver(request: DeliverLoginEmailRequest): Promise<void> {
    const magicLink = new URL('/auth/email-login', this.publicWebUrl);
    magicLink.searchParams.set('token', request.token);

    this.latest = {
      email: request.email,
      token: request.token,
      magicLink: magicLink.toString(),
      expiresAt: new Date(request.expiresAt),
    };
  }

  readLatestForTest(): LocalLoginEmail | null {
    if (this.environment !== 'test') {
      throw new Error('Local email inspection is available only in tests');
    }

    if (this.latest === null) {
      return null;
    }

    return {
      ...this.latest,
      expiresAt: new Date(this.latest.expiresAt),
    };
  }
}
