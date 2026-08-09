import { Module } from '@nestjs/common';

import { ServerConfigModule } from './config/server-config.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { HealthController } from './platform/http/health.controller.js';

@Module({
  imports: [ServerConfigModule, DatabaseModule, IdentityModule],
  controllers: [HealthController],
})
export class AppModule {}
