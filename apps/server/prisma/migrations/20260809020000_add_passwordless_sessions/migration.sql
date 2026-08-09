CREATE TABLE "sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "sessions_revocation_check" CHECK (
    "revoked_at" IS NULL OR "revoked_at" >= "created_at"
  ),
  CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_created_at_idx"
  ON "sessions"("user_id", "created_at" DESC);
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

CREATE TABLE "identity_security_events" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "session_id" UUID,
  "action" VARCHAR(64) NOT NULL,
  "target_id" UUID NOT NULL,
  "request_id" VARCHAR(128) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "identity_security_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_security_events_action_check" CHECK (
    "action" IN ('LOGIN_CHALLENGE_LOCKED', 'SESSION_REVOKED')
  ),
  CONSTRAINT "identity_security_events_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "identity_security_events_session_id_fkey" FOREIGN KEY ("session_id")
    REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "identity_security_events_user_id_occurred_at_idx"
  ON "identity_security_events"("user_id", "occurred_at" DESC);
CREATE INDEX "identity_security_events_session_id_idx"
  ON "identity_security_events"("session_id");
CREATE INDEX "identity_security_events_action_occurred_at_idx"
  ON "identity_security_events"("action", "occurred_at" DESC);
