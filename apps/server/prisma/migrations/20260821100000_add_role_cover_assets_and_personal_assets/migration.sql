ALTER TABLE "assets"
  ALTER COLUMN "tenant_id" DROP NOT NULL;

ALTER TABLE "assets"
  DROP CONSTRAINT "assets_tenant_id_fkey",
  DROP CONSTRAINT "assets_project_fkey",
  DROP CONSTRAINT "assets_uploaded_by_membership_fkey";

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "assets_project_fkey" FOREIGN KEY ("tenant_id", "project_id")
    REFERENCES "story_projects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "assets_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "story_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "assets_uploaded_by_membership_fkey" FOREIGN KEY ("tenant_id", "uploaded_by_user_id")
    REFERENCES "team_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_role_assets"
  ADD COLUMN "cover_asset_id" UUID,
  ADD CONSTRAINT "story_role_assets_cover_asset_id_fkey" FOREIGN KEY ("cover_asset_id")
    REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "story_role_assets_cover_asset_fkey" FOREIGN KEY ("tenant_id", "cover_asset_id")
    REFERENCES "assets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "story_role_assets_tenant_cover_asset_id_idx"
  ON "story_role_assets"("tenant_id", "cover_asset_id");
