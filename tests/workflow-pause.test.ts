import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import { tenantDb, closeDb } from '../packages/core/src/db.js';
import * as s from '../packages/core/src/schema.js';
import { defaultConfig } from '../packages/core/src/policy.js';
import { handleTextWorkflowCommand } from '../packages/core/src/text-workflows.js';
import { emptyWorkflowClarification } from '../packages/core/src/workflow-clarifications.js';
import type { TenantContext } from '../packages/core/src/types.js';
const tenantId = randomUUID(),
  connectionId = randomUUID();
let owner: Pool, ctx: TenantContext;
beforeAll(async () => {
  assertLocalDemoDatabase();
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const user = (
    await owner.query('SELECT user_id FROM memberships WHERE tenant_id=$1 AND role=$2 LIMIT 1', [
      '11111111-1111-4111-8111-111111111111',
      'admin',
    ])
  ).rows[0];
  await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [tenantId, 'Pause regression']);
  await owner.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
    tenantId,
    user.user_id,
    'admin',
  ]);
  ctx = { tenantId, role: 'admin', actor: { type: 'admin', id: user.user_id } };
  await tenantDb(tenantId, async (db) => {
    await db
      .insert(s.configurations)
      .values({ tenantId, version: 1, value: defaultConfig('Pause regression') });
    await db.insert(s.connections).values({
      tenantId,
      id: connectionId,
      name: 'Test ERP',
      kind: 'browser',
      status: 'ready',
      purpose: 'Pause test',
      config: { mode: 'demo', startUrl: 'http://127.0.0.1:4001' },
      permissions: ['browser.execute'],
      agents: ['admin'],
    });
  });
});
afterAll(async () => {
  for (const table of [
    'audit',
    'cron_jobs',
    'workflows',
    'connections',
    'configurations',
    'memberships',
  ])
    await owner.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
  await owner.query('DELETE FROM tenants WHERE id=$1', [tenantId]);
  await owner.end();
  await closeDb();
});
it('permits admin to pause an invalidated workflow while refusing reactivation', async () => {
  const result = await handleTextWorkflowCommand(ctx, 'workflow.text.save', {
    name: 'Pause test',
    text: 'Test ERP > kayıtları kontrol et > her 10 dakika',
  });
  const id = String(result.data?.id);
  await tenantDb(tenantId, async (db) => {
    await db
      .update(s.workflows)
      .set({ enabled: true, status: 'ready', clarification: emptyWorkflowClarification(1) })
      .where(eq(s.workflows.id, id));
    await db.update(s.cronJobs).set({ enabled: true }).where(eq(s.cronJobs.workflowId, id));
  });
  await handleTextWorkflowCommand(ctx, 'workflow.text.toggle', { id, enabled: false });
  const state = await tenantDb(tenantId, async (db) => ({
    workflow: (await db.select().from(s.workflows).where(eq(s.workflows.id, id)))[0]!,
    cron: (await db.select().from(s.cronJobs).where(eq(s.cronJobs.workflowId, id)))[0]!,
  }));
  expect(state.workflow.enabled).toBe(false);
  expect(state.cron.enabled).toBe(false);
  await expect(
    handleTextWorkflowCommand(ctx, 'workflow.text.toggle', { id, enabled: true }),
  ).rejects.toThrow();
});
