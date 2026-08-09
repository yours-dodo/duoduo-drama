CREATE TABLE "team_invitations" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "invited_by_user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3),
  "accepted_by_user_id" UUID,
  "revoked_at" TIMESTAMPTZ(3),

  CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_invitations_email_check" CHECK (
    CHAR_LENGTH("email") BETWEEN 3 AND 254
    AND "email" = LOWER(BTRIM("email"))
  ),
  CONSTRAINT "team_invitations_token_hash_check" CHECK (
    "token_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "team_invitations_expiry_check" CHECK (
    "expires_at" > "created_at"
  ),
  CONSTRAINT "team_invitations_acceptance_pair_check" CHECK (
    ("accepted_at" IS NULL) = ("accepted_by_user_id" IS NULL)
  ),
  CONSTRAINT "team_invitations_terminal_state_check" CHECK (
    NOT ("accepted_at" IS NOT NULL AND "revoked_at" IS NOT NULL)
  ),
  CONSTRAINT "team_invitations_accepted_at_check" CHECK (
    "accepted_at" IS NULL
    OR ("accepted_at" >= "created_at" AND "accepted_at" < "expires_at")
  ),
  CONSTRAINT "team_invitations_revoked_at_check" CHECK (
    "revoked_at" IS NULL OR "revoked_at" >= "created_at"
  ),
  CONSTRAINT "team_invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "team_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "team_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "team_invitations_tenant_id_invited_by_user_id_fkey" FOREIGN KEY ("tenant_id", "invited_by_user_id")
    REFERENCES "team_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "team_invitations_tenant_id_accepted_by_user_id_fkey" FOREIGN KEY ("tenant_id", "accepted_by_user_id")
    REFERENCES "team_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "team_invitations_token_hash_key"
  ON "team_invitations"("token_hash");
CREATE INDEX "team_invitations_tenant_id_created_at_id_idx"
  ON "team_invitations"("tenant_id", "created_at" DESC, "id" DESC);
CREATE INDEX "team_invitations_tenant_id_email_state_idx"
  ON "team_invitations"("tenant_id", "email", "accepted_at", "revoked_at");
CREATE INDEX "team_invitations_expires_at_idx"
  ON "team_invitations"("expires_at");

ALTER TABLE "audit_records"
  ADD CONSTRAINT "audit_records_tenant_id_actor_user_id_fkey"
  FOREIGN KEY ("tenant_id", "actor_user_id")
  REFERENCES "team_memberships"("tenant_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
