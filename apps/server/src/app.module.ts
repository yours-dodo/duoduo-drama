import { Module } from '@nestjs/common';

import { ServerConfigModule } from './config/server-config.module.js';
import { HealthController } from './platform/http/health.controller.js';

@Module({
  imports: [ServerConfigModule],
  controllers: [HealthController],
})
export class AppModule {}
