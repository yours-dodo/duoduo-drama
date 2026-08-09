ALTER TABLE agent_runtime.tasks
  DROP CONSTRAINT tasks_status_check,
  ADD CONSTRAINT tasks_status_check CHECK (
    status IN (
      'queued', 'running', 'waiting_for_input', 'waiting_for_approval',
      'waiting_for_reconciliation', 'recovery_blocked',
      'completed', 'failed', 'cancelled'
    )
  );

ALTER TABLE agent_runtime.runs
  DROP CONSTRAINT runs_status_check,
  ADD CONSTRAINT runs_status_check CHECK (
    status IN (
      'queued', 'running', 'waiting_for_input', 'waiting_for_approval',
      'waiting_for_reconciliation', 'recovery_blocked',
      'completed', 'failed', 'cancelled'
    )
  );

ALTER TABLE agent_runtime.run_checkpoints
  DROP CONSTRAINT run_checkpoints_kind_check,
  DROP CONSTRAINT run_checkpoints_execution_position_check,
  ADD COLUMN resume_state jsonb,
  ADD CONSTRAINT run_checkpoints_kind_check CHECK (
    kind IN (
      'input_accepted', 'model_completed', 'approval_waiting',
      'approval_resolved', 'tool_result_appended',
      'reconciliation_waiting', 'recovery_blocked', 'run_terminal'
    )
  ),
  ADD CONSTRAINT run_checkpoints_execution_position_check CHECK (
    execution_position IN (
      'model', 'approval', 'tool', 'reconciliation', 'recovery', 'terminal'
    )
  ),
  ADD CONSTRAINT run_checkpoints_resume_state_check CHECK (
    resume_state IS NULL OR jsonb_typeof(resume_state) = 'object'
  );

CREATE TABLE agent_runtime.run_execution_leases (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  owner_id text,
  lease_token text,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  claimed_at timestamptz,
  renewed_at timestamptz,
  lease_expires_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  consecutive_failure_count integer NOT NULL DEFAULT 0
    CHECK (consecutive_failure_count BETWEEN 0 AND 1000000),
  last_failure_code text,
  config_fingerprint text NOT NULL,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  PRIMARY KEY (tenant_id, project_id, task_id, run_id),
  FOREIGN KEY (tenant_id, project_id, task_id, run_id)
    REFERENCES agent_runtime.runs (tenant_id, project_id, task_id, run_id)
    ON DELETE CASCADE,
  CHECK (
    (owner_id IS NULL AND lease_token IS NULL AND claimed_at IS NULL
      AND renewed_at IS NULL AND lease_expires_at IS NULL)
    OR (owner_id IS NOT NULL AND lease_token IS NOT NULL
      AND claimed_at IS NOT NULL AND renewed_at IS NOT NULL
      AND lease_expires_at > renewed_at)
  ),
  CHECK (octet_length(config_fingerprint) BETWEEN 1 AND 512),
  CHECK (owner_id IS NULL OR octet_length(owner_id) BETWEEN 1 AND 256),
  CHECK (lease_token IS NULL OR octet_length(lease_token) BETWEEN 1 AND 256),
  CHECK (
    last_failure_code IS NULL OR (
      length(last_failure_code) BETWEEN 1 AND 128
      AND last_failure_code ~ '^[A-Z][A-Z0-9_]*$'
    )
  )
);

CREATE INDEX run_execution_leases_claim_idx
  ON agent_runtime.run_execution_leases (
    config_fingerprint, available_at, lease_expires_at,
    tenant_id, project_id, task_id, run_id
  );

CREATE TABLE agent_runtime.run_recovery_audit (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  recovery_sequence bigint NOT NULL CHECK (recovery_sequence > 0),
  recovery_id text NOT NULL,
  owner_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  action text NOT NULL CHECK (
    action IN (
      'initial_claim', 'recovery_claim', 'handoff', 'lease_lost',
      'released', 'resumed', 'blocked', 'terminal'
    )
  ),
  reason_code text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    tenant_id, project_id, task_id, run_id, recovery_sequence
  ),
  FOREIGN KEY (tenant_id, project_id, task_id, run_id)
    REFERENCES agent_runtime.runs (tenant_id, project_id, task_id, run_id)
    ON DELETE CASCADE,
  CHECK (octet_length(recovery_id) BETWEEN 1 AND 256),
  CHECK (octet_length(owner_id) BETWEEN 1 AND 256),
  CHECK (
    reason_code IS NULL OR (
      length(reason_code) BETWEEN 1 AND 128
      AND reason_code ~ '^[A-Z][A-Z0-9_]*$'
    )
  )
);

CREATE INDEX run_recovery_audit_recovery_idx
  ON agent_runtime.run_recovery_audit (recovery_id);

CREATE TABLE agent_runtime.run_recovery_operations (
  operation_id text PRIMARY KEY,
  operation_type text NOT NULL CHECK (
    operation_type IN ('claim', 'renew', 'release')
  ),
  command_hash text NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(operation_id) BETWEEN 1 AND 256)
);
