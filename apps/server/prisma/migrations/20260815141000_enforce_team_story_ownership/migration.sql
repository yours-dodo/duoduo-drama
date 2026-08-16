ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_tenant_created_by_user_fkey"
  FOREIGN KEY ("tenant_id", "created_by_user_id")
  REFERENCES "team_memberships"("tenant_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "story_projects_tenant_owner_user_fkey"
  FOREIGN KEY ("tenant_id", "owner_user_id")
  REFERENCES "team_memberships"("tenant_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_import_jobs"
  ADD CONSTRAINT "story_import_jobs_tenant_created_by_user_fkey"
  FOREIGN KEY ("tenant_id", "created_by_user_id")
  REFERENCES "team_memberships"("tenant_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
