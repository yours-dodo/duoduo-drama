import 'reflect-metadata';

import { Body, Controller, Get, Post, Req, Version } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../../test/create-test-app.js';
import type {
  RequestLogRecord,
  RequestLogSink,
} from '../observability/request-logging.interceptor.js';
import { ApplicationError } from './application-error.js';

class ProbeRequest {
  @IsString()
  @IsNotEmpty()
  title!: string;
}

@Controller('platform-probes')
class PlatformProbeController {
  @Version('1')
  @Post()
  create(@Body() body: ProbeRequest): ProbeRequest {
    return body;
  }

  @Version('1')
  @Get('context')
  context(
    @Req() requestContext: { cookies?: Record<string, string> },
  ): Record<string, string | null> {
    return { session: requestContext.cookies?.session ?? null };
  }

  @Version('1')
  @Get('application-error')
  applicationError(): never {
    throw new ApplicationError({
      code: 'PROBE_NOT_FOUND',
      message: 'The requested probe was not found',
      statusCode: 404,
      details: [{ field: 'probeId', issue: 'not_found' }],
    });
  }

  @Version('1')
  @Get('unexpected-error')
  unexpectedError(): never {
    throw new Error('database-password=must-never-leak');
  }
}

Reflect.defineMetadata(
  'design:paramtypes',
  [ProbeRequest],
  PlatformProbeController.prototype,
  'create',
);

class CapturingRequestLogSink implements RequestLogSink {
  readonly records: RequestLogRecord[] = [];

  write(record: RequestLogRecord): void {
    this.records.push(record);
  }
}

describe('HTTP platform', () => {
  let app: INestApplication;
  let requestLogSink: CapturingRequestLogSink;

  beforeEach(async () => {
    requestLogSink = new CapturingRequestLogSink();
    app = await createTestApp({
      controllers: [PlatformProbeController],
      requestLogSink,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(['/health', '/ready'])(
    'serves the version-neutral %s endpoint',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path).expect(200);

      expect(response.body).toEqual({ service: 'server', status: 'ok' });
    },
  );

  it('serves business routes under the v1 URI prefix and strips unknown DTO fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/platform-probes')
      .send({ title: 'probe', ignored: 'value' })
      .expect(201);

    expect(response.body).toEqual({ title: 'probe' });
    await request(app.getHttpServer())
      .post('/platform-probes')
      .send({ title: 'probe' })
      .expect(404);
  });

  it('returns validation failures through the stable error envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/platform-probes')
      .set('x-request-id', 'validation-request')
      .send({ title: '' })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        requestId: 'validation-request',
        details: ['title should not be empty'],
      },
    });
  });

  it('parses cookies and allows configured browser origins', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/platform-probes/context')
      .set('Cookie', 'session=session-value')
      .set('Origin', 'http://localhost:3000')
      .expect(200);

    expect(response.body).toEqual({ session: 'session-value' });
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('preserves a valid request ID on responses and application errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/platform-probes/application-error')
      .set('x-request-id', 'request-abc_123')
      .expect(404);

    expect(response.headers['x-request-id']).toBe('request-abc_123');
    expect(response.body).toEqual({
      error: {
        code: 'PROBE_NOT_FOUND',
        message: 'The requested probe was not found',
        requestId: 'request-abc_123',
        details: [{ field: 'probeId', issue: 'not_found' }],
      },
    });
  });

  it('replaces an invalid request ID with a generated UUID', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', '<script>alert(1)</script>')
      .expect(200);

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('does not expose unexpected error messages or stacks', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/platform-probes/unexpected-error')
      .set('x-request-id', 'unexpected-request')
      .expect(500);

    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        requestId: 'unexpected-request',
        details: [],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('database-password');
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });

  it('writes structured request metadata without headers, cookies, query values, or bodies', async () => {
    await request(app.getHttpServer())
      .post('/v1/platform-probes?token=secret-query')
      .set('x-request-id', 'logged-request')
      .set('Authorization', 'Bearer secret-token')
      .set('Cookie', 'session=secret-cookie')
      .send({ title: 'private story body' })
      .expect(201);

    expect(requestLogSink.records).toHaveLength(1);
    expect(requestLogSink.records[0]).toEqual({
      event: 'http.request.completed',
      service: 'server',
      environment: 'test',
      requestId: 'logged-request',
      method: 'POST',
      path: '/v1/platform-probes',
      statusCode: 201,
      durationMs: expect.any(Number),
    });

    const serializedRecord = JSON.stringify(requestLogSink.records[0]);
    expect(serializedRecord).not.toContain('secret-query');
    expect(serializedRecord).not.toContain('secret-token');
    expect(serializedRecord).not.toContain('secret-cookie');
    expect(serializedRecord).not.toContain('private story body');
  });
});
