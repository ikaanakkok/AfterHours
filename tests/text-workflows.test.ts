import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createFixtureServer } from '../scripts/fixture.js';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import { tenantDb, closeDb } from '../packages/core/src/db.js';
import * as s from '../packages/core/src/schema.js';
import { defaultConfig } from '../packages/core/src/policy.js';
import {
  handleTextWorkflowCommand,
  parseWorkflowSchedule,
  resolveWorkflowSystems,
  executeTextWorkflowOperation,
} from '../packages/core/src/text-workflows.js';
import {
  handleBackofficeCommand,
  executeBackofficeLogin,
} from '../packages/core/src/backoffice.js';
import type { TenantContext } from '../packages/core/src/types.js';

const tenantId = randomUUID(),
  connectionId = randomUUID();
let owner: Pool,
  ctx: TenantContext,
  fixture: ReturnType<typeof createFixtureServer>,
  directory: string,
  origin: string;
const row = (wid: string) =>
  tenantDb(
    tenantId,
    async (db) => (await db.select().from(s.workflows).where(eq(s.workflows.id, wid)))[0]!,
  );
async function createRead(text = 'Test ERP > kayıtları kontrol et > her 10 dakika') {
  return String(
    (await handleTextWorkflowCommand(ctx, 'workflow.text.save', { name: 'Test workflow', text }))
      .data?.id,
  );
}
async function runTest(wid: string) {
  const created = await handleTextWorkflowCommand(ctx, 'workflow.text.test', { id: wid });
  const op = await tenantDb(
    tenantId,
    async (db) =>
      (
        await db
          .select()
          .from(s.operations)
          .where(eq(s.operations.id, String(created.data?.operationId)))
      )[0]!,
  );
  const execution = await executeTextWorkflowOperation(tenantId, op);
  await tenantDb(tenantId, (db) =>
    db
      .update(s.operations)
      .set({
        status: execution.verified ? 'succeeded' : 'needs_attention',
        result: { ...execution.evidence, verified: execution.verified },
      })
      .where(eq(s.operations.id, op.id)),
  );
  return op.id;
}
beforeAll(async () => {
  assertLocalDemoDatabase();
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const admin = (
    await owner.query<{ user_id: string }>(
      'SELECT user_id FROM memberships WHERE tenant_id=$1 AND role=$2 LIMIT 1',
      ['11111111-1111-4111-8111-111111111111', 'admin'],
    )
  ).rows[0]!;
  await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [tenantId, 'Text workflow test']);
  await owner.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
    tenantId,
    admin.user_id,
    'admin',
  ]);
  ctx = { tenantId, actor: { type: 'admin', id: admin.user_id }, role: 'admin' };
  directory = await mkdtemp(join(tmpdir(), 'afterhours-text-workflow-'));
  fixture = createFixtureServer({ dataDir: directory });
  await new Promise<void>((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
  const address = fixture.server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable');
  origin = `http://127.0.0.1:${address.port}`;
  await tenantDb(tenantId, async (db) => {
    await db
      .insert(s.configurations)
      .values({ tenantId, version: 1, value: defaultConfig('Test') });
    await db.insert(s.connections).values({
      tenantId,
      id: connectionId,
      name: 'Test ERP',
      kind: 'browser',
      purpose: 'Controlled test system',
      status: 'ready',
      config: { mode: 'demo', startUrl: origin, allowedOrigins: [origin] },
      permissions: ['browser.execute'],
      agents: ['admin'],
    });
  });
});
afterAll(async () => {
  if (fixture) await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  if (owner) {
    for (const table of [
      'trials',
      'approvals',
      'handoffs',
      'audit',
      'runtime',
      'operations',
      'cron_jobs',
      'workflows',
      'secrets',
      'connections',
      'configurations',
      'memberships',
    ])
      await owner.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
    await owner.query('DELETE FROM tenants WHERE id=$1', [tenantId]);
    await owner.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  await closeDb();
});
describe('Text workflows and named Backoffice systems', () => {
  it('parses exact intervals and refuses uneven or invalid schedules', () => {
    expect(parseWorkflowSchedule('ERP > her 10 dk bir kontrol et')).toEqual({
      expression: '*/10 * * * *',
      timezone: 'Europe/Istanbul',
    });
    expect(parseWorkflowSchedule('ERP > every 2 hours')).toEqual({
      expression: '0 */2 * * *',
      timezone: 'Europe/Istanbul',
    });
    expect(parseWorkflowSchedule('ERP > 10dk bir kontrol et')?.expression).toBe('*/10 * * * *');
    expect(() => parseWorkflowSchedule('every 7 minutes')).toThrow();
    expect(parseWorkflowSchedule('ERP > kayıtları kontrol et')).toBeNull();
  });
  it('saves unresolved system names inactive with a visible explanation', async () => {
    const wid = await createRead('Unknown ERP > kayıtları kontrol et');
    const w = await row(wid);
    expect(w.connectionId).toBeNull();
    expect(w.status).toBe('awaiting_test');
    expect(w.enabled).toBe(false);
    expect(w.planningError).toContain('sistemi veya kanal ismini');
    await expect(
      handleTextWorkflowCommand(ctx, 'workflow.text.test', { id: wid }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_QUESTIONS_REQUIRED' });
    expect(
      resolveWorkflowSystems('Shared ERP > kontrol et', [
        { id: 'a', name: 'ERP', kind: 'browser' },
        { id: 'b', name: 'Shared ERP', kind: 'browser' },
      ]).error,
    ).toContain('birden fazla');
  });
  it('verifies a real fixture read then needs admin confirmation; a schedule cannot grant cron access', async () => {
    const wid = await createRead();
    expect((await row(wid)).enabled).toBe(false);
    const opid = await runTest(wid);
    expect((await row(wid)).status).toBe('awaiting_test');
    await handleTextWorkflowCommand(ctx, 'workflow.text.confirm', {
      id: wid,
      operationId: opid,
      confirmed: true,
    });
    const w = await row(wid);
    expect(w.status).toBe('ready');
    expect(w.enabled).toBe(true);
    expect(w.compiledPlan?.systems).toBeDefined();
    const cron = await tenantDb(
      tenantId,
      async (db) => (await db.select().from(s.cronJobs).where(eq(s.cronJobs.workflowId, wid)))[0]!,
    );
    expect(cron.enabled).toBe(false);
    await expect(
      handleTextWorkflowCommand(ctx, 'workflow.text.toggle', { id: wid, enabled: true }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });
  it('cannot confirm a failed or stale test and rejects revoked permissions before I/O', async () => {
    const wid = await createRead('Test ERP > kayıtları kontrol et');
    const opid = await runTest(wid);
    await tenantDb(tenantId, (db) =>
      db.update(s.operations).set({ status: 'failed' }).where(eq(s.operations.id, opid)),
    );
    await expect(
      handleTextWorkflowCommand(ctx, 'workflow.text.confirm', {
        id: wid,
        operationId: opid,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'VERIFIED_TEST_REQUIRED' });
    await handleTextWorkflowCommand(ctx, 'workflow.text.save', {
      id: wid,
      name: 'Changed',
      text: 'Test ERP > talepleri kontrol et',
    });
    await expect(
      handleTextWorkflowCommand(ctx, 'workflow.text.confirm', {
        id: wid,
        operationId: opid,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'STALE_TEST' });
    const fresh = await handleTextWorkflowCommand(ctx, 'workflow.text.test', { id: wid });
    const op = await tenantDb(
      tenantId,
      async (db) =>
        (
          await db
            .select()
            .from(s.operations)
            .where(eq(s.operations.id, String(fresh.data?.operationId)))
        )[0]!,
    );
    await tenantDb(tenantId, (db) =>
      db.update(s.connections).set({ permissions: [] }).where(eq(s.connections.id, connectionId)),
    );
    await expect(executeTextWorkflowOperation(tenantId, op)).rejects.toMatchObject({
      code: 'CAPABILITY_DENIED',
    });
    await tenantDb(tenantId, (db) =>
      db
        .update(s.connections)
        .set({ permissions: ['browser.execute'] })
        .where(eq(s.connections.id, connectionId)),
    );
  });
  it('does not accept unsupported fixture text as completed and shows missing AI provider', async () => {
    const wid = await createRead(
      'Test ERP > kayıtları kontrol et > Unknown Billing sisteminde fatura kes',
    );
    await expect(
      handleTextWorkflowCommand(ctx, 'workflow.text.test', { id: wid }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_QUESTIONS_REQUIRED' });
    expect((await row(wid)).enabled).toBe(false);
    expect((await row(wid)).clarification?.status).toBe('not_analyzed');
  });
  it('encrypts credentials and keeps a failed login system saved and inactive', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<form method="post"><input name="username"><input type="password"><button type="submit">Login</button></form>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Login fixture unavailable');
    try {
      const saved = await handleBackofficeCommand(ctx, 'backoffice.save', {
        name: 'Failed login test',
        url: `http://127.0.0.1:${addr.port}`,
        description: 'Controlled invalid account',
        username: 'dummy-test-user',
        password: 'dummy-test-password',
      });
      const conn = await tenantDb(
        tenantId,
        async (db) =>
          (
            await db
              .select()
              .from(s.connections)
              .where(eq(s.connections.id, String(saved.data?.id)))
          )[0]!,
      );
      expect(conn.status).toBe('awaiting_test');
      expect(conn.agents).toEqual(['admin']);
      expect(JSON.stringify(conn.config)).not.toContain('dummy-test-password');
      await expect(executeBackofficeLogin(tenantId, conn)).rejects.toMatchObject({
        code: 'LOGIN_FAILED',
      });
      const stillSaved = await tenantDb(
        tenantId,
        async (db) =>
          (await db.select().from(s.connections).where(eq(s.connections.id, conn.id)))[0]!,
      );
      expect(stillSaved.status).not.toBe('ready');
      const stored = await tenantDb(
        tenantId,
        async (db) =>
          (await db.select().from(s.secrets).where(eq(s.secrets.connectionId, conn.id)))[0]!,
      );
      expect(stored.ciphertext).not.toContain('dummy-test-password');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
