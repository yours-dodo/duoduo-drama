CREATE TABLE "story_artifacts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "type" VARCHAR(32) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "current_version_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_artifacts_type_check" CHECK (
    "type" IN ('idea', 'world_setting', 'character', 'outline', 'script')
  ),
  CONSTRAINT "story_artifacts_title_check" CHECK (
    CHAR_LENGTH("title") BETWEEN 1 AND 200
    AND "title" = BTRIM("title")
  ),
  CONSTRAINT "story_artifacts_status_check" CHECK (
    "status" IN ('active', 'archived')
  ),
  CONSTRAINT "story_artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_artifacts_project_fkey" FOREIGN KEY ("tenant_id", "project_id")
    REFERENCES "story_projects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_artifacts_tenant_id_id_key"
  ON "story_artifacts"("tenant_id", "id");
CREATE UNIQUE INDEX "story_artifacts_tenant_id_current_version_id_key"
  ON "story_artifacts"("tenant_id", "current_version_id");
CREATE INDEX "story_artifacts_tenant_id_project_id_created_at_id_idx"
  ON "story_artifacts"("tenant_id", "project_id", "created_at" DESC, "id" DESC);
CREATE INDEX "story_artifacts_tenant_project_type_status_idx"
  ON "story_artifacts"("tenant_id", "project_id", "type", "status", "created_at" DESC);

CREATE TABLE "story_artifact_versions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "artifact_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "content_format" VARCHAR(16) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
  "source_type" VARCHAR(16) NOT NULL,
  "source_message_id" UUID,
  "generation_request_id" UUID,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_artifact_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_artifact_versions_version_number_check" CHECK (
    "version_number" >= 1
  ),
  CONSTRAINT "story_artifact_versions_content_check" CHECK (
    CHAR_LENGTH("content") BETWEEN 1 AND 500000
    AND "content" = BTRIM("content")
  ),
  CONSTRAINT "story_artifact_versions_content_format_check" CHECK (
    "content_format" IN ('markdown', 'text')
  ),
  CONSTRAINT "story_artifact_versions_status_check" CHECK (
    "status" IN ('draft', 'confirmed', 'discarded')
  ),
  CONSTRAINT "story_artifact_versions_source_type_check" CHECK (
    "source_type" IN ('user', 'agent', 'import')
  ),
  CONSTRAINT "story_artifact_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_artifact_versions_artifact_fkey" FOREIGN KEY ("tenant_id", "artifact_id")
    REFERENCES "story_artifacts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_artifact_versions_source_message_fkey" FOREIGN KEY ("tenant_id", "source_message_id")
    REFERENCES "messages"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_artifact_versions_generation_request_fkey" FOREIGN KEY ("tenant_id", "generation_request_id")
    REFERENCES "story_generation_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_artifact_versions_created_by_user_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_artifact_versions_created_by_membership_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id")
    REFERENCES "team_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_artifact_versions_tenant_id_id_key"
  ON "story_artifact_versions"("tenant_id", "id");
CREATE UNIQUE INDEX "story_artifact_versions_tenant_artifact_version_key"
  ON "story_artifact_versions"("tenant_id", "artifact_id", "version_number");
CREATE INDEX "story_artifact_versions_tenant_artifact_created_id_idx"
  ON "story_artifact_versions"("tenant_id", "artifact_id", "created_at" DESC, "id" DESC);
CREATE INDEX "story_artifact_versions_tenant_source_message_idx"
  ON "story_artifact_versions"("tenant_id", "source_message_id");
CREATE INDEX "story_artifact_versions_tenant_generation_request_idx"
  ON "story_artifact_versions"("tenant_id", "generation_request_id");

ALTER TABLE "story_artifacts"
  ADD CONSTRAINT "story_artifacts_current_version_fkey"
  FOREIGN KEY ("tenant_id", "current_version_id")
  REFERENCES "story_artifact_versions"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
