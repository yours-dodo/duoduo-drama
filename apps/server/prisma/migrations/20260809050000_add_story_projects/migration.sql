CREATE TABLE "story_projects" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "visibility" VARCHAR(16) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_projects_title_check" CHECK (
    CHAR_LENGTH("title") BETWEEN 1 AND 200
    AND "title" = BTRIM("title")
  ),
  CONSTRAINT "story_projects_visibility_check" CHECK ("visibility" IN ('team', 'private')),
  CONSTRAINT "story_projects_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "story_projects_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "story_projects_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_projects_tenant_id_created_by_user_id_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id")
    REFERENCES "team_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_projects_tenant_id_id_key"
  ON "story_projects"("tenant_id", "id");
CREATE INDEX "story_projects_tenant_id_created_at_id_idx"
  ON "story_projects"("tenant_id", "created_at" DESC, "id" DESC);
CREATE INDEX "story_projects_tenant_id_visibility_status_idx"
  ON "story_projects"("tenant_id", "visibility", "status", "created_at" DESC);

CREATE TABLE "project_collaborators" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_collaborators_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_collaborators_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_collaborators_project_fkey" FOREIGN KEY ("tenant_id", "project_id")
    REFERENCES "story_projects"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_collaborators_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_collaborators_membership_fkey" FOREIGN KEY ("tenant_id", "user_id")
    REFERENCES "team_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "project_collaborators_tenant_id_id_key"
  ON "project_collaborators"("tenant_id", "id");
CREATE UNIQUE INDEX "project_collaborators_tenant_id_project_id_user_id_key"
  ON "project_collaborators"("tenant_id", "project_id", "user_id");
CREATE INDEX "project_collaborators_tenant_id_project_id_created_at_id_idx"
  ON "project_collaborators"("tenant_id", "project_id", "created_at" DESC, "id" DESC);
