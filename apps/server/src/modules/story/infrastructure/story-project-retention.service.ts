import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  SERVER_CONFIG,
  type ServerConfig,
} from '../../../config/server-config.js';
import { PurgeArchivedStoryProjects } from '../application/purge-archived-story-projects.js';

const RUN_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class StoryProjectRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(StoryProjectRetentionService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly purge: PurgeArchivedStoryProjects,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  onModuleInit(): void {
    if (
      this.config.environment === 'test' ||
      process.env.NODE_ENV === 'test' ||
      process.env.VITEST === 'true'
    ) {
      return;
    }
    void this.run();
    this.timer = setInterval(() => void this.run(), RUN_INTERVAL_MS);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.purge.execute();
    } catch (error) {
      this.logger.error(
        `Story project retention run failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
