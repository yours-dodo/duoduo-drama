ALTER TABLE agent_runtime.runs
  ADD COLUMN next_event_sequence bigint NOT NULL DEFAULT 1,
  ADD COLUMN latest_checkpoint_version bigint NOT NULL DEFAULT 0;

CREATE TABLE agent_runtime.run_checkpoints (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  checkpoint_version bigint NOT NULL CHECK (checkpoint_version > 0),
  kind text NOT NULL CHECK (kind IN ('input_accepted', 'run_terminal')),
  input jsonb,
  transcript jsonb NOT NULL,
  turn_index integer,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (
    tenant_id,
    project_id,
    task_id,
    run_id,
    checkpoint_version
  ),
  FOREIGN KEY (tenant_id, project_id, task_id, run_id)
    REFERENCES agent_runtime.runs (tenant_id, project_id, task_id, run_id)
    ON DELETE CASCADE
);

CREATE TABLE agent_runtime.run_events (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_id text NOT NULL,
  event jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, task_id, run_id, sequence),
  UNIQUE (tenant_id, project_id, event_id),
  FOREIGN KEY (tenant_id, project_id, task_id, run_id)
    REFERENCES agent_runtime.runs (tenant_id, project_id, task_id, run_id)
    ON DELETE CASCADE
);

CREATE TABLE agent_runtime.event_outbox (
  outbox_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  sequence bigint NOT NULL,
  event_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivering', 'delivered')),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (tenant_id, project_id, event_id),
  FOREIGN KEY (tenant_id, project_id, task_id, run_id, sequence)
    REFERENCES agent_runtime.run_events (
      tenant_id,
      project_id,
      task_id,
      run_id,
      sequence
    )
    ON DELETE CASCADE
);

CREATE INDEX event_outbox_claim_idx
  ON agent_runtime.event_outbox (status, available_at, lease_expires_at, outbox_id)
  WHERE status <> 'delivered';
