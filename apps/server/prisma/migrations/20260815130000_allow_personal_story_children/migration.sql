ALTER TABLE "conversations"
  DROP CONSTRAINT "conversations_tenant_id_fkey",
  ALTER COLUMN "tenant_id" DROP NOT NULL;

ALTER TABLE "messages"
  DROP CONSTRAINT "messages_tenant_id_fkey",
  ALTER COLUMN "tenant_id" DROP NOT NULL;

ALTER TABLE "story_generation_requests"
  DROP CONSTRAINT "story_generation_requests_tenant_id_fkey",
  ALTER COLUMN "tenant_id" DROP NOT NULL;

ALTER TABLE "story_artifacts"
  DROP CONSTRAINT "story_artifacts_tenant_id_fkey",
  ALTER COLUMN "tenant_id" DROP NOT NULL;

ALTER TABLE "story_artifact_versions"
  DROP CONSTRAINT "story_artifact_versions_tenant_id_fkey",
  ALTER COLUMN "tenant_id" DROP NOT NULL;
