CREATE TABLE IF NOT EXISTS channel_oauth_states (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 connection_id uuid NOT NULL, user_id text NOT NULL, state_hash text NOT NULL,
 verifier_ciphertext text NOT NULL, revision integer NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,connection_id) REFERENCES connections(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS channel_oauth_state_hash ON channel_oauth_states(tenant_id,state_hash);
ALTER TABLE channel_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_oauth_states FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='channel_oauth_states' AND policyname='tenant_isolation') THEN CREATE POLICY tenant_isolation ON channel_oauth_states USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid); END IF; END $$;
