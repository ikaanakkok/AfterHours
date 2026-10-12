import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tenantDb, closeDb } from '../packages/core/src/db.js';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import * as s from '../packages/core/src/schema.js';
import * as providers from '../packages/core/src/integrations/index.js';
import { runCommand } from '../packages/core/src/commands.js';
import { executeOperation } from '../packages/core/src/runtime.js';
import { writeConnectionSecret } from '../packages/core/src/security.js';
import { defaultConfig } from '../packages/core/src/policy.js';
import type { TenantContext } from '../packages/core/src/types.js';

const tenantId = randomUUID();
let owner: Pool, ctx: TenantContext;
beforeAll(async () => {
  assertLocalDemoDatabase();
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const user = (
    await owner.query<{ user_id: string }>(
      "SELECT user_id FROM memberships WHERE tenant_id=$1 AND role='admin' LIMIT 1",
      ['11111111-1111-4111-8111-111111111111'],
    )
  ).rows[0]!;
  await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [
    tenantId,
    'Operation snapshot regressions',
  ]);
  await owner.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [
    tenantId,
    user.user_id,
  ]);
  ctx = { tenantId, actor: { type: 'admin', id: user.user_id }, role: 'admin' };
  await tenantDb(tenantId, (db) =>
    db
      .insert(s.configurations)
      .values({ tenantId, version: 1, value: defaultConfig('Snapshot test') }),
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  for (const table of [
    'approvals',
    'handoffs',
    'audit',
    'operations',
    'secrets',
    'connections',
    'configurations',
    'memberships',
  ])
    await owner.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
  await owner.query('DELETE FROM tenants WHERE id=$1', [tenantId]);
  await owner.end();
  await closeDb();
});
const connection = (id: string) =>
  tenantDb(
    tenantId,
    async (db) => (await db.select().from(s.connections).where(eq(s.connections.id, id)))[0]!,
  );
const operation = (id: string) =>
  tenantDb(
    tenantId,
    async (db) => (await db.select().from(s.operations).where(eq(s.operations.id, id)))[0]!,
  );
