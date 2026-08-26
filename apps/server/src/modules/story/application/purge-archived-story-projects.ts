import { Logger } from '@nestjs/common';

import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { ObjectStorage } from '../../../platform/object-storage/object-storage.js';
import type { TransactionRunner } from '../../../platform/database/transaction-runner.js';
import type { DatabaseClock } from '../../../platform/database/database-clock.js';
import type { StoryProjectRetentionRepository } from '../ports/story-project-retention-repository.js';

const BATCH_SIZE = 20;
const LEASE_MS = 2 * 60 * 60 * 1000;

export class PurgeArchivedStoryProjects {
  private readonly logger = new Logger(PurgeArchivedStoryProjects.name);

  constructor(
    private readonly retention: StoryProjectRetentionRepository,
    private readonly objectStorage: ObjectStorage,
    private readonly audit: AuditRepository,
    private readonly transactions: Pick<TransactionRunner, 'run'>,
    private readonly databaseClock: Pick<DatabaseClock, 'now'>,
    private readonly ids: { create(): string },
  ) {}

  async execute(): Promise<{
    claimed: number;
    purged: number;
    failed: number;
  }> {
    const now = await this.databaseClock.now();
    const claimed = await this.retention.claimExpired({
      now,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      limit: BATCH_SIZE,
    });
    let purged = 0;
    let failed = 0;

    for (const project of claimed) {
      try {
        for (const objectKey of project.objectKeys) {
          await this.objectStorage.deleteObject(objectKey);
        }
        const deleted = await this.transactions.run(async () => {
          const removed = await this.retention.purgeProject({
            projectId: project.id,
            now,
          });
          if (removed) {
            await this.audit.record({
              id: this.ids.create(),
              tenantId: project.tenantId,
              spaceId: project.spaceId,
              actorUserId: project.ownerUserId,
              action: 'STORY_PROJECT_PURGED',
              targetType: 'STORY_PROJECT',
              targetId: project.id,
              beforeSummary: {
                status: 'archived',
                purgeAt: project.purgeAt.toISOString(),
              },
              afterSummary: { status: 'purged' },
              requestId: `retention:${project.id}:${now.getTime()}`,
              occurredAt: now,
            });
          }
          return removed;
        });
        if (deleted) purged += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Story project purge failed for ${project.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { claimed: claimed.length, purged, failed };
  }
}
