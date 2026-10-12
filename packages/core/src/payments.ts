import { and, eq } from 'drizzle-orm';
import { tenantDb } from './db.js';
import * as s from './schema.js';
import { readConnectionSecret } from './security.js';
import { verifyPaymentWebhook } from './integrations/index.js';
import { currentConfig, log } from './store.js';
import { HttpError } from './errors.js';

export async function handleStripeWebhook(
  tenantId: string,
  connectionId: string,
  rawBody: string,
  signature: string,
): Promise<{ accepted: boolean; duplicate: boolean }> {
  const conn = await tenantDb(
    tenantId,
    async (db) =>
      (await db.select().from(s.connections).where(eq(s.connections.id, connectionId)))[0],
  );
  if (!conn || conn.kind !== 'stripe')
    throw new HttpError(404, 'PROVIDER_NOT_FOUND', 'Ödeme bağlantısı bulunamadı.');
  let event;
  try {
    event = verifyPaymentWebhook(
      rawBody,
      signature,
      await readConnectionSecret(tenantId, connectionId),
    );
  } catch {
    throw new HttpError(400, 'INVALID_PROVIDER_SIGNATURE', 'Sağlayıcı imzası doğrulanamadı.');
  }
  if (
    event.account !== conn.config.connectedAccount ||
    event.livemode !== (conn.config.environment === 'live')
  )
    throw new HttpError(
      400,
      'PROVIDER_ACCOUNT_MISMATCH',
      'Sağlayıcı hesabı veya ortamı bağlantıyla eşleşmiyor.',
    );
  return tenantDb(tenantId, async (db) => {
    const inserted = await db
      .insert(s.providerEvents)
      .values({ tenantId, externalId: event.id, kind: event.type })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return { accepted: true, duplicate: true };
    const data = event.data,
      metadata =
        data.metadata && typeof data.metadata === 'object'
          ? (data.metadata as Record<string, unknown>)
          : {};
    if (
      ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(
        event.type,
      ) &&
      data.payment_status === 'paid'
    ) {
      const record = (
        await db
          .select()
          .from(s.paymentRecords)
          .where(eq(s.paymentRecords.id, String(metadata.afterhoursRecordId)))
      )[0];
      if (
        !record ||
        !record.verified ||
        record.amount !== data.amount_total ||
        record.currency !== data.currency ||
        record.providerId !== data.payment_link
      )
        throw new HttpError(
          409,
          'PAYMENT_RECORD_MISMATCH',
          'Ödeme sonucu doğrulanmış kayıt, bağlantı ve tutarla eşleşmiyor.',
        );
      await db
        .update(s.paymentRecords)
        .set({ status: 'paid' })
        .where(eq(s.paymentRecords.id, record.id));
      await log(
        db,
        tenantId,
        { type: 'system', id: 'stripe' },
        'payment.provider_verified',
        record.id,
        {
          providerEventId: event.id,
          amount: record.amount,
          currency: record.currency,
          account: event.account,
        },
      );
    } else
      await log(
        db,
        tenantId,
        { type: 'system', id: 'stripe' },
        'payment.provider_event_received',
        null,
        { providerEventId: event.id, type: event.type, paid: false },
      );
    return { accepted: true, duplicate: false };
  });
}
