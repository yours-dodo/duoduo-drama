CREATE TABLE "assets" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "uploaded_by_user_id" UUID NOT NULL,
  "object_key" VARCHAR(512) NOT NULL,
  "original_file_name" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(128) NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "checksum" CHAR(64),
  "status" VARCHAR(24) NOT NULL DEFAULT 'pending_upload',
  "upload_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assets_file_name_check" CHECK (
    CHAR_LENGTH("original_file_name") BETWEEN 1 AND 255
    AND "original_file_name" = BTRIM("original_file_name")
  ),
  CONSTRAINT "assets_content_type_check" CHECK (
    "content_type" IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  CONSTRAINT "assets_byte_size_check" CHECK (
    "byte_size" BETWEEN 1 AND 20971520
  ),
  CONSTRAINT "assets_status_check" CHECK (
    "status" IN ('pending_upload', 'uploaded', 'failed', 'deleted')
  ),
  CONSTRAINT "assets_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assets_project_fkey" FOREIGN KEY ("tenant_id", "project_id")
    REFERENCES "story_projects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assets_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assets_uploaded_by_membership_fkey" FOREIGN KEY ("tenant_id", "uploaded_by_user_id")
    REFERENCES "team_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "assets_object_key_key"
  ON "assets"("object_key");
CREATE UNIQUE INDEX "assets_tenant_id_id_key"
  ON "assets"("tenant_id", "id");
CREATE INDEX "assets_tenant_id_project_id_created_at_id_idx"
  ON "assets"("tenant_id", "project_id", "created_at" DESC, "id" DESC);
CREATE INDEX "assets_tenant_id_project_id_status_idx"
  ON "assets"("tenant_id", "project_id", "status", "created_at" DESC, "id" DESC);
