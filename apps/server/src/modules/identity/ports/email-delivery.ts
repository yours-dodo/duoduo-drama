export const EMAIL_DELIVERY = Symbol('EMAIL_DELIVERY');

export interface DeliverLoginEmailRequest {
  email: string;
  token: string;
  expiresAt: Date;
}

export interface EmailDelivery {
  deliver(request: DeliverLoginEmailRequest): Promise<void>;
}
