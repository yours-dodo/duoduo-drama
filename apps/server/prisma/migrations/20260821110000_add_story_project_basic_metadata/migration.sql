ALTER TABLE "story_projects"
  ADD COLUMN "description" VARCHAR(2000) NOT NULL DEFAULT '',
  ADD COLUMN "era" VARCHAR(16) NOT NULL DEFAULT '现代',
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_era_check"
  CHECK ("era" IN ('现代', '古代'));

ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_description_check"
  CHECK (CHAR_LENGTH("description") <= 2000 AND "description" = BTRIM("description"));

ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_tags_count_check"
  CHECK (CARDINALITY("tags") <= 16);
