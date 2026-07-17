import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@duoduo/contracts';

@Controller()
export class AppController {
  @Get('health')
  health(): HealthResponse {
    return { service: 'server', status: 'ok' };
  }
}
