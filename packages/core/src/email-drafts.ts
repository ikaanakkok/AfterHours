import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantDb } from './db.js';
import * as s from './schema.js';
import { emailDraftSources, emailMessages } from './email-schema.js';
import { HttpError } from './errors.js';
import { authorizeConnection } from './policy.js';
import { connectionView, log } from './store.js';
import type { Actor, JsonObject } from './types.js';

const draftInputSchema = z
  .object({
    to: z.string().email(),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(8000),
    sourceMessageId: z.string().uuid().optional(),
  })
  .strict();

type Connection = typeof s.connections.$inferSelect;
type Draft = typeof s.drafts.$inferSelect;

async function checkedSource(
  db: TenantDb,
  connection: Connection,
  input: Pick<Draft, 'to' | 'subject'>,
  sourceMessageId: string,
  lock = false,
) {
  const query = db.select().from(emailMessages).where(eq(emailMessages.messageId, sourceMessageId));
  const source = (await (lock ? query.for('update') : query))[0];
  if (!source)
    throw new HttpError(409, 'EMAIL_SOURCE_MISSING', 'Kaynak e-posta bu işletmede bulunamadı.');
  const message = (await db.select().from(s.messages).where(eq(s.messages.id, sourceMessageId)))[0];
  const conversation =
    message &&
    (
      await db.select().from(s.conversations).where(eq(s.conversations.id, message.conversationId))
    )[0];
  if (
    !message ||
    !conversation ||
    message.direction !== 'inbound' ||
    message.connectionId !== connection.id ||
    conversation.connectionId !== connection.id ||
    source.connectionId !== connection.id
  )
    throw new HttpError(
      409,
      'EMAIL_SOURCE_MISMATCH',
      'Kaynak mesaj bu hesabın gelen e-postası değil.',
    );
  if (
    source.accountEmail !==
      String(connection.config.accountEmail ?? '')
        .trim()
        .toLowerCase() ||
    source.sourceAddress.toLowerCase() !== input.to.toLowerCase() ||
    source.subject !== input.subject
  )
    throw new HttpError(
      409,
      'EMAIL_SOURCE_CHANGED',
      'Kaynak e-posta hesabı, alıcısı veya konusu değişti.',
    );
  return source;
}

/** Saves one reply per immutable inbound provider message within the caller's tenant transaction. */
export async function saveGuardedEmailDraft(
  db: TenantDb,
  tenantId: string,
  actor: Actor,
  connection: Connection,
  rawInput: unknown,
  details: JsonObject = {},
): Promise<Draft> {
  if (connection.tenantId !== tenantId || !['gmail', 'outlook'].includes(connection.kind))
    throw new HttpError(403, 'EMAIL_REQUIRED', 'Bu işletmenin e-posta bağlantısını seçin.');
  authorizeConnection(connectionView(connection), actor, 'email.draft', { testing: true });
  const { sourceMessageId, ...input } = draftInputSchema.parse(rawInput);
  if (sourceMessageId) {
    await checkedSource(db, connection, input, sourceMessageId, true);
    const existing = (
      await db
        .select({ draft: s.drafts })
        .from(emailDraftSources)
        .innerJoin(
          s.drafts,
          and(
            eq(s.drafts.tenantId, emailDraftSources.tenantId),
            eq(s.drafts.id, emailDraftSources.draftId),
          ),
        )
        .where(eq(emailDraftSources.sourceMessageId, sourceMessageId))
    )[0]?.draft;
    if (existing) {
      if (
        existing.connectionId !== connection.id ||
        existing.to.toLowerCase() !== input.to.toLowerCase() ||
        existing.subject !== input.subject ||
        existing.body !== input.body ||
        existing.status === 'sent'
      )
        throw new HttpError(
          409,
          'EMAIL_SOURCE_ALREADY_DRAFTED',
          'Kaynak e-posta için farklı veya gönderilmiş bir taslak var. Mevcut taslağı inceleyin.',
        );
      return existing;
    }
  }
  const draft = (
    await db
      .insert(s.drafts)
      .values({ tenantId, connectionId: connection.id, ...input })
      .returning()
  )[0]!;
  if (sourceMessageId)
    await db.insert(emailDraftSources).values({ tenantId, draftId: draft.id, sourceMessageId });
  await log(db, tenantId, actor, 'email.draft_prepared', draft.id, {
    to: draft.to,
    subject: draft.subject,
    sent: false,
    ...details,
  });
  return draft;
}

/** Derives reply routing from tenant-owned message metadata, never from model-provided thread IDs. */
export async function guardedEmailReplyContext(
  db: TenantDb,
  connection: Connection,
  draft: Draft,
): Promise<JsonObject> {
  if (draft.connectionId !== connection.id || draft.tenantId !== connection.tenantId)
    throw new HttpError(403, 'DRAFT_CONNECTION_MISMATCH', 'Taslak e-posta bağlantısına ait değil.');
  const relation = (
    await db.select().from(emailDraftSources).where(eq(emailDraftSources.draftId, draft.id))
  )[0];
  if (!relation) return {};
  const source = await checkedSource(db, connection, draft, relation.sourceMessageId);
  return {
    threadId: source.threadId,
    sourceMessageId: source.providerMessageId,
    ...(source.internetMessageId &&
    /^<[^<>\s\u0000-\u001f\u007f]+>$/.test(source.internetMessageId) &&
    source.internetMessageId.length <= 998
      ? { inReplyTo: source.internetMessageId }
      : {}),
  };
}
