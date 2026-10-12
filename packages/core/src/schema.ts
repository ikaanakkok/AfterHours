import {
  pgSchema,
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  unique,
  foreignKey,
} from 'drizzle-orm/pg-core';
import type { WorkflowClarification } from './workflow-clarifications.js';
import type { Actor, BusinessConfig, JsonObject, WorkflowDefinition } from './types.js';

const authSchema = pgSchema('auth');
export const user = authSchema.table('user', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const session = authSchema.table('session', {
  id: text().primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text().notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});
export const account = authSchema.table('account', {
  id: text().primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text(),
  password: text(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const verification = authSchema.table('verification', {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const tenants = pgTable('tenants', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const memberships = pgTable(
  'memberships',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    role: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);
const base = () => ({
  id: uuid().notNull().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const configurations = pgTable(
  'configurations',
  {
    ...base(),
    version: integer().notNull(),
    value: jsonb().$type<BusinessConfig>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), unique().on(t.tenantId, t.version)],
);
export const connections = pgTable(
  'connections',
  {
    ...base(),
    name: text().notNull(),
    kind: text().notNull(),
    purpose: text().notNull(),
    status: text().notNull().default('missing_info'),
    config: jsonb().$type<JsonObject>().notNull().default({}),
    permissions: jsonb().$type<string[]>().notNull().default([]),
    agents: jsonb().$type<string[]>().notNull().default([]),
    lastTestAt: timestamp('last_test_at', { withTimezone: true }),
    lastError: text('last_error'),
    realAccountVerified: boolean('real_account_verified').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
export const workflows = pgTable(
  'workflows',
  {
    ...base(),
    name: text().notNull(),
    purpose: text().notNull(),
    connectionId: uuid('connection_id'),
    version: integer().notNull().default(1),
    definition: jsonb().$type<WorkflowDefinition>().notNull(),
    publishedDefinition: jsonb('published_definition').$type<WorkflowDefinition>(),
    publishedVersion: integer('published_version'),
    status: text().notNull().default('awaiting_test'),
    sourceText: text('source_text'),
    mode: text().notNull().default('legacy'),
    enabled: boolean().notNull().default(false),
    systemIds: jsonb('system_ids').$type<string[]>().notNull().default([]),
    schedule: jsonb().$type<{ expression: string; timezone: string }>(),
    planningError: text('planning_error'),
    compiledPlan: jsonb('compiled_plan').$type<JsonObject>(),
    clarification: jsonb().$type<WorkflowClarification>(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }),
  ],
);
export const cronJobs = pgTable(
  'cron_jobs',
  {
    ...base(),
    name: text().notNull(),
    expression: text().notNull(),
    timezone: text().notNull(),
    workflowId: uuid('workflow_id').notNull(),
    inputs: jsonb().$type<JsonObject>().notNull(),
    enabled: boolean().notNull().default(false),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastResult: text('last_result'),
    version: integer().notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.workflowId],
      foreignColumns: [workflows.tenantId, workflows.id],
    }),
  ],
);
export const conversations = pgTable(
  'conversations',
  {
    ...base(),
    connectionId: uuid('connection_id').notNull(),
    channel: text().notNull(),
    customerName: text('customer_name').notNull(),
    customerAddress: text('customer_address').notNull(),
    threadKey: text('thread_key').notNull().default(''),
    mode: text().notNull().default('ai'),
    requestState: text('request_state')
      .$type<'idle' | 'collecting' | 'completed'>()
      .notNull()
      .default('idle'),
    inputs: jsonb().$type<JsonObject>().notNull().default({}),
    lastProcessedId: uuid('last_processed_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('conversations_tenant_connection_address_thread_unique').on(
      t.tenantId,
      t.connectionId,
      t.customerAddress,
      t.threadKey,
    ),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }),
  ],
);
export const messages = pgTable(
  'messages',
  {
    ...base(),
    conversationId: uuid('conversation_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    externalId: text('external_id').notNull(),
    direction: text().notNull(),
    body: text().notNull(),
    status: text().notNull(),
    attempts: integer().notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    providerId: text('provider_id'),
    error: text(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique().on(t.tenantId, t.connectionId, t.externalId),
    foreignKey({
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }),
  ],
);
export const operations = pgTable(
  'operations',
  {
    ...base(),
    capability: text().notNull(),
    status: text().notNull().default('queued'),
    actor: jsonb().$type<Actor>().notNull(),
    connectionId: uuid('connection_id'),
    workflowId: uuid('workflow_id'),
    conversationId: uuid('conversation_id'),
    cronId: uuid('cron_id'),
    configVersion: integer('config_version').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    inputs: jsonb().$type<JsonObject>().notNull(),
    result: jsonb().$type<JsonObject>(),
    error: text(),
    attempts: integer().notNull().default(0),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique().on(t.tenantId, t.idempotencyKey),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.workflowId],
      foreignColumns: [workflows.tenantId, workflows.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.cronId],
      foreignColumns: [cronJobs.tenantId, cronJobs.id],
    }),
  ],
);
export const trials = pgTable(
  'trials',
  {
    ...base(),
    workflowId: uuid('workflow_id').notNull(),
    version: integer().notNull(),
    inputHash: text('input_hash').notNull(),
    operationId: uuid('operation_id').notNull(),
    verified: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique().on(t.tenantId, t.workflowId, t.version, t.inputHash),
    foreignKey({
      columns: [t.tenantId, t.workflowId],
      foreignColumns: [workflows.tenantId, workflows.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.operationId],
      foreignColumns: [operations.tenantId, operations.id],
    }),
  ],
);
export const approvals = pgTable(
  'approvals',
  {
    ...base(),
    kind: text().notNull(),
    title: text().notNull(),
    summary: text().notNull(),
    status: text().notNull().default('pending'),
    operationId: uuid('operation_id'),
    payload: jsonb().$type<JsonObject>().notNull(),
    payloadHash: text('payload_hash').notNull(),
    configVersion: integer('config_version').notNull(),
    decidedBy: text('decided_by'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.operationId],
      foreignColumns: [operations.tenantId, operations.id],
    }),
  ],
);
export const handoffs = pgTable(
  'handoffs',
  {
    ...base(),
    conversationId: uuid('conversation_id'),
    operationId: uuid('operation_id'),
    reason: text().notNull(),
    status: text().notNull().default('open'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.operationId],
      foreignColumns: [operations.tenantId, operations.id],
    }),
  ],
);
export const audit = pgTable(
  'audit',
  {
    ...base(),
    event: text().notNull(),
    actor: jsonb().$type<Actor>().notNull(),
    targetId: text('target_id'),
    details: jsonb().$type<JsonObject>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
export const drafts = pgTable(
  'drafts',
  {
    ...base(),
    connectionId: uuid('connection_id').notNull(),
    to: text().notNull(),
    subject: text().notNull(),
    body: text().notNull(),
    status: text().notNull().default('draft'),
    providerId: text('provider_id'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }),
  ],
);
export const calendarEvents = pgTable(
  'calendar_events',
  {
    ...base(),
    connectionId: uuid('connection_id').notNull(),
    title: text().notNull(),
    start: timestamp('start', { withTimezone: true }).notNull(),
    end: timestamp('end', { withTimezone: true }).notNull(),
    status: text().notNull(),
    providerId: text('provider_id'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }),
  ],
);
export const proposals = pgTable(
  'proposals',
  {
    ...base(),
    summary: text().notNull(),
    baseVersion: integer('base_version').notNull(),
    status: text().notNull().default('pending'),
    patch: jsonb().$type<JsonObject>().notNull(),
    risk: text().notNull(),
    approvalId: uuid('approval_id'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.approvalId],
      foreignColumns: [approvals.tenantId, approvals.id],
    }),
  ],
);
export const adminMessages = pgTable(
  'admin_messages',
  { ...base(), role: text().notNull(), body: text().notNull() },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
export const secrets = pgTable(
  'secrets',
  { ...base(), connectionId: uuid('connection_id').notNull(), ciphertext: text().notNull() },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique().on(t.tenantId, t.connectionId),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }),
  ],
);
export const paymentRecords = pgTable(
  'payment_records',
  {
    ...base(),
    externalRecordId: text('external_record_id').notNull(),
    amount: integer().notNull(),
    currency: text().notNull(),
    verified: boolean().notNull(),
    paymentLink: text('payment_link'),
    providerId: text('provider_id'),
    status: text().notNull().default('unpaid'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), unique().on(t.tenantId, t.externalRecordId)],
);
export const providerEvents = pgTable(
  'provider_events',
  { ...base(), externalId: text('external_id').notNull(), kind: text().notNull() },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), unique().on(t.tenantId, t.externalId)],
);
export const runtime = pgTable(
  'runtime',
  {
    ...base(),
    key: text().notNull(),
    value: jsonb().$type<JsonObject>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), unique().on(t.tenantId, t.key)],
);
