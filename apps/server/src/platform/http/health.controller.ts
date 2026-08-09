import {
  Controller,
  Get,
  Inject,
  VERSION_NEUTRAL,
  Version,
} from '@nestjs/common';

import { DatabaseReadinessService } from '../database/database-readiness.service.js';
import { ApplicationError } from './application-error.js';

interface HealthResponse {
  service: 'server';
  status: 'ok';
}

@Controller()
export class HealthController {
  constructor(
    @Inject(DatabaseReadinessService)
    private readonly databaseReadiness: DatabaseReadinessService,
  ) {}

  @Version(VERSION_NEUTRAL)
  @Get('health')
  health(): HealthResponse {
    return healthyResponse();
  }

  @Version(VERSION_NEUTRAL)
  @Get('ready')
  async ready(): Promise<HealthResponse> {
    if (!(await this.databaseReadiness.isReady())) {
      throw new ApplicationError({
        code: 'DATABASE_NOT_READY',
        message: 'The service is not ready',
        statusCode: 503,
      });
    }

    return healthyResponse();
  }
}

function healthyResponse(): HealthResponse {
  return { service: 'server', status: 'ok' };
}
