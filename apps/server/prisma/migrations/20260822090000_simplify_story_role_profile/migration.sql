ALTER TABLE "story_role_assets"
  DROP CONSTRAINT "story_role_assets_personality_core_check",
  DROP CONSTRAINT "story_role_assets_external_goal_check",
  DROP CONSTRAINT "story_role_assets_internal_need_check",
  DROP CONSTRAINT "story_role_assets_fears_and_boundaries_check",
  DROP CONSTRAINT "story_role_assets_character_arc_check",
  DROP CONSTRAINT "story_role_assets_mainline_relation_check",
  DROP CONSTRAINT "story_role_assets_camp_check",
  DROP CONSTRAINT "story_role_assets_appearance_frequency_check",
  DROP CONSTRAINT "story_role_assets_speech_profile_check";

ALTER TABLE "story_role_assets"
  ADD COLUMN "motivation_conflict" TEXT NOT NULL DEFAULT '';

UPDATE "story_role_assets" AS role
SET
  "motivation_conflict" = concat_ws(
    E'\n',
    CASE
      WHEN btrim("external_goal") <> '' THEN '外在目标：' || btrim("external_goal")
    END,
    CASE
      WHEN btrim("internal_need") <> '' THEN '内在欲望：' || btrim("internal_need")
    END,
    CASE
      WHEN btrim("fears_and_boundaries") <> '' THEN '恐惧与底线：' || btrim("fears_and_boundaries")
    END
  ),
  "mainline_relation" = concat_ws(
    E'\n',
    NULLIF(btrim("mainline_relation"), ''),
    CASE
      WHEN cardinality("functions") > 0 THEN '剧情功能：' || array_to_string("functions", '、')
    END,
    CASE
      WHEN btrim("character_arc") <> '' THEN '角色变化规划：' || btrim("character_arc")
    END
  );

UPDATE "story_role_assets" AS role
SET "speech_profile" = jsonb_build_object(
  'style', concat_ws(
    '；',
    NULLIF(btrim(COALESCE(role."speech_profile" ->> 'summary', '')), ''),
    CASE
      WHEN COALESCE(role."speech_profile" ->> 'pace', '正常') <> '正常'
        THEN '语速：' || (role."speech_profile" ->> 'pace')
    END,
    CASE
      WHEN COALESCE(role."speech_profile" ->> 'sentenceStyle', '长短混合') <> '长短混合'
        THEN '句式：' || (role."speech_profile" ->> 'sentenceStyle')
    END,
    CASE
      WHEN jsonb_array_length(COALESCE(role."speech_profile" -> 'defaultTones', '[]'::jsonb)) > 0
        THEN '默认语气：' || (
          SELECT string_agg(value, '、')
          FROM jsonb_array_elements_text(COALESCE(role."speech_profile" -> 'defaultTones', '[]'::jsonb))
        )
    END,
    CASE
      WHEN jsonb_array_length(COALESCE(role."speech_profile" -> 'vocabularyStyles', '[]'::jsonb)) > 0
        THEN '用词风格：' || (
          SELECT string_agg(value, '、')
          FROM jsonb_array_elements_text(COALESCE(role."speech_profile" -> 'vocabularyStyles', '[]'::jsonb))
        )
    END
  ),
  'habits',
    COALESCE(
      (
        SELECT jsonb_agg(
          concat_ws(
            '；',
            NULLIF(item ->> 'type', ''),
            NULLIF(item ->> 'description', ''),
            CASE
              WHEN NULLIF(item ->> 'frequency', '') IS NOT NULL
                THEN '频率：' || (item ->> 'frequency')
            END,
            CASE
              WHEN jsonb_array_length(COALESCE(item -> 'triggers', '[]'::jsonb)) > 0
                THEN '触发：' || (
                  SELECT string_agg(value, '、')
                  FROM jsonb_array_elements_text(COALESCE(item -> 'triggers', '[]'::jsonb))
                )
            END,
            CASE
              WHEN jsonb_array_length(COALESCE(item -> 'exclusions', '[]'::jsonb)) > 0
                THEN '例外：' || (
                  SELECT string_agg(value, '、')
                  FROM jsonb_array_elements_text(COALESCE(item -> 'exclusions', '[]'::jsonb))
                )
            END,
            CASE
              WHEN jsonb_array_length(COALESCE(item -> 'examples', '[]'::jsonb)) > 0
                THEN '示例：' || (
                  SELECT string_agg(value, '；')
                  FROM jsonb_array_elements_text(COALESCE(item -> 'examples', '[]'::jsonb))
                )
            END
          )
        )
        FROM jsonb_array_elements(COALESCE(role."speech_profile" -> 'habits', '[]'::jsonb)) AS habit(item)
      ),
      '[]'::jsonb
    )
    || COALESCE(
      (
        SELECT jsonb_agg(
          concat_ws(
            '：',
            CASE
              WHEN NULLIF(item ->> 'audience', '') IS NOT NULL
                THEN '面对' || (item ->> 'audience')
              ELSE '面对特定对象'
            END,
            NULLIF(item ->> 'description', '')
          )
        )
        FROM jsonb_array_elements(COALESCE(role."speech_profile" -> 'audienceStyles', '[]'::jsonb)) AS audience(item)
      ),
      '[]'::jsonb
    )
    || COALESCE(
      (
        SELECT jsonb_agg('表达禁区：' || value)
        FROM jsonb_array_elements_text(COALESCE(role."speech_profile" -> 'prohibitions', '[]'::jsonb)) AS prohibition(value)
      ),
      '[]'::jsonb
    ),
  'dialogueExamples', COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'context', concat_ws(
            '；',
            NULLIF(item ->> 'situation', ''),
            NULLIF(item ->> 'emotion', ''),
            NULLIF(item ->> 'audience', '')
          ),
          'line', COALESCE(item ->> 'line', '')
        )
      )
      FROM jsonb_array_elements(COALESCE(role."speech_profile" -> 'dialogueExamples', '[]'::jsonb)) AS example(item)
    ),
    '[]'::jsonb
  )
);

ALTER TABLE "story_role_assets"
  DROP COLUMN "external_goal",
  DROP COLUMN "internal_need",
  DROP COLUMN "fears_and_boundaries",
  DROP COLUMN "character_arc",
  DROP COLUMN "functions";

ALTER TABLE "story_role_assets"
  ALTER COLUMN "speech_profile" SET DEFAULT '{"style":"","habits":[],"dialogueExamples":[]}'::jsonb;

ALTER TABLE "story_role_assets"
  ADD CONSTRAINT "story_role_assets_personality_core_check" CHECK (
    CHAR_LENGTH("personality_core") <= 2000
    AND "personality_core" = BTRIM("personality_core")
  ),
  ADD CONSTRAINT "story_role_assets_motivation_conflict_check" CHECK (
    CHAR_LENGTH("motivation_conflict") <= 4000
    AND "motivation_conflict" = BTRIM("motivation_conflict")
  ),
  ADD CONSTRAINT "story_role_assets_mainline_relation_check" CHECK (
    CHAR_LENGTH("mainline_relation") <= 8000
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
    AND jsonb_typeof("speech_profile" -> 'style') = 'string'
    AND jsonb_typeof("speech_profile" -> 'habits') = 'array'
    AND jsonb_typeof("speech_profile" -> 'dialogueExamples') = 'array'
  );
