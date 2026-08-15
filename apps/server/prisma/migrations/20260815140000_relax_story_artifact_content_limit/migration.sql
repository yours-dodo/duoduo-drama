-- Agent-generated script artifacts embed scene images, dialogue audio and
-- video metadata as JSON, which can exceed the original 500k character cap.
ALTER TABLE "story_artifact_versions"
  DROP CONSTRAINT "story_artifact_versions_content_check";

ALTER TABLE "story_artifact_versions"
  ADD CONSTRAINT "story_artifact_versions_content_check"
  CHECK (
    CHAR_LENGTH("content") BETWEEN 1 AND 5000000
    AND "content" = BTRIM("content")
  );
