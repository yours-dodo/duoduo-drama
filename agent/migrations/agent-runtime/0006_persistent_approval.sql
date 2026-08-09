ALTER TABLE agent_runtime.tool_executions
  DROP CONSTRAINT tool_executions_status_check,
  DROP CONSTRAINT tool_executions_check,
  ADD CONSTRAINT tool_executions_status_check CHECK (
    status IN (
      'proposed', 'awaiting_approval', 'prepared', 'running', 'succeeded',
      'failed', 'cancelled', 'timed_out', 'unknown'
    )
  ),
  ADD CONSTRAINT tool_executions_idempotency_state_check CHECK (
    (idempotency = 'keyed' AND (
      (status = 'awaiting_approval' AND idempotency_key IS NULL)
      OR (status <> 'awaiting_approval' AND idempotency_key IS NOT NULL)
    ))
    OR (idempotency = 'none' AND idempotency_key IS NULL)
    OR idempotency IS NULL
  );

ALTER TABLE agent_runtime.tool_execution_transitions
  DROP CONSTRAINT tool_execution_transitions_from_status_check,
  DROP CONSTRAINT tool_execution_transitions_to_status_check,
  ADD CONSTRAINT tool_execution_transitions_from_status_check CHECK (
    from_status IS NULL OR from_status IN (
      'proposed', 'awaiting_approval', 'prepared', 'running', 'succeeded',
      'failed', 'cancelled', 'timed_out', 'unknown'
    )
  ),
  ADD CONSTRAINT tool_execution_transitions_to_status_check CHECK (
    to_status IN (
      'proposed', 'awaiting_approval', 'prepared', 'running', 'succeeded',
      'failed', 'cancelled', 'timed_out', 'unknown'
    )
  );

ALTER TABLE agent_runtime.run_checkpoints
  DROP CONSTRAINT run_checkpoints_kind_check,
  DROP CONSTRAINT run_checkpoints_execution_position_check,
  ADD CONSTRAINT run_checkpoints_kind_check CHECK (
    kind IN (
      'input_accepted', 'model_completed', 'approval_waiting',
      'approval_resolved', 'tool_result_appended', 'run_terminal'
    )
  ),
  ADD CONSTRAINT run_checkpoints_execution_position_check CHECK (
    execution_position IN ('model', 'approval', 'tool', 'terminal')
  );

CREATE TABLE agent_runtime.approval_requests (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  turn_id text NOT NULL,
  approval_id text NOT NULL,
  tool_execution_id text NOT NULL,
  proposal_sequence integer NOT NULL CHECK (proposal_sequence > 0),
  policy_id text NOT NULL,
  policy_version text NOT NULL,
  arguments_digest text NOT NULL,
  presentation jsonb NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')
  ),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  decision_id text,
  decision text CHECK (decision IN ('approved', 'denied')),
  decided_by text,
  decision_reason_code text,
  decided_at timestamptz,
  decision_task_version bigint,
  decision_receipt jsonb,
  consume_id text,
  consumed_at timestamptz,
  PRIMARY KEY (tenant_id, project_id, task_id, run_id, approval_id),
  UNIQUE (
    tenant_id, project_id, task_id, run_id, tool_execution_id
  ),
  FOREIGN KEY (
    tenant_id, project_id, task_id, run_id, tool_execution_id
  ) REFERENCES agent_runtime.tool_executions (
    tenant_id, project_id, task_id, run_id, tool_execution_id
  ) ON DELETE CASCADE,
  CHECK (expires_at > requested_at),
  CHECK (octet_length(approval_id) BETWEEN 1 AND 256),
  CHECK (octet_length(tool_execution_id) BETWEEN 1 AND 256),
  CHECK (octet_length(presentation::text) <= 32768),
  CHECK (
    (status = 'pending' AND decision_id IS NULL AND decision IS NULL
      AND decided_by IS NULL AND decided_at IS NULL
      AND decision_task_version IS NULL AND decision_receipt IS NULL)
    OR (status IN ('approved', 'denied') AND decision_id IS NOT NULL
      AND decision = status AND decided_by IS NOT NULL AND decided_at IS NOT NULL
      AND decision_task_version IS NOT NULL AND decision_receipt IS NOT NULL)
    OR (status IN ('expired', 'cancelled') AND decision_id IS NULL
      AND decision IS NULL AND decided_by IS NULL AND decided_at IS NULL
      AND decision_task_version IS NULL AND decision_receipt IS NULL)
  ),
  CHECK ((consume_id IS NULL) = (consumed_at IS NULL)),
  CHECK (decision_id IS NULL OR octet_length(decision_id) BETWEEN 1 AND 256),
  CHECK (decided_by IS NULL OR octet_length(decided_by) BETWEEN 1 AND 256),
  CHECK (consume_id IS NULL OR octet_length(consume_id) BETWEEN 1 AND 256),
  CHECK (
    decision_reason_code IS NULL
    OR (length(decision_reason_code) BETWEEN 1 AND 128
      AND decision_reason_code ~ '^[A-Z][A-Z0-9_]*$')
  )
);

CREATE UNIQUE INDEX approval_requests_decision_id_idx
  ON agent_runtime.approval_requests (
    tenant_id, project_id, task_id, run_id, decision_id
  )
  WHERE decision_id IS NOT NULL;

CREATE UNIQUE INDEX approval_requests_one_pending_run_idx
  ON agent_runtime.approval_requests (
    tenant_id, project_id, task_id, run_id
  )
  WHERE status = 'pending';

CREATE INDEX approval_requests_run_order_idx
  ON agent_runtime.approval_requests (
    tenant_id, project_id, task_id, run_id, proposal_sequence
  );

CREATE INDEX approval_requests_unconsumed_idx
  ON agent_runtime.approval_requests (
    tenant_id, project_id, task_id, run_id, requested_at
  )
  WHERE status <> 'pending' AND consumed_at IS NULL;

CREATE TABLE agent_runtime.approval_transitions (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  approval_id text NOT NULL,
  transition_sequence integer NOT NULL CHECK (transition_sequence > 0),
  from_status text,
  to_status text NOT NULL,
  commit_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  reason_code text,
  decision_id text,
  consume_id text,
  PRIMARY KEY (
    tenant_id, project_id, task_id, run_id,
    approval_id, transition_sequence
  ),
  FOREIGN KEY (
    tenant_id, project_id, task_id, run_id, approval_id
  ) REFERENCES agent_runtime.approval_requests (
    tenant_id, project_id, task_id, run_id, approval_id
  ) ON DELETE CASCADE,
  CHECK (
    from_status IS NULL OR from_status IN (
      'pending', 'approved', 'denied', 'expired', 'cancelled'
    )
  ),
  CHECK (
    to_status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')
  ),
  CHECK (
    reason_code IS NULL
    OR (length(reason_code) BETWEEN 1 AND 128
      AND reason_code ~ '^[A-Z][A-Z0-9_]*$')
  ),
  CHECK (decision_id IS NULL OR octet_length(decision_id) BETWEEN 1 AND 256),
  CHECK (consume_id IS NULL OR octet_length(consume_id) BETWEEN 1 AND 256)
);
