import {
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { connections, drafts, messages, tenants } from './schema.js';

/** Provider cursors and worker leases are internal and never exposed to model output. */
export const emailSyncStates = pgTable(
  'email_sync_states',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    connectionId: uuid('connection_id').notNull(),
    accountEmail: text('account_email').notNull(),
    cursor: text(),
    windowStartAt: timestamp('window_start_at', { withTimezone: true }),
    windowEndAt: timestamp('window_end_at', { withTimezone: true }),
    completedThroughAt: timestamp('completed_through_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    nextPollAt: timestamp('next_poll_at', { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.connectionId] }),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }),
  ],
);

export const emailMessages = pgTable(
  'email_messages',
  {
    tenantId: uuid('tenant_id').notNull(),
    messageId: uuid('message_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    accountEmail: text('account_email').notNull(),
    providerMessageId: text('provider_message_id').notNull(),
    sourceAddress: text('source_address').notNull(),
    threadId: text('thread_id').notNull(),
    internetMessageId: text('internet_message_id'),
    subject: text().notNull(),
    sourceDate: timestamp('source_date', { withTimezone: true }).notNull(),
    draftStatus: text('draft_status')
      .$type<'pending' | 'prepared' | 'not_requested'>()
      .notNull()
      .default('pending'),
    draftError: text('draft_error'),
    draftRetryAt: timestamp('draft_retry_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.messageId] }),
    unique().on(t.tenantId, t.connectionId, t.accountEmail, t.providerMessageId),
    foreignKey({
      columns: [t.tenantId, t.messageId],
      foreignColumns: [messages.tenantId, messages.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }),
  ],
);

export const emailDraftSources = pgTable(
  'email_draft_sources',
  {
    tenantId: uuid('tenant_id').notNull(),
    draftId: uuid('draft_id').notNull(),
    sourceMessageId: uuid('source_message_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.draftId] }),
    unique().on(t.tenantId, t.sourceMessageId),
    foreignKey({ columns: [t.tenantId, t.draftId], foreignColumns: [drafts.tenantId, drafts.id] }),
    foreignKey({
      columns: [t.tenantId, t.sourceMessageId],
      foreignColumns: [emailMessages.tenantId, emailMessages.messageId],
    }),
  ],
);
