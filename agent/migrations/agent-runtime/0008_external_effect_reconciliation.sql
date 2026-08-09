CREATE TABLE agent_runtime.reconciliation_cases (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  reconciliation_case_id text NOT NULL,
  tool_execution_id text NOT NULL,
  attempt_id text NOT NULL,
  tool_name text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('waiting', 'resolved', 'consumed', 'cancelled')
  ),
  reason_code text NOT NULL CHECK (reason_code = 'EXTERNAL_EFFECT_UNKNOWN'),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL,
  resolution_id text,
  resolution text CHECK (
    resolution IN (
      'confirmed_applied', 'confirmed_not_applied',
      'confirmed_compensated', 'abandoned'
    )
  ),
  resolved_by text,
  resolution_reason_code text,
  resolution_presentation jsonb,
  resolved_at timestamptz,
  consume_id text,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  PRIMARY KEY (
    tenant_id, project_id, task_id, run_id, reconciliation_case_id
  ),
  UNIQUE (
    tenant_id, project_id, task_id, run_id, tool_execution_id
  ),
  UNIQUE (
    tenant_id, project_id, task_id, run_id, resolution_id
  ),
  UNIQUE (
    tenant_id, project_id, task_id, run_id, consume_id
  ),
  FOREIGN KEY (
    tenant_id, project_id, task_id, run_id, tool_execution_id, attempt_id
  ) REFERENCES agent_runtime.tool_execution_attempts (
    tenant_id, project_id, task_id, run_id, tool_execution_id, attempt_id
  ) ON DELETE CASCADE,
  CHECK (octet_length(reconciliation_case_id) BETWEEN 1 AND 256),
  CHECK (octet_length(tool_execution_id) BETWEEN 1 AND 256),
  CHECK (octet_length(attempt_id) BETWEEN 1 AND 256),
  CHECK (octet_length(tool_name) BETWEEN 1 AND 256),
  CHECK (resolution_id IS NULL OR octet_length(resolution_id) BETWEEN 1 AND 256),
  CHECK (resolved_by IS NULL OR octet_length(resolved_by) BETWEEN 1 AND 256),
  CHECK (consume_id IS NULL OR octet_length(consume_id) BETWEEN 1 AND 256),
  CHECK (
    resolution_reason_code IS NULL OR (
      length(resolution_reason_code) BETWEEN 1 AND 128
      AND resolution_reason_code ~ '^[A-Z][A-Z0-9_]*$'
    )
  ),
  CHECK (
    resolution_presentation IS NULL
    OR octet_length(resolution_presentation::text) <= 32768
  ),
  CHECK (
    (resolution_id IS NULL AND resolution IS NULL AND resolved_by IS NULL
      AND resolution_reason_code IS NULL AND resolution_presentation IS NULL
      AND resolved_at IS NULL)
    OR (resolution_id IS NOT NULL AND resolution IS NOT NULL
      AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
  ),
  CHECK ((consume_id IS NULL) = (consumed_at IS NULL)),
  CHECK (
    (status = 'waiting' AND resolution_id IS NULL AND consume_id IS NULL
      AND cancelled_at IS NULL)
    OR (status = 'resolved' AND resolution_id IS NOT NULL AND consume_id IS NULL
      AND cancelled_at IS NULL)
    OR (status = 'consumed' AND resolution_id IS NOT NULL AND consume_id IS NOT NULL
      AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND consume_id IS NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX reconciliation_cases_resolved_idx
  ON agent_runtime.reconciliation_cases (
    tenant_id, project_id, task_id, run_id, created_at
  )
  WHERE status = 'resolved';

CREATE TABLE agent_runtime.reconciliation_observations (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  reconciliation_case_id text NOT NULL,
  observation_sequence bigint NOT NULL CHECK (observation_sequence > 0),
  adapter_id text NOT NULL,
  adapter_version text NOT NULL,
  outcome text NOT NULL CHECK (
    outcome IN ('applied', 'not_applied', 'inconclusive', 'failed')
  ),
  reason_code text NOT NULL,
  presentation jsonb,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (
    tenant_id, project_id, task_id, run_id,
    reconciliation_case_id, observation_sequence
  ),
  FOREIGN KEY (
    tenant_id, project_id, task_id, run_id, reconciliation_case_id
  ) REFERENCES agent_runtime.reconciliation_cases (
    tenant_id, project_id, task_id, run_id, reconciliation_case_id
  ) ON DELETE CASCADE,
  CHECK (octet_length(adapter_id) BETWEEN 1 AND 256),
  CHECK (octet_length(adapter_version) BETWEEN 1 AND 256),
  CHECK (
    length(reason_code) BETWEEN 1 AND 128
    AND reason_code ~ '^[A-Z][A-Z0-9_]*$'
  ),
  CHECK (presentation IS NULL OR octet_length(presentation::text) <= 32768)
);

CREATE TABLE agent_runtime.reconciliation_transitions (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  reconciliation_case_id text NOT NULL,
  transition_sequence bigint NOT NULL CHECK (transition_sequence > 0),
  from_status text,
  to_status text NOT NULL CHECK (
    to_status IN ('waiting', 'resolved', 'consumed', 'cancelled')
  ),
  occurred_at timestamptz NOT NULL,
  reason_code text,
  resolution_id text,
  consume_id text,
  cancellation_id text,
  PRIMARY KEY (
    tenant_id, project_id, task_id, run_id,
    reconciliation_case_id, transition_sequence
  ),
  FOREIGN KEY (
    tenant_id, project_id, task_id, run_id, reconciliation_case_id
  ) REFERENCES agent_runtime.reconciliation_cases (
    tenant_id, project_id, task_id, run_id, reconciliation_case_id
  ) ON DELETE CASCADE,
  CHECK (
    from_status IS NULL OR from_status IN (
      'waiting', 'resolved', 'consumed', 'cancelled'
    )
  ),
  CHECK (
    reason_code IS NULL OR (
      length(reason_code) BETWEEN 1 AND 128
      AND reason_code ~ '^[A-Z][A-Z0-9_]*$'
    )
  ),
  CHECK (resolution_id IS NULL OR octet_length(resolution_id) BETWEEN 1 AND 256),
  CHECK (consume_id IS NULL OR octet_length(consume_id) BETWEEN 1 AND 256),
  CHECK (cancellation_id IS NULL OR octet_length(cancellation_id) BETWEEN 1 AND 256)
);
