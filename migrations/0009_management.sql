CREATE TABLE IF NOT EXISTS management_plans (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  user_id text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  dependencies jsonb NOT NULL,
  steps jsonb NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES admin_messages(tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id),
  CHECK (status IN ('pending','applying','awaiting_operation','awaiting_user','applied','needs_review','stale'))
);
CREATE INDEX IF NOT EXISTS management_plans_pending ON management_plans(tenant_id, status, updated_at);
ALTER TABLE management_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE management_plans FORCE ROW LEVEL SECURITY;
