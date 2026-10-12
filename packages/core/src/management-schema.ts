import { foreignKey, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { adminMessages, memberships, tenants } from './schema.js';
import type { ManagementDependencies, ManagementPlanStatus, ManagementStep } from './management.js';

export const managementPlans = pgTable(
  'management_plans',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull().defaultRandom(),
    messageId: uuid('message_id').notNull(),
    userId: text('user_id').notNull(),
    summary: text().notNull(),
    status: text().$type<ManagementPlanStatus>().notNull().default('pending'),
    dependencies: jsonb().$type<ManagementDependencies>().notNull(),
    steps: jsonb().$type<ManagementStep[]>().notNull(),
    error: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.messageId],
      foreignColumns: [adminMessages.tenantId, adminMessages.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
  ],
);
