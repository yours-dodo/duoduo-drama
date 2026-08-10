ALTER TABLE "story_generation_requests"
  ADD COLUMN "failure_code" VARCHAR(32),
  ADD COLUMN "processing_started_at" TIMESTAMPTZ(3),
  ADD COLUMN "completed_at" TIMESTAMPTZ(3),
  ADD COLUMN "agent_message_id" UUID,
  ADD COLUMN "artifact_id" UUID,
  ADD COLUMN "artifact_version_id" UUID;

ALTER TABLE "story_generation_requests"
  ADD CONSTRAINT "story_generation_requests_failure_code_check" CHECK (
    "failure_code" IS NULL
    OR "failure_code" IN ('agent_unavailable', 'timeout', 'protocol_error')
  ),
  ADD CONSTRAINT "story_generation_requests_completed_at_check" CHECK (
    ("status" IN ('pending', 'processing') AND "completed_at" IS NULL)
    OR ("status" IN ('succeeded', 'failed') AND "completed_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "story_generation_requests_succeeded_result_check" CHECK (
    "status" <> 'succeeded'
    OR ("agent_message_id" IS NOT NULL AND "artifact_id" IS NOT NULL AND "artifact_version_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "story_generation_requests_failed_code_check" CHECK (
    "status" <> 'failed' OR "failure_code" IS NOT NULL
  );

CREATE INDEX "story_generation_requests_tenant_artifact_result_idx"
  ON "story_generation_requests"("tenant_id", "artifact_id", "artifact_version_id");
