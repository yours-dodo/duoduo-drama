import { Controller, Get, VERSION_NEUTRAL, Version } from '@nestjs/common';

interface HealthResponse {
  service: 'agent';
  status: 'ok';
}

@Controller()
export class HealthController {
  @Version(VERSION_NEUTRAL)
  @Get('health')
  health(): HealthResponse {
    return { service: 'agent', status: 'ok' };
  }
}
