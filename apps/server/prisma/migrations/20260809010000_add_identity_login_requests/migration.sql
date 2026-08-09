CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_email_normalized_check" CHECK (
    "email" = LOWER(BTRIM("email"))
  )
);

CREATE TABLE "email_login_challenges" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "attempt_count" SMALLINT NOT NULL DEFAULT 0,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_login_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_login_challenges_email_normalized_check" CHECK (
    "email" = LOWER(BTRIM("email"))
  ),
  CONSTRAINT "email_login_challenges_attempt_count_check" CHECK (
    "attempt_count" >= 0
  ),
  CONSTRAINT "email_login_challenges_expiry_check" CHECK (
    "expires_at" > "created_at"
  )
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "email_login_challenges_token_hash_key"
  ON "email_login_challenges"("token_hash");
CREATE INDEX "email_login_challenges_email_created_at_idx"
  ON "email_login_challenges"("email", "created_at" DESC);
CREATE INDEX "email_login_challenges_source_created_at_idx"
  ON "email_login_challenges"("source_digest", "created_at" DESC);
CREATE INDEX "email_login_challenges_expires_at_idx"
  ON "email_login_challenges"("expires_at");
