-- Each message keeps its own sender even when a provider thread has multiple participants.
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS source_address text;
UPDATE email_messages e SET source_address = c.customer_address
 FROM messages m JOIN conversations c ON c.tenant_id=m.tenant_id AND c.id=m.conversation_id
 WHERE e.tenant_id=m.tenant_id AND e.message_id=m.id AND e.source_address IS NULL;
ALTER TABLE email_messages ALTER COLUMN source_address SET NOT NULL;
