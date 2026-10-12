import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { tenantDb, type TenantDb } from './db.js';
import * as s from './schema.js';
import { createOperation, one } from './commands.js';
import { authorizeConnection } from './policy.js';
import { assertMembership } from './context.js';
import { HttpError, requireAdmin } from './errors.js';
import { connectionView } from './store.js';
import { readConnectionSnapshot, stableHash, rotateConnectionSecret } from './security.js';
import { prepareCalendarEvent } from './integrations/calendar-operations.js';
import type { CommandResult, TenantContext } from './types.js';

export function calendarConnectionRevision(row: typeof s.connections.$inferSelect): string {
  return stableHash({
    kind: row.kind,
    config: row.config,
    permissions: row.permissions,
    agents: row.agents,
    status: row.status,
  });
}
export async function handleCalendarMutation(
  ctx: TenantContext,
  action: string,
  payload: unknown,
  beforeMutation?: (db: TenantDb) => Promise<void>,
): Promise<CommandResult> {
  await assertMembership(ctx);
  requireAdmin(ctx.role);
  const base = z.object({
    connectionId: z.string().uuid(),
    eventId: z.string().trim().min(1).max(1000),
  });
  const p =
    action === 'calendar.update'
      ? base
          .extend({
            title: z.string().trim().min(1).max(500),
            description: z.string().max(4000).default(''),
            start: z.string().datetime(),
            end: z.string().datetime(),
          })
          .strict()
          .parse(payload)
      : base.strict().parse(payload);
  if (
    'start' in p &&
    typeof p.start === 'string' &&
    'end' in p &&
    typeof p.end === 'string' &&
    new Date(p.end) <= new Date(p.start)
  )
    throw new HttpError(400, 'INVALID_RANGE', 'Bitiş başlangıçtan sonra olmalı.');
  const { connection: conn, credential } = await readConnectionSnapshot(
    ctx.tenantId,
    p.connectionId,
  );
  if (conn.kind !== 'google_calendar' && conn.kind !== 'microsoft_calendar')
    throw new HttpError(400, 'CALENDAR_REQUIRED', 'Takvim bağlantısı gerekli.');
  authorizeConnection(connectionView(conn), ctx.actor, action);
  const oldSecret = stableHash(credential);
  let expected;
  try {
    expected = await prepareCalendarEvent(
      conn.kind as 'google_calendar' | 'microsoft_calendar',
      conn.config,
      credential,
      p.eventId,
    );
  } finally {
    if (stableHash(credential) !== oldSecret) {
      if (!(await rotateConnectionSecret(ctx.tenantId, conn.id, oldSecret, credential)))
        throw new HttpError(
          409,
          'CREDENTIAL_CHANGED',
          'Hesap erişimi değişti. İşlemi yeniden hazırlayın.',
        );
    }
  }
  return tenantDb(ctx.tenantId, async (db) => {
    await beforeMutation?.(db);
    const current = await one(db.select().from(s.connections).where(eq(s.connections.id, conn.id)));
    if (calendarConnectionRevision(current) !== calendarConnectionRevision(conn))
      throw new HttpError(
        409,
        'CONNECTION_CHANGED',
        'Takvim bağlantısı değişti. İşlemi yeniden hazırlayın.',
      );
    const op = await createOperation(db, ctx, {
      capability: action,
      connectionId: conn.id,
      inputs: { ...p, expected, connectionRevision: calendarConnectionRevision(conn) },
      idempotencyKey: `${action}:${randomUUID()}`,
      requiresApproval: action === 'calendar.cancel',
    });
    return {
      message:
        action === 'calendar.cancel'
          ? 'Takvim iptali admin onayına gönderildi.'
          : 'Takvim güncellemesi hazırlandı.',
      data: { operationId: op.id, status: op.status },
    };
  });
}
