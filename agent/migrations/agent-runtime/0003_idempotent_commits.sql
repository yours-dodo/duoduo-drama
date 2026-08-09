CREATE TABLE agent_runtime.runtime_commits (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  commit_id text NOT NULL,
  command_hash text NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, task_id, commit_id),
  FOREIGN KEY (tenant_id, project_id, task_id)
    REFERENCES agent_runtime.tasks (tenant_id, project_id, task_id)
    ON DELETE CASCADE
);

CREATE INDEX runtime_commits_run_created_idx
  ON agent_runtime.runtime_commits (
    tenant_id,
    project_id,
    task_id,
    run_id,
    created_at
  );
