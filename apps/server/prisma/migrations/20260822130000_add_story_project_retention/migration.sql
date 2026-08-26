ALTER TABLE "story_projects"
  ADD COLUMN "archived_at" TIMESTAMPTZ(3),
  ADD COLUMN "purge_at" TIMESTAMPTZ(3),
  ADD COLUMN "purge_started_at" TIMESTAMPTZ(3);

UPDATE "story_projects"
SET
  "archived_at" = CURRENT_TIMESTAMP,
  "purge_at" = CURRENT_TIMESTAMP + INTERVAL '30 days'
WHERE "status" = 'archived';

CREATE INDEX "story_projects_status_purge_at_idx"
  ON "story_projects"("status", "purge_at");
