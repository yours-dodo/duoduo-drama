import { Module } from '@nestjs/common';

import { ServerConfigModule } from './config/server-config.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { HealthController } from './platform/http/health.controller.js';

@Module({
  imports: [ServerConfigModule, DatabaseModule],
  controllers: [HealthController],
})
export class AppModule {}
