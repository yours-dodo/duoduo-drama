ALTER TABLE "story_projects"
  ADD COLUMN "creation_mode" VARCHAR(16) NOT NULL DEFAULT 'standard';

ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_creation_mode_check" CHECK (
    "creation_mode" IN ('standard', 'immersive')
  );

ALTER TABLE "story_artifacts"
  DROP CONSTRAINT "story_artifacts_type_check";

UPDATE "story_artifacts"
SET "type" = CASE "type"
  WHEN 'idea' THEN 'outline'
  WHEN 'world_setting' THEN 'worldview'
  WHEN 'character' THEN 'roles'
  WHEN 'script' THEN 'story'
  ELSE "type"
END;

WITH ranked_modules AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "project_id", "type"
      ORDER BY "updated_at" DESC, "id" DESC
    ) AS module_rank
  FROM "story_artifacts"
  WHERE "status" = 'active'
)
UPDATE "story_artifacts" AS artifact
SET
  "status" = 'archived',
  "updated_at" = CURRENT_TIMESTAMP
FROM ranked_modules
WHERE artifact."id" = ranked_modules."id"
  AND ranked_modules.module_rank > 1;

UPDATE "story_artifacts"
SET
  "title" = CASE "type"
    WHEN 'outline' THEN '大纲'
    WHEN 'roles' THEN '角色资产'
    WHEN 'worldview' THEN '世界观'
    WHEN 'story' THEN '故事页'
    ELSE "title"
  END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'active';

INSERT INTO "story_artifacts" (
  "id",
  "tenant_id",
  "project_id",
  "type",
  "title",
  "status",
  "created_at",
  "updated_at"
)
SELECT
  md5('story-module:' || project."id"::text || ':' || module."type")::uuid,
  project."tenant_id",
  project."id",
  module."type",
  module."title",
  'active',
  project."created_at",
  CURRENT_TIMESTAMP
FROM "story_projects" AS project
CROSS JOIN (
  VALUES
    ('outline', '大纲'),
    ('roles', '角色资产'),
    ('worldview', '世界观'),
    ('story', '故事页')
) AS module("type", "title")
WHERE NOT EXISTS (
  SELECT 1
  FROM "story_artifacts" AS existing
  WHERE existing."project_id" = project."id"
    AND existing."type" = module."type"
    AND existing."status" = 'active'
);

ALTER TABLE "story_artifacts"
  ADD CONSTRAINT "story_artifacts_type_check" CHECK (
    "type" IN ('outline', 'roles', 'worldview', 'story')
  );

CREATE UNIQUE INDEX "story_artifacts_project_type_active_key"
  ON "story_artifacts"("project_id", "type")
  WHERE "status" = 'active';

CREATE INDEX "story_artifacts_project_type_status_idx"
  ON "story_artifacts"("project_id", "type", "status");

CREATE TABLE "story_import_jobs" (
  "id" UUID NOT NULL,
  "tenant_id" UUID,
  "project_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "source_file_name" VARCHAR(255) NOT NULL,
  "source_content_type" VARCHAR(128) NOT NULL,
  "source_byte_size" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "failure_code" VARCHAR(64),
  "processing_started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_import_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_import_jobs_source_file_name_check" CHECK (
    CHAR_LENGTH("source_file_name") BETWEEN 1 AND 255
    AND "source_file_name" = BTRIM("source_file_name")
  ),
  CONSTRAINT "story_import_jobs_source_content_type_check" CHECK (
    CHAR_LENGTH("source_content_type") BETWEEN 1 AND 128
    AND "source_content_type" = BTRIM("source_content_type")
  ),
  CONSTRAINT "story_import_jobs_source_byte_size_check" CHECK (
    "source_byte_size" BETWEEN 1 AND 20971520
  ),
  CONSTRAINT "story_import_jobs_status_check" CHECK (
    "status" IN ('pending', 'processing', 'succeeded', 'failed')
  ),
  CONSTRAINT "story_import_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_import_jobs_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "story_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_import_jobs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "story_import_jobs_project_created_id_idx"
  ON "story_import_jobs"("project_id", "created_at" DESC, "id" DESC);
CREATE INDEX "story_import_jobs_tenant_status_created_idx"
  ON "story_import_jobs"("tenant_id", "status", "created_at");
