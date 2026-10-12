-- Existing verified requests must not be replayed when upgrading older conversations.
UPDATE conversations c SET request_state = 'completed', inputs = '{}'
WHERE c.request_state = 'idle'
  AND (SELECT o.status FROM operations o
       WHERE o.tenant_id = c.tenant_id AND o.conversation_id = c.id
       ORDER BY o.updated_at DESC, o.id DESC LIMIT 1) = 'succeeded';
