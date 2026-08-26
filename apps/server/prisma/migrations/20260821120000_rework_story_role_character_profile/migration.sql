ALTER TABLE "story_role_assets"
  DROP CONSTRAINT "story_role_assets_summary_check",
  DROP CONSTRAINT "story_role_assets_desire_check",
  DROP CONSTRAINT "story_role_assets_mainline_relation_check",
  DROP CONSTRAINT "story_role_assets_narrative_order_check",
  DROP CONSTRAINT "story_role_assets_camp_check",
  DROP CONSTRAINT "story_role_assets_prominence_check";

ALTER TABLE "story_role_assets"
  RENAME COLUMN "summary" TO "personality_core";

ALTER TABLE "story_role_assets"
  RENAME COLUMN "desire" TO "external_goal";

ALTER TABLE "story_role_assets"
  RENAME COLUMN "prominence" TO "appearance_frequency";

ALTER TABLE "story_role_assets"
  ADD COLUMN "internal_need" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "fears_and_boundaries" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "character_arc" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "speech_profile" JSONB NOT NULL DEFAULT '{
    "summary": "",
    "pace": "正常",
    "sentenceStyle": "长短混合",
    "defaultTones": [],
    "vocabularyStyles": [],
    "habits": [],
    "audienceStyles": [],
    "prohibitions": [],
    "dialogueExamples": []
  }'::jsonb;

UPDATE "story_role_assets"
SET "appearance_frequency" = CASE "appearance_frequency"
  WHEN '核心' THEN '高频'
  WHEN '高频' THEN '高频'
  WHEN '低频' THEN '低频'
  WHEN '背景' THEN '仅被提及'
  ELSE '低频'
END;

UPDATE "story_role_assets"
SET "camp" = '未明确'
WHERE "camp" = '立场变化';

ALTER TABLE "story_role_assets"
  DROP COLUMN "narrative_order";

ALTER TABLE "story_role_assets"
  ALTER COLUMN "appearance_frequency" SET DEFAULT '低频';

ALTER TABLE "story_role_assets"
  ADD CONSTRAINT "story_role_assets_personality_core_check" CHECK (
    CHAR_LENGTH("personality_core") <= 2000
    AND "personality_core" = BTRIM("personality_core")
  ),
  ADD CONSTRAINT "story_role_assets_external_goal_check" CHECK (
    CHAR_LENGTH("external_goal") <= 1000
    AND "external_goal" = BTRIM("external_goal")
  ),
  ADD CONSTRAINT "story_role_assets_internal_need_check" CHECK (
    CHAR_LENGTH("internal_need") <= 1000
    AND "internal_need" = BTRIM("internal_need")
  ),
  ADD CONSTRAINT "story_role_assets_fears_and_boundaries_check" CHECK (
    CHAR_LENGTH("fears_and_boundaries") <= 1000
    AND "fears_and_boundaries" = BTRIM("fears_and_boundaries")
  ),
  ADD CONSTRAINT "story_role_assets_character_arc_check" CHECK (
    CHAR_LENGTH("character_arc") <= 2000
    AND "character_arc" = BTRIM("character_arc")
  ),
  ADD CONSTRAINT "story_role_assets_mainline_relation_check" CHECK (
    CHAR_LENGTH("mainline_relation") <= 2000
    AND "mainline_relation" = BTRIM("mainline_relation")
  ),
  ADD CONSTRAINT "story_role_assets_camp_check" CHECK (
    "camp" IN ('主角方', '对立方', '中立', '未明确')
  ),
  ADD CONSTRAINT "story_role_assets_appearance_frequency_check" CHECK (
    "appearance_frequency" IN ('高频', '中频', '低频', '仅被提及')
  ),
  ADD CONSTRAINT "story_role_assets_speech_profile_check" CHECK (
    jsonb_typeof("speech_profile") = 'object'
  );
