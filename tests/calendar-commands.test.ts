import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import { closeDb, tenantDb } from '../packages/core/src/db.js';
import { defaultConfig } from '../packages/core/src/policy.js';
import * as s from '../packages/core/src/schema.js';
import { runCommand } from '../packages/core/src/commands.js';
import { executeOperation } from '../packages/core/src/runtime.js';
import { writeConnectionSecret } from '../packages/core/src/security.js';
import type { JsonObject, TenantContext } from '../packages/core/src/types.js';

const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  connectionId = randomUUID();
let owner: Pool, ctx: TenantContext, otherCtx: TenantContext;
let record: JsonObject,
  mode: 'success' | 'conflict' | 'unknown' = 'success';
let writes: RequestInit[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const input = {
  connectionId,
  eventId: 'known-event',
  title: 'Güncel görüşme',
  description: 'Doğrulanacak açıklama',
  start: '2026-10-12T09:00:00Z',
  end: '2026-10-12T09:45:00Z',
};
async function operation(id: string) {
  return tenantDb(
    tenantId,
    async (db) => (await db.select().from(s.operations).where(eq(s.operations.id, id)))[0]!,
  );
}
async function approve(id: string) {
  const approval = await tenantDb(
    tenantId,
    async (db) =>
      (
        await db
          .select()
          .from(s.approvals)
          .where(and(eq(s.approvals.operationId, id), eq(s.approvals.status, 'pending')))
      )[0]!,
  );
  await runCommand(ctx, 'approval.resolve', { id: approval.id, decision: 'approve' });
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
  await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2),($3,$4)', [
    tenantId,
    'Calendar command tests',
    otherTenantId,
    'Other calendar tenant',
  ]);
  await owner.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$3,$4),($2,$3,$4)', [
    tenantId,
    otherTenantId,
    admin.user_id,
    'admin',
  ]);
  ctx = { tenantId, role: 'admin', actor: { type: 'admin', id: admin.user_id } };
  otherCtx = { ...ctx, tenantId: otherTenantId };
  await tenantDb(tenantId, (db) =>
    db.insert(s.connections).values({
      tenantId,
      id: connectionId,
      name: 'Controlled calendar',
      kind: 'google_calendar',
      purpose: 'Only controlled provider writes',
      status: 'ready',
      config: {
        calendarId: 'business-calendar',
        accountEmail: 'owner@example.test',
        requireApproval: ['calendar.update'],
      },
      permissions: ['calendar.read', 'calendar.create', 'calendar.update', 'calendar.cancel'],
      agents: ['admin'],
    }),
  );
  await tenantDb(otherTenantId, (db) =>
    db
      .insert(s.configurations)
      .values({ tenantId: otherTenantId, version: 1, value: defaultConfig('Other') }),
  );
  await writeConnectionSecret(tenantId, connectionId, { accessToken: 'controlled-calendar-token' });
});
beforeEach(async () => {
  for (const table of [
    'approvals',
    'handoffs',
    'audit',
    'operations',
    'calendar_events',
    'configurations',
  ])
    await owner.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
  await tenantDb(tenantId, async (db) => {
    await db
      .insert(s.configurations)
      .values({ tenantId, version: 1, value: defaultConfig('Calendar tests') });
    await db
      .update(s.connections)
      .set({
        status: 'ready',
        permissions: ['calendar.read', 'calendar.create', 'calendar.update', 'calendar.cancel'],
      })
      .where(eq(s.connections.id, connectionId));
  });
  record = {
    id: 'known-event',
    etag: '"version1"',
    summary: 'Eski görüşme',
    description: 'Eski açıklama',
    start: { dateTime: '2026-10-12T08:00:00Z' },
    end: { dateTime: '2026-10-12T08:45:00Z' },
    status: 'confirmed',
  };
  mode = 'success';
  writes = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (target: string | URL, init?: RequestInit) => {
      const url = new URL(String(target)),
        method = init?.method ?? 'GET';
      if (url.pathname.endsWith('/users/me/calendarList'))
        return json({
          items: [
            { id: 'owner@example.test', primary: true, accessRole: 'owner' },
            { id: 'business-calendar', accessRole: 'owner' },
          ],
        });
      if (url.pathname.endsWith('/events')) return json({ items: [] });
      if (method === 'GET') return record ? json(record) : json({ error: 'not found' }, 404);
      writes.push(init!);
      if (mode === 'conflict') return json({ error: 'stale version' }, 412);
      if (method === 'PATCH')
        record = { ...record, ...JSON.parse(String(init?.body)), etag: '"version2"' };
      if (mode === 'unknown') throw new Error('Simulated provider timeout after accepting write');
      if (method === 'DELETE') {
        record = null as unknown as JsonObject;
        return new Response(null, { status: 204 });
      }
      return json(record);
    }),
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (owner) {
    for (const table of [
      'approvals',
      'handoffs',
      'audit',
      'operations',
      'calendar_events',
      'configurations',
      'secrets',
      'connections',
      'memberships',
    ])
      await owner.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`, [
        [tenantId, otherTenantId],
      ]);
    await owner.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenantId, otherTenantId]]);
    await owner.end();
  }
  await closeDb();
});

describe('calendar command authorization and worker verification', () => {
  it('blocks another tenant and missing calendar permissions before reading or writing the provider', async () => {
    await expect(
      runCommand(otherCtx, 'calendar.cancel', { connectionId, eventId: input.eventId }),
    ).rejects.toThrow();
    await tenantDb(tenantId, (db) =>
      db
        .update(s.connections)
        .set({ permissions: ['calendar.read'] })
        .where(eq(s.connections.id, connectionId)),
    );
    await expect(runCommand(ctx, 'calendar.update', input)).rejects.toThrow('işlem izni');
    expect(writes).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it('freezes the exact original target and always requires admin approval for cancellation', async () => {
    const result = await runCommand(ctx, 'calendar.cancel', {
      connectionId,
      eventId: input.eventId,
    });
    const op = await operation(String(result.data?.operationId));
    expect(op).toMatchObject({
      capability: 'calendar.cancel',
      requiresApproval: true,
      status: 'awaiting_approval',
      inputs: {
        expected: {
          calendarId: 'business-calendar',
          accountEmail: 'owner@example.test',
          eventId: 'known-event',
          version: '"version1"',
          title: 'Eski görüşme',
          description: 'Eski açıklama',
        },
      },
    });
    await executeOperation(tenantId, op.id);
    expect(writes).toHaveLength(0);
    await approve(op.id);
    await executeOperation(tenantId, op.id);
    expect(await operation(op.id)).toMatchObject({
      status: 'succeeded',
      result: { verified: true, evidence: { cancelled: true } },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe('DELETE');
  });
  it('rejects a stale approved configuration before any provider mutation', async () => {
    const result = await runCommand(ctx, 'calendar.update', input),
      id = String(result.data?.operationId);
    await approve(id);
    await tenantDb(tenantId, (db) =>
      db.insert(s.configurations).values({
        tenantId,
        version: 2,
        value: { ...defaultConfig('Changed config'), version: 2 },
      }),
    );
    await executeOperation(tenantId, id);
    expect(await operation(id)).toMatchObject({ status: 'failed' });
    expect(writes).toHaveLength(0);
  });
  it('does not write an event that changed after approval', async () => {
    const result = await runCommand(ctx, 'calendar.update', input),
      id = String(result.data?.operationId);
    await approve(id);
    record = { ...record, etag: '"changed-after-approval"' };
    await executeOperation(tenantId, id);
    expect(await operation(id)).toMatchObject({ status: 'failed' });
    expect(writes).toHaveLength(0);
  });
  it('records provider precondition failure without repeating the write', async () => {
    const result = await runCommand(ctx, 'calendar.update', input),
      id = String(result.data?.operationId);
    await approve(id);
    mode = 'conflict';
    await executeOperation(tenantId, id);
    await executeOperation(tenantId, id);
    expect(await operation(id)).toMatchObject({ status: 'failed', attempts: 1 });
    expect(writes).toHaveLength(1);
  });
  it('retains uncertain outcomes for human review and never blindly retries', async () => {
    const result = await runCommand(ctx, 'calendar.update', input),
      id = String(result.data?.operationId);
    await approve(id);
    mode = 'unknown';
    await executeOperation(tenantId, id);
    await executeOperation(tenantId, id);
    expect(await operation(id)).toMatchObject({ status: 'needs_attention', attempts: 1 });
    expect(writes).toHaveLength(1);
    expect(
      await tenantDb(tenantId, (db) =>
        db.select().from(s.handoffs).where(eq(s.handoffs.operationId, id)),
      ),
    ).toHaveLength(1);
  });
  it('verifies update content after the command-created operation completes', async () => {
    const result = await runCommand(ctx, 'calendar.update', input),
      id = String(result.data?.operationId);
    await approve(id);
    await executeOperation(tenantId, id);
    expect(await operation(id)).toMatchObject({
      status: 'succeeded',
      result: {
        verified: true,
        evidence: {
          title: input.title,
          description: input.description,
          start: input.start,
          end: input.end,
        },
      },
    });
    expect(writes).toHaveLength(1);
    expect(new Headers(writes[0]?.headers).get('If-Match')).toBe('"version1"');
  });
});