describe('operation connection and credential snapshots', () => {
  for (const mutation of ['disable', 'reconnect', 'failure'] as const)
    it(`does not promote or overwrite a ${mutation} during an account test`, async () => {
      const id = randomUUID();
      await tenantDb(tenantId, (db) =>
        db.insert(s.connections).values({
          tenantId,
          id,
          name: 'Held account',
          kind: 'gmail',
          purpose: 'Controlled response',
          status: 'awaiting_test',
          config: { accountEmail: 'old@example.test' },
          agents: ['admin'],
        }),
      );
      await writeConnectionSecret(tenantId, id, { accessToken: 'controlled-old' });
      let release!: () => void, started!: () => void;
      const gate = new Promise<void>((resolve) => {
          release = resolve;
        }),
        entered = new Promise<void>((resolve) => {
          started = resolve;
        });
      const spy = vi.spyOn(providers, 'testEmailConnection').mockImplementation(async () => {
        started();
        await gate;
        if (mutation === 'failure') throw new Error('Controlled old failure');
        return { verified: true, account: 'old@example.test' };
      });
      const result = await runCommand(ctx, 'connection.test', { id });
      const opId = String(result.data?.operationId);
      const running = executeOperation(tenantId, opId);
      try {
        await entered;
        if (mutation === 'reconnect')
          await writeConnectionSecret(tenantId, id, { accessToken: 'controlled-new' });
        else await runCommand(ctx, 'connection.update', { id, enabled: false });
      } finally {
        release();
        await running;
        spy.mockRestore();
      }
      const current = await connection(id);
      expect(current.status).toBe(mutation === 'reconnect' ? 'awaiting_test' : 'disabled');
      expect(current.realAccountVerified).toBe(false);
      expect(current.config.accountEmail).toBe('old@example.test');
      expect((await operation(opId)).status).toBe('failed');
    });
  it('holds the endpoint lock while capturing its credential and never mixes a later token', async () => {
    const id = randomUUID();
    await tenantDb(tenantId, (db) =>
      db.insert(s.connections).values({
        tenantId,
        id,
        name: 'MCP old endpoint',
        kind: 'mcp',
        purpose: 'Controlled read',
        status: 'ready',
        config: { url: 'http://127.0.0.1:4101/mcp' },
        permissions: ['mcp:read_item'],
        agents: ['admin'],
      }),
    );
    await writeConnectionSecret(tenantId, id, { accessToken: 'controlled-old' });
    const result = await runCommand(ctx, 'mcp.execute', {
        connectionId: id,
        tool: 'read_item',
        arguments: {},
      }),
      opId = String(result.data?.operationId);
    const blocker = await owner.connect();
    let running: Promise<void> | undefined,
      saving: Promise<unknown> | undefined,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(providers, 'executeMcpTool')
      .mockImplementation(async (config, credential) => {
        await gate;
        expect(config.url).toBe('http://127.0.0.1:4101/mcp');
        expect(credential.accessToken).toBe('controlled-old');
        return { verified: true, externalRecordId: 'controlled-read', evidence: {} };
      });
    try {
      await blocker.query('BEGIN');
      const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await blocker.query(
        'SELECT ciphertext FROM secrets WHERE tenant_id=$1 AND connection_id=$2 FOR UPDATE',
        [tenantId, id],
      );
      running = executeOperation(tenantId, opId);
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const row = (
          await owner.query<{ blocked: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%secrets%') AS blocked",
            [pid],
          )
        ).rows[0]!;
        if (row.blocked) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      let saved = false;
      saving = tenantDb(tenantId, async (db) => {
        await db
          .update(s.connections)
          .set({ config: { url: 'http://127.0.0.1:4102/mcp' } })
          .where(eq(s.connections.id, id));
      }).then(async () => {
        await writeConnectionSecret(tenantId, id, { accessToken: 'controlled-new' });
        saved = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(saved).toBe(false);
      await blocker.query('COMMIT');
      await saving;
      release();
      await running;
      expect(spy).toHaveBeenCalledOnce();
      expect((await operation(opId)).status).toBe('succeeded');
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      release();
      await saving;
      await running;
      spy.mockRestore();
    }
  });
  it('rejects forged setup metadata in updates and old approvals while allowing unchanged guided email configuration', async () => {
    const id = randomUUID();
    await tenantDb(tenantId, (db) =>
      db.insert(s.connections).values({
        tenantId,
        id,
        name: 'Legacy MCP',
        kind: 'mcp',
        purpose: 'Guard test',
        config: { url: 'http://127.0.0.1:4101/mcp' },
      }),
    );
    const forged = {
      mcpSetup: true,
      readOnlyTools: ['write_item'],
      discoveredTools: ['write_item'],
    };
    await expect(
      runCommand(ctx, 'connection.update', { id, config: forged }),
    ).rejects.toMatchObject({ code: 'DEDICATED_SETUP_REQUIRED' });
    const approvalId = randomUUID();
    await tenantDb(tenantId, (db) =>
      db.insert(s.approvals).values({
        tenantId,
        id: approvalId,
        kind: 'connection',
        title: 'Old forged proposal',
        summary: 'Controlled regression',
        payload: { connectionId: id, config: forged },
        payloadHash: 'controlled',
        configVersion: 1,
      }),
    );
    await expect(
      runCommand(ctx, 'approval.resolve', { id: approvalId, decision: 'approve' }),
    ).rejects.toMatchObject({ code: 'DEDICATED_SETUP_REQUIRED' });
    expect((await connection(id)).config).not.toHaveProperty('mcpSetup');
    const emailId = randomUUID(),
      config = {
        guidedSetup: true,
        setupRevision: 1,
        provider: 'google',
        accountEmail: 'business@example.test',
      };
    await tenantDb(tenantId, (db) =>
      db.insert(s.connections).values({
        tenantId,
        id: emailId,
        name: 'Guided Gmail',
        kind: 'gmail',
        purpose: 'Opt-in',
        config,
      }),
    );
    const change = await runCommand(ctx, 'connection.update', {
      id: emailId,
      config: { ...config, emailSync: { enabled: true, draftEnabled: true } },
      permissions: ['email.read', 'email.draft'],
      agents: ['admin', 'customer'],
    });
    await runCommand(ctx, 'approval.resolve', { id: change.data?.approvalId, decision: 'approve' });
    expect((await connection(emailId)).config).toMatchObject({
      ...config,
      emailSync: { enabled: true, draftEnabled: true },
    });
  });
});
