import { and, desc, eq, sql } from 'drizzle-orm';
import { tenantDb, type TenantDb } from './db.js';
import * as s from './schema.js';
import { redact } from './security.js';
import { defaultConfig } from './policy.js';
import type { Actor, BusinessConfig, ConnectionView, JsonObject } from './types.js';

export async function currentConfig(db: TenantDb): Promise<BusinessConfig> {
  const row = (
    await db.select().from(s.configurations).orderBy(desc(s.configurations.version)).limit(1)
  )[0];
  if (!row) throw new Error('Business configuration is missing');
  return row.value;
}
export async function log(
  db: TenantDb,
  tenantId: string,
  actor: Actor,
  event: string,
  targetId: string | null,
  details: JsonObject = {},
) {
  await db
    .insert(s.audit)
    .values({ tenantId, event, actor, targetId, details: redact(details) as JsonObject });
}
export function connectionView(
  row: typeof s.connections.$inferSelect,
  hasCredentials = false,
): ConnectionView {
  return {
    ...row,
    kind: row.kind as ConnectionView['kind'],
    status: row.status as ConnectionView['status'],
    agents: row.agents as ConnectionView['agents'],
    config: redact(row.config) as JsonObject,
    hasCredentials,
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
  };
}
export async function updateConnectionStatus(
  tenantId: string,
  id: string,
  status: string,
  error?: string | null,
  realAccountVerified?: boolean,
  expectedAttempt?: number,
) {
  await tenantDb(tenantId, async (db) => {
    await db
      .update(s.connections)
      .set({
        status,
        lastError: error ? String(redact(error)).slice(0, 500) : null,
        lastTestAt: new Date(),
        ...(realAccountVerified === undefined ? {} : { realAccountVerified }),
      })
      .where(
        and(
          eq(s.connections.id, id),
          ...(expectedAttempt === undefined
            ? []
            : [
                eq(s.connections.kind, 'whatsapp'),
                sql`${s.connections.status}<>'disabled'`,
                sql`coalesce(${s.connections.config}->>'enabled','true')<>'false'`,
                sql`coalesce(${s.connections.config}->>'linkAttempt','0')=${String(expectedAttempt)}`,
              ]),
        ),
      );
  });
}
export const WHATSAPP_QR_TTL_MS = 30_000;
export async function setWhatsAppQr(
  tenantId: string,
  id: string,
  qr: string | null,
  expectedAttempt?: number,
) {
  if (qr && (qr.length > 100_000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr)))
    throw new Error('WhatsApp QR image format is invalid');
  await tenantDb(tenantId, async (db) => {
    const connection = (
      await db.select().from(s.connections).where(eq(s.connections.id, id)).for('update')
    )[0];
    if (!connection || connection.kind !== 'whatsapp') return;
    const linkAttempt = Number(connection.config.linkAttempt ?? 0);
    if (expectedAttempt !== undefined && expectedAttempt !== linkAttempt) return;
    const value = {
      qr,
      linkAttempt,
      expiresAt: qr ? new Date(Date.now() + WHATSAPP_QR_TTL_MS).toISOString() : null,
    };
    await db
      .insert(s.runtime)
      .values({ tenantId, key: `whatsapp.qr:${id}`, value })
      .onConflictDoUpdate({
        target: [s.runtime.tenantId, s.runtime.key],
        set: { value, updatedAt: new Date() },
      });
  });
}
