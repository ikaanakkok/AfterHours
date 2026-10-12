ALTER TABLE workflows ADD COLUMN IF NOT EXISTS clarification jsonb;
-- Existing text workflows require fresh clarification before another execution.
UPDATE workflows SET enabled=false, published_version=NULL, status='awaiting_test' WHERE mode='text';
UPDATE cron_jobs SET enabled=false WHERE workflow_id IN (SELECT id FROM workflows WHERE mode='text' AND workflows.tenant_id=cron_jobs.tenant_id);
