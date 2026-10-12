ALTER TABLE "conversations" ADD COLUMN "request_state" text DEFAULT 'idle' NOT NULL;
ALTER TABLE "conversations" ADD CONSTRAINT conversations_request_state_check CHECK (request_state IN ('idle','collecting','completed'));
CREATE INDEX messages_inbound_pending_idx ON messages (tenant_id, conversation_id, created_at DESC, id DESC) WHERE direction = 'inbound';
