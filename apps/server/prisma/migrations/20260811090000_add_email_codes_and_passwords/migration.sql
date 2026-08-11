ALTER TABLE "users"
ADD COLUMN "password_hash" VARCHAR(255);

CREATE TABLE "email_verification_codes" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "purpose" VARCHAR(32) NOT NULL,
  "code_hash" CHAR(64) NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "attempt_count" SMALLINT NOT NULL DEFAULT 0,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_verification_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_verification_codes_email_normalized_check" CHECK (
    "email" = LOWER(BTRIM("email"))
  ),
  CONSTRAINT "email_verification_codes_purpose_check" CHECK (
    "purpose" IN ('login', 'password_reset')
  ),
  CONSTRAINT "email_verification_codes_attempt_count_check" CHECK (
    "attempt_count" >= 0
  ),
  CONSTRAINT "email_verification_codes_expiry_check" CHECK (
    "expires_at" > "created_at"
  )
);

CREATE INDEX "email_verification_codes_email_purpose_created_at_idx"
  ON "email_verification_codes"("email", "purpose", "created_at" DESC);
CREATE INDEX "email_verification_codes_source_purpose_created_at_idx"
  ON "email_verification_codes"("source_digest", "purpose", "created_at" DESC);
CREATE INDEX "email_verification_codes_expires_at_idx"
  ON "email_verification_codes"("expires_at");
