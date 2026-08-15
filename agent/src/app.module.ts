import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { StoryScriptsModule } from './story-scripts.module.js';

@Module({
  imports: [StoryScriptsModule],
  controllers: [HealthController],
})
export class AppModule {}
