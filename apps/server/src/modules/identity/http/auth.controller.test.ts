import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  RequestLogRecord,
  RequestLogSink,
} from '../../../platform/observability/request-logging.interceptor.js';
import { createTestApp } from '../../../test/create-test-app.js';
import { RequestEmailCode } from '../application/request-email-code.js';
import { LocalEmailDelivery } from '../infrastructure/local-email-delivery.js';
import { EMAIL_DELIVERY } from '../ports/email-delivery.js';
import {
  LOGIN_CHALLENGE_REPOSITORY,
  type CreateLoginChallengeRequest,
} from '../ports/login-challenge-repository.js';

class CapturingRequestLogSink implements RequestLogSink {
  readonly records: RequestLogRecord[] = [];

  write(record: RequestLogRecord): void {
    this.records.push(record);
  }
}

describe('AuthController', () => {
  let app: INestApplication;
  let createIfAllowed: ReturnType<typeof vi.fn>;
  let requestEmailCode: { execute: ReturnType<typeof vi.fn> };
  let requestLogSink: CapturingRequestLogSink;

  beforeEach(async () => {
    createIfAllowed = vi.fn(async (request: CreateLoginChallengeRequest) => ({
      created: true,
      challenge: request.challenge,
    }));
    requestLogSink = new CapturingRequestLogSink();
    requestEmailCode = {
      execute: vi.fn(async () => ({
        message:
          'If the address can receive email, a verification code was sent.',
      })),
    };
    app = await createTestApp({
      requestLogSink,
      providerOverrides: [
        {
          token: LOGIN_CHALLENGE_REPOSITORY,
          value: {
            createIfAllowed,
            findActiveByTokenHash: vi.fn(),
          },
        },
        { token: RequestEmailCode, value: requestEmailCode },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts an email login request without exposing account existence', async () => {
    const first = await request(app.getHttpServer())
      .post('/v1/auth/email-login-requests')
      .set('x-request-id', 'email-login-request')
      .set('x-forwarded-for', '203.0.113.9')
      .send({ email: '  Writer@Example.COM ' })
      .expect(202);
    createIfAllowed.mockResolvedValueOnce({ created: false });
    const second = await request(app.getHttpServer())
      .post('/v1/auth/email-login-requests')
      .send({ email: 'unknown@example.com' })
      .expect(202);

    const acceptedResponse = {
      message:
        'If the address can receive email, sign-in instructions were sent.',
    };
    expect(first.body).toEqual(acceptedResponse);
    expect(second.body).toEqual(acceptedResponse);

    const localDelivery = app.get<LocalEmailDelivery>(EMAIL_DELIVERY);
    const delivered = localDelivery.readLatestForTest();
    expect(delivered).toMatchObject({ email: 'writer@example.com' });
    expect(delivered?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(createIfAllowed.mock.calls)).not.toContain(
      delivered?.token,
    );
    expect(JSON.stringify(requestLogSink.records)).not.toContain(
      delivered?.token,
    );
    expect(createIfAllowed.mock.calls[0]?.[0]).toMatchObject({
      challenge: {
        sourceDigest:
          '349653c0fbb8666f757e99688061469b465aab26039b1bfaf8453a9cfc7112e2',
      },
    });
  });

  it('returns invalid email input through the stable validation envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/email-login-requests')
      .set('x-request-id', 'invalid-email-request')
      .send({ email: 'not-an-email' })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        requestId: 'invalid-email-request',
        details: ['email must be a valid email address'],
      },
    });
    expect(createIfAllowed).not.toHaveBeenCalled();
  });

  it('requests login and password-reset codes through the same safe response', async () => {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/email-code-requests')
      .send({ email: 'Writer@Example.COM' })
      .expect(202);
    const reset = await request(app.getHttpServer())
      .post('/v1/auth/password-reset-requests')
      .send({ email: 'Writer@Example.COM' })
      .expect(202);

    const response = {
      message:
        'If the address can receive email, a verification code was sent.',
    };
    expect(login.body).toEqual(response);
    expect(reset.body).toEqual(response);
    expect(requestEmailCode.execute).toHaveBeenNthCalledWith(1, {
      email: 'Writer@Example.COM',
      sourceAddress: expect.any(String),
      purpose: 'login',
    });
    expect(requestEmailCode.execute).toHaveBeenNthCalledWith(2, {
      email: 'Writer@Example.COM',
      sourceAddress: expect.any(String),
      purpose: 'password_reset',
    });
  });
});
