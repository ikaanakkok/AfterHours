import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { tenantDb } from './db.js';
import * as s from './schema.js';
import { requireAdmin, HttpError } from './errors.js';
import { assertMembership } from './context.js';
import { log } from './store.js';
import type { TenantContext, CommandResult } from './types.js';
import { startChannelOAuth } from './channel-oauth.js';
import { channelOAuthStates } from './channel-setup-schema.js';
export { completeChannelOAuthFromHeaders } from './channel-oauth.js';
export function channelSetupAvailability() {
  return {
    google: !!(
      process.env.AFTERHOURS_GOOGLE_CLIENT_ID && process.env.AFTERHOURS_GOOGLE_CLIENT_SECRET
    ),
    microsoft: !!(
      process.env.AFTERHOURS_MICROSOFT_CLIENT_ID && process.env.AFTERHOURS_MICROSOFT_CLIENT_SECRET
    ),
    redirectUri: new URL(
      '/api/channels/oauth/callback',
      process.env.AFTERHOURS_APP_URL || 'http://127.0.0.1:3000',
    ).href,
  };
}
export async function handleChannelSetupCommand(
  ctx: TenantContext,
  action: string,
  payload: unknown,
  beforeMutation?: (db: import('./db.js').TenantDb) => Promise<void>,
): Promise<CommandResult> {
  await assertMembership(ctx);
  requireAdmin(ctx.role);
  if (action === 'channel.setup.status') {
    z.object({}).strict().parse(payload);
    return { message: 'Bağlantı seçenekleri hazır.', data: channelSetupAvailability() };
  }
  if (action === 'channel.oauth.start') {
    const p = z.object({ id: z.string().uuid() }).strict().parse(payload);
    return startChannelOAuth(ctx, p.id, beforeMutation);
  }
  if (action === 'channel.setup.delete') {
    const p = z.object({ id: z.string().uuid() }).strict().parse(payload);
    await tenantDb(ctx.tenantId, async (db) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':channel-setup'},0))`,
      );
      if (beforeMutation) await beforeMutation(db);
      const connection = (
        await db
          .select()
          .from(s.connections)
          .where(and(eq(s.connections.id, p.id), isNull(s.connections.deletedAt)))
      )[0];
      if (!connection) throw new HttpError(404, 'NOT_FOUND', 'Kanal bulunamadı.');
      await db
        .update(s.connections)
        .set({
          deletedAt: new Date(),
          status: 'disabled',
          permissions: [],
          agents: ['admin'],
          realAccountVerified: false,
        })
        .where(eq(s.connections.id, p.id));
      await db.delete(s.runtime).where(eq(s.runtime.key, `whatsapp.qr:${p.id}`));
      await db.delete(s.secrets).where(eq(s.secrets.connectionId, p.id));
      await db.delete(channelOAuthStates).where(eq(channelOAuthStates.connectionId, p.id));
      await log(db, ctx.tenantId, ctx.actor, 'channel.setup.deleted', p.id, {
        kind: connection.kind,
      });
    });
    return { message: 'Kanal Front Desk listesinden kaldırıldı.' };
  }
  if (action !== 'channel.setup.save')
    throw new HttpError(400, 'UNKNOWN_COMMAND', 'Kanal komutu bulunamadı.');
  const p = z
    .object({
      id: z.string().uuid().optional(),
      kind: z.enum([
        'whatsapp',
        'gmail',
        'outlook',
        'google_calendar',
        'microsoft_calendar',
        'sms',
        'ivr',
        'voice_whatsapp',
        'voice_phone',
      ]),
      name: z.string().trim().min(1).max(120),
      purpose: z.string().trim().min(1).max(8000),
      customerReplies: z.boolean().optional(),
      emailSend: z.boolean().default(false),
      calendarWrite: z.boolean().default(false),
      calendarId: z.string().trim().min(1).max(300).optional(),
    })
    .strict()
    .parse(payload);
  const id = p.id ?? randomUUID();
  const customerReplies = p.customerReplies ?? p.kind === 'whatsapp';
  await tenantDb(ctx.tenantId, async (db) => {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':channel-setup'},0))`,
    );

    if (beforeMutation) await beforeMutation(db);
    const old = p.id
      ? (await db.select().from(s.connections).where(eq(s.connections.id, id)))[0]
      : null;
    if (p.id && !old) throw new HttpError(404, 'NOT_FOUND', 'Kanal bulunamadı.');
    if (old?.deletedAt)
      throw new HttpError(404, 'NOT_FOUND', 'Kanal bulunamadı.');
    if (old && old.kind !== p.kind)
      throw new HttpError(
        409,
        'CHANNEL_KIND_CHANGED',
        'Mevcut kanalın sağlayıcısı değiştirilemez.',
      );
    const unsupported = ['sms', 'ivr', 'voice_whatsapp', 'voice_phone'].includes(p.kind),
      email = ['gmail', 'outlook'].includes(p.kind),
      calendar = ['google_calendar', 'microsoft_calendar'].includes(p.kind);
    const permissions =
      p.kind === 'whatsapp'
        ? ['message.send']
        : email
          ? ['email.read', 'email.draft', ...(p.emailSend ? ['email.send'] : [])]
          : calendar
            ? ['calendar.read', ...(p.calendarWrite ? ['calendar.create'] : [])]
            : [];
    const agents = ['admin', ...(customerReplies && !unsupported ? ['customer'] : [])];
    const revision = Number(old?.config.setupRevision ?? 0) + 1;
    const config = {
      guidedSetup: true,
      setupRevision: revision,
      customerReplies,
      emailSend: email && p.emailSend,
      calendarWrite: calendar && p.calendarWrite,
      ...(calendar ? { calendarId: p.calendarId ?? 'primary' } : {}),
      ...(p.kind === 'whatsapp'
        ? {
            mode: 'live',
            linkRequested: true,
            linkAttempt: Number(old?.config.linkAttempt ?? 0) + 1,
          }
        : {}),
      ...(p.kind === 'voice_phone'
        ? { preferredTransport: 'bluetooth', callAudioAvailable: false }
        : {}),
      ...(unsupported ? { adapterAvailable: false } : {}),
    };
    const values = {
      name: p.name,
      purpose: p.purpose,
      kind: p.kind,
      config,
      permissions,
      agents,
      status: p.kind === 'whatsapp' ? 'awaiting_test' : 'missing_info',
      lastError:
        p.kind === 'voice_phone'
          ? 'Bluetooth ve Apple arama aktarımı rehberi hazır; otomatik cevaplama ve AI görüşme sesi bağlantısı henüz desteklenmiyor.'
          : p.kind === 'voice_whatsapp'
            ? 'Baileys yazışmayı destekler; canlı aramayı cevaplama ve görüşme sesi bağlantısı henüz desteklenmiyor.'
            : unsupported
              ? 'Bu kanal için canlı bağlantı henüz desteklenmiyor.'
              : null,
      realAccountVerified: false,
      lastTestAt: null,
    };
    if (old) {
      await db.update(s.connections).set(values).where(eq(s.connections.id, id));
      if (p.kind !== 'whatsapp') await db.delete(s.secrets).where(eq(s.secrets.connectionId, id));
    } else await db.insert(s.connections).values({ tenantId: ctx.tenantId, id, ...values });
    if (p.kind === 'whatsapp')
      await db.delete(s.runtime).where(and(eq(s.runtime.key, `whatsapp.qr:${id}`)));
    await log(db, ctx.tenantId, ctx.actor, 'channel.setup.saved', id, {
      kind: p.kind,
      permissions,
      agents,
      status: values.status,
    });
  });
  return {
    message:
      p.kind === 'whatsapp'
        ? 'Kanal kaydedildi. WhatsApp QR koduyla bağlayın.'
        : 'Kanal kaydedildi. Hesap bağlantısını tamamlayın.',
    data: { id },
  };
}
