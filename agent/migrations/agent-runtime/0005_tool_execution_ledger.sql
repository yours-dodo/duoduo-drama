CREATE TABLE agent_runtime.tool_executions (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  turn_id text NOT NULL,
  turn_index integer NOT NULL CHECK (turn_index > 0),
  tool_execution_id text NOT NULL,
  tool_call_id text NOT NULL,
  proposal_sequence integer NOT NULL CHECK (proposal_sequence > 0),
  tool_name text NOT NULL,
  arguments_digest text NOT NULL,
  side_effect text CHECK (side_effect IN ('none', 'reversible', 'external')),
  idempotency text CHECK (idempotency IN ('none', 'keyed')),
  timeout_ms integer CHECK (timeout_ms > 0 AND timeout_ms <= 86400000),
  idempotency_key text,
  deadline timestamptz,
  status text NOT NULL CHECK (
    status IN (
      'proposed', 'prepared', 'running', 'succeeded', 'failed',
      'cancelled', 'timed_out', 'unknown'
    )
  ),
  effect_outcome text CHECK (
    effect_outcome IN ('not_applied', 'applied', 'unknown')
  ),
  retryable boolean,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  proposed_at timestamptz NOT NULL,
  prepared_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  PRIMARY KEY (
    tenant_id, project_id, task_id, run_id, tool_execution_id
  ),
  UNIQUE (
    tenant_id, project_id, task_id, run_id, tool_call_id
  ),
  UNIQUE (
    tenant_id, project_id, task_id, run_id, proposal_sequence
  ),
  FOREIGN KEY (tenant_id, project_id, task_id, run_id, turn_id)
    REFERENCES agent_runtime.turns (
      tenant_id, project_id, task_id, run_id, turn_id
    )
    ON DELETE CASCADE,
  CHECK (
    (idempotency = 'keyed' AND idempotency_key IS NOT NULL)
    OR (idempotency = 'none' AND idempotency_key IS NULL)
    OR idempotency IS NULL
  )
);

CREATE TABLE agent_runtime.tool_execution_attempts (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  tool_execution_id text NOT NULL,
  attempt_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (
    status IN ('running', 'succeeded', 'failed', 'cancelled', 'timed_out', 'unknown')
  ),
  effect_outcome text CHECK (
    effect_outcome IN ('not_applied', 'applied', 'unknown')
  ),
  deadline timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  error_code text,
  result_digest text,
  PRIMARY KEY (
    tenant_id, project_id, task_id, run_id, tool_execution_id, attempt_id
  ),
  UNIQUE (
    tenant_id, project_id, task_id, run_id, tool_execution_id, attempt
  ),
  FOREIGN KEY (
    tenant_id, project_id, task_id, run_id, tool_execution_id
  ) REFERENCES agent_runtime.tool_executions (
    tenant_id, project_id, task_id, run_id, tool_execution_id
  ) ON DELETE CASCADE
);

CREATE TABLE agent_runtime.tool_execution_transitions (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  tool_execution_id text NOT NULL,
  transition_sequence integer NOT NULL CHECK (transition_sequence > 0),
  from_status text,
  to_status text NOT NULL,
  attempt_id text,
  commit_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  reason_code text,
  PRIMARY KEY (
    tenant_id, project_id, task_id, run_id,
    tool_execution_id, transition_sequence
  ),
  FOREIGN KEY (
    tenant_id, project_id, task_id, run_id, tool_execution_id
  ) REFERENCES agent_runtime.tool_executions (
    tenant_id, project_id, task_id, run_id, tool_execution_id
  ) ON DELETE CASCADE,
  CHECK (from_status IS NULL OR from_status IN (
    'proposed', 'prepared', 'running', 'succeeded', 'failed',
    'cancelled', 'timed_out', 'unknown'
  )),
  CHECK (to_status IN (
    'proposed', 'prepared', 'running', 'succeeded', 'failed',
    'cancelled', 'timed_out', 'unknown'
  ))
);

CREATE INDEX tool_executions_run_order_idx
  ON agent_runtime.tool_executions (
    tenant_id, project_id, task_id, run_id, proposal_sequence
  );
