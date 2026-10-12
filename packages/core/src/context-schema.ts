import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { tenants } from './schema.js';
import type { ContextKind, ContextStatus } from './context-types.js';
export const contextCorpora = pgTable('context_corpora', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  version: integer().notNull().default(0),
  analyzedVersion: integer('analyzed_version'),
  status: text().notNull().default('empty'),
  error: text(),
  analysisToken: uuid('analysis_token'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const contextAttachments = pgTable(
  'context_attachments',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull().defaultRandom(),
    title: text().notNull(),
    kind: text().$type<ContextKind>().notNull(),
    status: text().$type<ContextStatus>().notNull().default('awaiting_provider'),
    summary: text(),
    error: text(),
    url: text(),
    mime: text(),
    extractedText: text('extracted_text').notNull().default(''),
    fileData: text('file_data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
export const contextQuestions = pgTable(
  'context_questions',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid().notNull().defaultRandom(),
    fingerprint: text().notNull(),
    prompt: text().notNull(),
    reason: text().notNull(),
    sourceIds: jsonb('source_ids').$type<string[]>().notNull(),
    status: text().$type<'open' | 'answered'>().notNull().default('open'),
    answer: text(),
    corpusVersion: integer('corpus_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [contextCorpora.tenantId] }).onDelete(
      'cascade',
    ),
  ],
);
