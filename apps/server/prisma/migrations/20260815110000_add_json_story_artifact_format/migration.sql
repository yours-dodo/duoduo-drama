-- Allow agent-generated structured script artifacts (linear story JSON) in
-- addition to human-edited markdown/text drafts.
ALTER TABLE "story_artifact_versions"
  DROP CONSTRAINT "story_artifact_versions_content_format_check";

ALTER TABLE "story_artifact_versions"
  ADD CONSTRAINT "story_artifact_versions_content_format_check"
  CHECK ("content_format" IN ('markdown', 'text', 'json'));
