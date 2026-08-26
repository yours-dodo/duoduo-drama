ALTER TABLE "story_role_assets"
  ADD COLUMN "view_asset_id" UUID,
  ADD CONSTRAINT "story_role_assets_view_asset_id_fkey" FOREIGN KEY ("view_asset_id")
    REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "story_role_assets_view_asset_fkey" FOREIGN KEY ("tenant_id", "view_asset_id")
    REFERENCES "assets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "story_role_assets_tenant_view_asset_id_idx"
  ON "story_role_assets"("tenant_id", "view_asset_id");
