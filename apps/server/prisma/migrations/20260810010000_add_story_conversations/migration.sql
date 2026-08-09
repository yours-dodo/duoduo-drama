CREATE TABLE "conversations" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversations_title_check" CHECK (
    CHAR_LENGTH("title") BETWEEN 1 AND 200
    AND "title" = BTRIM("title")
  ),
  CONSTRAINT "conversations_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "conversations_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "conversations_project_fkey" FOREIGN KEY ("tenant_id", "project_id")
    REFERENCES "story_projects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "conversations_tenant_id_id_key"
  ON "conversations"("tenant_id", "id");
CREATE INDEX "conversations_tenant_id_project_id_created_at_id_idx"
  ON "conversations"("tenant_id", "project_id", "created_at" DESC, "id" DESC);

CREATE TABLE "messages" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "author_type" VARCHAR(16) NOT NULL,
  "author_user_id" UUID,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "messages_author_type_check" CHECK ("author_type" IN ('user', 'agent', 'system')),
  CONSTRAINT "messages_author_check" CHECK (
    ("author_type" = 'user' AND "author_user_id" IS NOT NULL)
    OR ("author_type" IN ('agent', 'system') AND "author_user_id" IS NULL)
  ),
  CONSTRAINT "messages_body_check" CHECK (
    CHAR_LENGTH("body") BETWEEN 1 AND 50000
    AND "body" = BTRIM("body")
  ),
  CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "messages_conversation_fkey" FOREIGN KEY ("tenant_id", "conversation_id")
    REFERENCES "conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "messages_author_user_id_fkey" FOREIGN KEY ("author_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "messages_author_membership_fkey" FOREIGN KEY ("tenant_id", "author_user_id")
    REFERENCES "team_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "messages_tenant_id_id_key"
  ON "messages"("tenant_id", "id");
CREATE UNIQUE INDEX "messages_tenant_conversation_id_key"
  ON "messages"("tenant_id", "conversation_id", "id");
CREATE INDEX "messages_tenant_id_conversation_id_created_at_id_idx"
  ON "messages"("tenant_id", "conversation_id", "created_at" DESC, "id" DESC);

CREATE TABLE "story_generation_requests" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "trigger_message_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_generation_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_generation_requests_status_check" CHECK (
    "status" IN ('pending', 'processing', 'succeeded', 'failed')
  ),
  CONSTRAINT "story_generation_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_generation_requests_conversation_fkey" FOREIGN KEY ("tenant_id", "conversation_id")
    REFERENCES "conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_generation_requests_trigger_message_fkey" FOREIGN KEY ("tenant_id", "conversation_id", "trigger_message_id")
    REFERENCES "messages"("tenant_id", "conversation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_generation_requests_tenant_id_id_key"
  ON "story_generation_requests"("tenant_id", "id");
CREATE UNIQUE INDEX "story_gen_requests_tenant_conversation_trigger_key"
  ON "story_generation_requests"("tenant_id", "conversation_id", "trigger_message_id");
CREATE UNIQUE INDEX "story_generation_requests_tenant_id_trigger_message_id_key"
  ON "story_generation_requests"("tenant_id", "trigger_message_id");
CREATE INDEX "story_gen_requests_tenant_conversation_created_id_idx"
  ON "story_generation_requests"("tenant_id", "conversation_id", "created_at" DESC, "id" DESC);
