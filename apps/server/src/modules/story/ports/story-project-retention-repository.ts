export const STORY_PROJECT_RETENTION_REPOSITORY = Symbol(
  'STORY_PROJECT_RETENTION_REPOSITORY',
);

export interface ExpiredStoryProject {
  id: string;
  tenantId: string | null;
  spaceId: string;
  ownerUserId: string;
  purgeAt: Date;
  objectKeys: string[];
}

export interface StoryProjectRetentionRepository {
  claimExpired(input: {
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<ExpiredStoryProject[]>;
  purgeProject(input: { projectId: string; now: Date }): Promise<boolean>;
}
