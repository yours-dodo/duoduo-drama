CREATE TABLE agent_runtime.tasks (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  origin_session_id text,
  status text NOT NULL CHECK (
    status IN (
      'queued',
      'running',
      'waiting_for_input',
      'waiting_for_approval',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  latest_run_id text NOT NULL,
  active_run_id text,
  version bigint NOT NULL CHECK (version > 0),
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, task_id)
);

CREATE TABLE agent_runtime.runs (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN (
      'queued',
      'running',
      'waiting_for_input',
      'waiting_for_approval',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, task_id, run_id),
  FOREIGN KEY (tenant_id, project_id, task_id)
    REFERENCES agent_runtime.tasks (tenant_id, project_id, task_id)
    ON DELETE CASCADE
);

CREATE TABLE agent_runtime.turns (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  turn_id text NOT NULL,
  turn_index integer NOT NULL CHECK (turn_index > 0),
  status text NOT NULL CHECK (
    status IN ('running', 'completed', 'failed', 'cancelled')
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, task_id, run_id, turn_id),
  UNIQUE (tenant_id, project_id, task_id, run_id, turn_index),
  FOREIGN KEY (tenant_id, project_id, task_id, run_id)
    REFERENCES agent_runtime.runs (tenant_id, project_id, task_id, run_id)
    ON DELETE CASCADE
);

CREATE INDEX tasks_active_run_idx
  ON agent_runtime.tasks (tenant_id, project_id, active_run_id)
  WHERE active_run_id IS NOT NULL;
