ALTER TABLE "project_collaborators"
  ADD COLUMN "role" VARCHAR(16),
  ADD COLUMN "updated_at" TIMESTAMPTZ(3),
  ADD COLUMN "revoked_at" TIMESTAMPTZ(3);

UPDATE "project_collaborators"
SET
  "role" = 'editor',
  "updated_at" = "created_at"
WHERE "role" IS NULL;

ALTER TABLE "project_collaborators"
  ALTER COLUMN "role" SET NOT NULL,
  ALTER COLUMN "updated_at" SET NOT NULL,
  ADD CONSTRAINT "project_collaborators_role_check"
    CHECK ("role" IN ('viewer', 'editor', 'manager'));

DROP INDEX IF EXISTS "project_collaborators_tenant_id_project_id_user_id_key";

CREATE UNIQUE INDEX "project_collaborators_active_project_user_key"
  ON "project_collaborators"("tenant_id", "project_id", "user_id")
  WHERE "revoked_at" IS NULL;

CREATE INDEX "project_collaborators_project_revoked_created_idx"
  ON "project_collaborators"("tenant_id", "project_id", "revoked_at", "created_at" DESC, "id" DESC);

CREATE TABLE "project_collaborator_permission_overrides" (
  "id" UUID NOT NULL,
  "collaborator_id" UUID NOT NULL,
  "permission_key" VARCHAR(64) NOT NULL,
  "effect" VARCHAR(8) NOT NULL,
  "granted_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_collaborator_permission_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_collaborator_permission_overrides_permission_check"
    CHECK ("permission_key" = 'project.archive'),
  CONSTRAINT "project_collaborator_permission_overrides_effect_check"
    CHECK ("effect" IN ('allow', 'deny')),
  CONSTRAINT "project_collaborator_permission_overrides_collaborator_fkey"
    FOREIGN KEY ("collaborator_id")
    REFERENCES "project_collaborators"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_collaborator_permission_overrides_granted_by_user_fkey"
    FOREIGN KEY ("granted_by_user_id")
    REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "project_collab_permission_key_key"
  ON "project_collaborator_permission_overrides"("collaborator_id", "permission_key");

CREATE INDEX "project_collaborator_permission_overrides_permission_effect_idx"
  ON "project_collaborator_permission_overrides"("permission_key", "effect");
