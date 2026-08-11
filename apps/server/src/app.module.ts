import { Module } from '@nestjs/common';

import { ServerConfigModule } from './config/server-config.module.js';
import { AssetsModule } from './modules/assets/assets.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';
import { StoryModule } from './modules/story/story.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { HealthController } from './platform/http/health.controller.js';

@Module({
  imports: [
    ServerConfigModule,
    DatabaseModule,
    IdentityModule,
    TenancyModule,
    StoryModule,
    AssetsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
