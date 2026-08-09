import { Controller, Get, VERSION_NEUTRAL, Version } from '@nestjs/common';

interface HealthResponse {
  service: 'server';
  status: 'ok';
}

@Controller()
export class HealthController {
  @Version(VERSION_NEUTRAL)
  @Get('health')
  health(): HealthResponse {
    return healthyResponse();
  }

  @Version(VERSION_NEUTRAL)
  @Get('ready')
  ready(): HealthResponse {
    return healthyResponse();
  }
}

function healthyResponse(): HealthResponse {
  return { service: 'server', status: 'ok' };
}
