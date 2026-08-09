CREATE TABLE "teams" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "teams_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teams_name_check" CHECK (
    CHAR_LENGTH("name") BETWEEN 1 AND 100 AND "name" = BTRIM("name")
  ),
  CONSTRAINT "teams_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "teams_created_by_user_id_created_at_idx"
  ON "teams"("created_by_user_id", "created_at" DESC);

CREATE TABLE "team_memberships" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" VARCHAR(16) NOT NULL,
  "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(3),

  CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_memberships_role_check" CHECK ("role" IN ('admin', 'member')),
  CONSTRAINT "team_memberships_removed_at_check" CHECK (
    "removed_at" IS NULL OR "removed_at" >= "joined_at"
  ),
  CONSTRAINT "team_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "team_memberships_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "team_memberships_tenant_id_user_id_key"
  ON "team_memberships"("tenant_id", "user_id");
CREATE UNIQUE INDEX "team_memberships_tenant_id_id_key"
  ON "team_memberships"("tenant_id", "id");
CREATE INDEX "team_memberships_user_id_removed_at_idx"
  ON "team_memberships"("user_id", "removed_at");
CREATE INDEX "team_memberships_tenant_id_role_removed_at_idx"
  ON "team_memberships"("tenant_id", "role", "removed_at");

CREATE TABLE "idempotency_records" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "scope_key" VARCHAR(200) NOT NULL,
  "operation_type" VARCHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "result_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "idempotency_records_request_hash_check" CHECK (
    "request_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "idempotency_records_create_team_result_check" CHECK (
    "operation_type" <> 'CREATE_TEAM' OR "result_id" = "tenant_id"
  ),
  CONSTRAINT "idempotency_records_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "idempotency_records_scope_operation_key_key"
  ON "idempotency_records"("scope_key", "operation_type", "idempotency_key");
CREATE INDEX "idempotency_records_tenant_id_created_at_idx"
  ON "idempotency_records"("tenant_id", "created_at" DESC);

CREATE TABLE "audit_records" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "target_type" VARCHAR(64) NOT NULL,
  "target_id" UUID NOT NULL,
  "before_summary" JSONB,
  "after_summary" JSONB,
  "request_id" VARCHAR(128) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_records_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "audit_records_actor_user_id_fkey" FOREIGN KEY ("actor_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "audit_records_tenant_id_occurred_at_id_idx"
  ON "audit_records"("tenant_id", "occurred_at" DESC, "id");
CREATE INDEX "audit_records_actor_user_id_occurred_at_idx"
  ON "audit_records"("actor_user_id", "occurred_at" DESC);
