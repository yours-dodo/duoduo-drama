ALTER TABLE agent_runtime.run_checkpoints
  DROP CONSTRAINT run_checkpoints_kind_check,
  ADD COLUMN execution_position text,
  ADD COLUMN next_turn_index integer,
  ADD COLUMN harness_protocol_version integer,
  ADD COLUMN checkpoint_schema_version integer,
  ADD COLUMN config_fingerprint text;

UPDATE agent_runtime.run_checkpoints
SET execution_position = CASE kind
      WHEN 'input_accepted' THEN 'model'
      ELSE 'terminal'
    END,
    next_turn_index = CASE kind
      WHEN 'input_accepted' THEN 1
      ELSE NULL
    END,
    harness_protocol_version = 1,
    checkpoint_schema_version = 1,
    config_fingerprint = 'legacy';

ALTER TABLE agent_runtime.run_checkpoints
  ALTER COLUMN execution_position SET NOT NULL,
  ALTER COLUMN harness_protocol_version SET NOT NULL,
  ALTER COLUMN checkpoint_schema_version SET NOT NULL,
  ALTER COLUMN config_fingerprint SET NOT NULL,
  ADD CONSTRAINT run_checkpoints_kind_check CHECK (
    kind IN (
      'input_accepted',
      'model_completed',
      'tool_result_appended',
      'run_terminal'
    )
  ),
  ADD CONSTRAINT run_checkpoints_execution_position_check CHECK (
    execution_position IN ('model', 'tool', 'terminal')
  ),
  ADD CONSTRAINT run_checkpoints_protocol_version_check CHECK (
    harness_protocol_version > 0 AND checkpoint_schema_version > 0
  );
