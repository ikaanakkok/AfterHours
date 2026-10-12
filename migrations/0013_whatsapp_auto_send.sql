-- Automatic customer communication is now enabled by default, 24/7, in the
-- Europe/Istanbul tenant timezone. Existing tenants get a new configuration
-- version so prior versions remain intact for history.
INSERT INTO configurations (id, tenant_id, created_at, version, value)
SELECT
  gen_random_uuid(),
  c.tenant_id,
  now(),
  c.version + 1,
  jsonb_set(
    jsonb_set(c.value, '{automationEnabled}', 'true'::jsonb),
    '{activeHours}',
    '[{"day":0,"start":"00:00","end":"24:00"},{"day":1,"start":"00:00","end":"24:00"},{"day":2,"start":"00:00","end":"24:00"},{"day":3,"start":"00:00","end":"24:00"},{"day":4,"start":"00:00","end":"24:00"},{"day":5,"start":"00:00","end":"24:00"},{"day":6,"start":"00:00","end":"24:00"}]'::jsonb
  )
FROM (
  SELECT DISTINCT ON (tenant_id) tenant_id, version, value
  FROM configurations
  ORDER BY tenant_id, version DESC
) c;

-- WhatsApp channels grant the customer agent by default so automatic replies
-- can be delivered. Other channel kinds are left unchanged.
UPDATE connections
SET
  config = jsonb_set(config, '{customerReplies}', 'true'::jsonb),
  agents = CASE
    WHEN agents @> '["customer"]'::jsonb THEN agents
    ELSE agents || '["customer"]'::jsonb
  END
WHERE kind = 'whatsapp' AND deleted_at IS NULL;
