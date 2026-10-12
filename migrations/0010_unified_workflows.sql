CREATE TABLE IF NOT EXISTS workflow_runs (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
  parent_operation_id uuid NOT NULL, workflow_id uuid NOT NULL,
  workflow_version integer NOT NULL, config_version integer NOT NULL,
  actor jsonb NOT NULL, testing boolean NOT NULL, plan jsonb NOT NULL, dependencies jsonb NOT NULL,
  status text NOT NULL DEFAULT 'running', error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,parent_operation_id),
  FOREIGN KEY (tenant_id,parent_operation_id) REFERENCES operations(tenant_id,id),
  FOREIGN KEY (tenant_id,workflow_id) REFERENCES workflows(tenant_id,id),
  CHECK (status IN ('running','awaiting_approval','succeeded','needs_attention'))
);
CREATE TABLE IF NOT EXISTS workflow_run_steps (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL, position integer NOT NULL, step_id text NOT NULL, connection_id uuid NOT NULL,
  kind text NOT NULL, status text NOT NULL DEFAULT 'pending', concrete_inputs jsonb, input_hash text,
  operation_id uuid, preparation_token uuid, result jsonb, evidence jsonb, error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,run_id,position), UNIQUE (tenant_id,run_id,step_id),
  FOREIGN KEY (tenant_id,run_id) REFERENCES workflow_runs(tenant_id,id),
  FOREIGN KEY (tenant_id,connection_id) REFERENCES connections(tenant_id,id),
  FOREIGN KEY (tenant_id,operation_id) REFERENCES operations(tenant_id,id),
  CHECK (position >= 0),
  CHECK (status IN ('pending','preparing','queued','awaiting_approval','succeeded','needs_attention'))
);
CREATE INDEX IF NOT EXISTS workflow_runs_pending ON workflow_runs(tenant_id,status,updated_at);
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_steps FORCE ROW LEVEL SECURITY;
