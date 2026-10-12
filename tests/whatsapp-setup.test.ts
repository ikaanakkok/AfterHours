import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import { tenantDb, closeDb } from '../packages/core/src/db.js';
import { runCommand } from '../packages/core/src/commands.js';
import {
  setWhatsAppQr,
  WHATSAPP_QR_TTL_MS,
  updateConnectionStatus,
} from '../packages/core/src/store.js';
import { defaultConfig } from '../packages/core/src/policy.js';
import { handleChannelSetupCommand } from '../packages/core/src/channel-setup.js';
import * as s from '../packages/core/src/schema.js';
import type { TenantContext } from '../packages/core/src/types.js';

const tenantId = randomUUID(),
  otherTenantId = randomUUID();
const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1sAAAAASUVORK5CYII=';
let owner: Pool, admin: TenantContext, staff: TenantContext;
beforeAll(async () => {
  assertLocalDemoDatabase();
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const users = (
    await owner.query('SELECT user_id,role FROM memberships WHERE tenant_id=$1', [
      '11111111-1111-4111-8111-111111111111',
    ])
  ).rows;
  const adminId = users.find((user) => user.role === 'admin').user_id;
  const staffId = users.find((user) => user.role === 'staff').user_id;
  await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2),($3,$4)', [
    tenantId,
    'QR test',
    otherTenantId,
    'Other QR test',
  ]);
  await owner.query(
    'INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3),($1,$4,$5),($6,$2,$3)',
    [tenantId, adminId, 'admin', staffId, 'staff', otherTenantId],
  );
  admin = { tenantId, role: 'admin', actor: { type: 'admin', id: adminId } };
  staff = { tenantId, role: 'staff', actor: { type: 'staff', id: staffId } };
  await tenantDb(tenantId, async (db) => {
    await db
      .insert(s.configurations)
      .values({ tenantId, version: 1, value: defaultConfig('QR test') });
  });
});
afterAll(async () => {
  for (const table of ['runtime', 'audit', 'connections', 'configurations', 'memberships'])
    await owner.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`, [
      [tenantId, otherTenantId],
    ]);
  await owner.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenantId, otherTenantId]]);
  await closeDb();
  await owner.end();
});
async function channel() {
  return String(
    (
      await handleChannelSetupCommand(admin, 'channel.setup.save', {
        kind: 'whatsapp',
        name: 'Store WhatsApp',
        purpose: 'Customer questions',
      })
    ).data?.id,
  );
}
const qr = (id: string, ctx = admin) => runCommand(ctx, 'whatsapp.qr', { id });

describe('WhatsApp guided QR setup', () => {
  it('returns the actual PNG unchanged and hides expired QR codes', async () => {
    const id = await channel();
    await setWhatsAppQr(tenantId, id, image, 1);
    const result = await qr(id);
    expect(result.data?.qr).toBe(image);
    expect(Date.parse(String(result.data?.expiresAt)) - Date.now()).toBeLessThanOrEqual(
      WHATSAPP_QR_TTL_MS,
    );
    await tenantDb(tenantId, async (db) => {
      await db
        .update(s.runtime)
        .set({
          value: { qr: image, linkAttempt: 1, expiresAt: new Date(Date.now() - 1).toISOString() },
        })
        .where(eq(s.runtime.key, `whatsapp.qr:${id}`));
    });
    expect((await qr(id)).data?.qr).toBeNull();
    await expect(setWhatsAppQr(tenantId, id, 'raw-pairing-secret', 1)).rejects.toThrow();
  });
  it('clears QR on a new attempt and ignores old socket updates', async () => {
    const id = await channel();
    await setWhatsAppQr(tenantId, id, image, 1);
    await runCommand(admin, 'whatsapp.connect', { id });
    expect((await qr(id)).data?.qr).toBeNull();
    await setWhatsAppQr(tenantId, id, image, 1);
    expect((await qr(id)).data?.qr).toBeNull();
    await setWhatsAppQr(tenantId, id, image, 2);
    await setWhatsAppQr(tenantId, id, null, 1);
    expect((await qr(id)).data?.qr).toBe(image);
    await tenantDb(tenantId, async (db) => {
      await db.update(s.connections).set({ status: 'ready' }).where(eq(s.connections.id, id));
    });
    expect((await qr(id)).data?.qr).toBeNull();
  });
  it('requires current admin membership and isolates another business', async () => {
    const id = await channel();
    await setWhatsAppQr(tenantId, id, image, 1);
    await expect(qr(id, staff)).rejects.toThrow();
    await expect(qr(id, { ...admin, tenantId: otherTenantId })).rejects.toThrow();
    await owner.query('DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2', [
      tenantId,
      admin.actor.id,
    ]);
    await expect(qr(id)).rejects.toThrow();
  });
  it('never resurrects a disabled channel or applies an old pairing status', async () => {
    // This independent context retains membership revoked by the previous test.
    const ctx = { ...admin, tenantId: otherTenantId };
    const id = String(
      (
        await handleChannelSetupCommand(ctx, 'channel.setup.save', {
          kind: 'whatsapp',
          name: 'Other channel',
          purpose: 'Status race',
        })
      ).data?.id,
    );
    await tenantDb(otherTenantId, async (db) => {
      await db.update(s.connections).set({ status: 'disabled' }).where(eq(s.connections.id, id));
    });
    await updateConnectionStatus(otherTenantId, id, 'ready', undefined, true, 1);
    const status = () =>
      tenantDb(
        otherTenantId,
        async (db) => (await db.select().from(s.connections).where(eq(s.connections.id, id)))[0]!,
      );
    expect((await status()).status).toBe('disabled');
    expect((await status()).realAccountVerified).toBe(false);
    await tenantDb(otherTenantId, async (db) => {
      await db
        .update(s.connections)
        .set({ status: 'setup', config: { mode: 'live', linkAttempt: 2 } })
        .where(eq(s.connections.id, id));
    });
    await updateConnectionStatus(otherTenantId, id, 'ready', undefined, true, 1);
    expect((await status()).status).toBe('setup');
    await updateConnectionStatus(otherTenantId, id, 'ready', undefined, true, 2);
    expect((await status()).status).toBe('ready');
  });
});
