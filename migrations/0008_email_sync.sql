-- Preserve every conversation; legacy channels retain their empty thread identity.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS thread_key text NOT NULL DEFAULT '';
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_tenant_id_connection_id_customer_address_unique;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_tenant_connection_address_thread_unique
 ON conversations(tenant_id,connection_id,customer_address,thread_key);

CREATE TABLE IF NOT EXISTS email_sync_states (
 tenant_id uuid NOT NULL REFERENCES tenants(id), connection_id uuid NOT NULL,
 account_email text NOT NULL, cursor text, window_start_at timestamptz, window_end_at timestamptz,
 completed_through_at timestamptz, last_synced_at timestamptz, next_poll_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, last_error text,
 PRIMARY KEY(tenant_id,connection_id),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES connections(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS email_messages (
 tenant_id uuid NOT NULL, message_id uuid NOT NULL, connection_id uuid NOT NULL,
 account_email text NOT NULL, provider_message_id text NOT NULL, thread_id text NOT NULL,
 internet_message_id text, subject text NOT NULL, source_date timestamptz NOT NULL,
 draft_status text NOT NULL DEFAULT 'pending' CHECK(draft_status IN ('pending','prepared','not_requested')),
 draft_error text, draft_retry_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,message_id), UNIQUE(tenant_id,connection_id,account_email,provider_message_id),
 FOREIGN KEY(tenant_id,message_id) REFERENCES messages(tenant_id,id),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES connections(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS email_draft_sources (
 tenant_id uuid NOT NULL, draft_id uuid NOT NULL, source_message_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,draft_id), UNIQUE(tenant_id,source_message_id),
 FOREIGN KEY(tenant_id,draft_id) REFERENCES drafts(tenant_id,id),
 FOREIGN KEY(tenant_id,source_message_id) REFERENCES email_messages(tenant_id,message_id)
);
CREATE INDEX IF NOT EXISTS email_messages_pending_drafts ON email_messages(tenant_id,connection_id,draft_status,draft_retry_at);
-- The migration runner reapplies the application grants and FORCE RLS policy to these tables.
