-- This migration assumes the current working schema already contains the
-- spaces table and story_projects.space_id/owner_user_id columns. It also
-- keeps the legacy tenant_id/visibility columns during the transition.

CREATE TABLE IF NOT EXISTS "spaces" (
  "id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "owner_user_id" UUID,
  "owner_team_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "spaces"
  ADD CONSTRAINT "spaces_kind_owner_check" CHECK (
    ("kind" = 'personal' AND "owner_user_id" IS NOT NULL AND "owner_team_id" IS NULL)
    OR
    ("kind" = 'team' AND "owner_user_id" IS NULL AND "owner_team_id" IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "spaces_personal_owner_user_key"
  ON "spaces"("owner_user_id") WHERE "kind" = 'personal';
CREATE UNIQUE INDEX IF NOT EXISTS "spaces_team_owner_team_key"
  ON "spaces"("owner_team_id") WHERE "kind" = 'team';
CREATE INDEX IF NOT EXISTS "spaces_kind_created_at_idx"
  ON "spaces"("kind", "created_at" DESC);

ALTER TABLE "spaces"
  ADD CONSTRAINT "spaces_owner_user_id_fkey" FOREIGN KEY ("owner_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "spaces"
  ADD CONSTRAINT "spaces_owner_team_id_fkey" FOREIGN KEY ("owner_team_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_projects"
  ADD COLUMN IF NOT EXISTS "space_id" UUID,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "owner_user_id" UUID;

INSERT INTO "spaces" ("id", "kind", "owner_user_id", "created_at", "updated_at")
SELECT md5('personal-space:' || u."id"::text)::uuid, 'personal', u."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" AS u
WHERE NOT EXISTS (
  SELECT 1 FROM "spaces" AS s
  WHERE s."kind" = 'personal' AND s."owner_user_id" = u."id"
);

INSERT INTO "spaces" ("id", "kind", "owner_team_id", "created_at", "updated_at")
SELECT md5('team-space:' || t."id"::text)::uuid, 'team', t."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "teams" AS t
WHERE NOT EXISTS (
  SELECT 1 FROM "spaces" AS s
  WHERE s."kind" = 'team' AND s."owner_team_id" = t."id"
);

UPDATE "story_projects" AS project
SET
  "space_id" = spaces."id",
  "owner_user_id" = COALESCE(project."owner_user_id", project."created_by_user_id")
FROM "spaces" AS spaces
WHERE spaces."kind" = 'team'
  AND spaces."owner_team_id" = project."tenant_id"
  AND project."space_id" IS NULL;

ALTER TABLE "story_projects"
  ALTER COLUMN "space_id" SET NOT NULL,
  ALTER COLUMN "owner_user_id" SET NOT NULL;

ALTER TABLE "story_projects"
  DROP CONSTRAINT IF EXISTS "story_projects_tenant_id_created_by_user_id_fkey",
  DROP CONSTRAINT IF EXISTS "story_projects_tenant_id_fkey";

ALTER TABLE "story_projects"
  ALTER COLUMN "tenant_id" DROP NOT NULL;

ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_space_id_fkey" FOREIGN KEY ("space_id")
    REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "story_projects_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "story_projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "idempotency_records"
  DROP CONSTRAINT IF EXISTS "idempotency_records_tenant_id_fkey";
ALTER TABLE "idempotency_records"
  ALTER COLUMN "tenant_id" DROP NOT NULL,
  ADD CONSTRAINT "idempotency_records_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_records"
  ADD COLUMN IF NOT EXISTS "space_id" UUID;
ALTER TABLE "audit_records"
  DROP CONSTRAINT IF EXISTS "audit_records_tenant_id_fkey";
ALTER TABLE "audit_records"
  ALTER COLUMN "tenant_id" DROP NOT NULL,
  ADD CONSTRAINT "audit_records_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "audit_records" AS audit
SET "space_id" = spaces."id"
FROM "spaces" AS spaces
WHERE spaces."kind" = 'team'
  AND spaces."owner_team_id" = audit."tenant_id"
  AND audit."space_id" IS NULL;

CREATE INDEX IF NOT EXISTS "audit_records_space_id_occurred_at_id_idx"
  ON "audit_records"("space_id", "occurred_at" DESC, "id");

ALTER TABLE "audit_records"
  ADD CONSTRAINT "audit_records_space_id_fkey" FOREIGN KEY ("space_id")
    REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
