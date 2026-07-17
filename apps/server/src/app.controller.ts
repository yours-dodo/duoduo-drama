import { Controller, Get } from '@nestjs/common';

interface HealthResponse {
  service: 'server';
  status: 'ok';
}

@Controller()
export class AppController {
  @Get('health')
  health(): HealthResponse {
    return { service: 'server', status: 'ok' };
  }
}
