import {
  boolean,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { connections, operations, tenants, workflows } from './schema.js';
import type { Actor, JsonObject } from './types.js';
import type { UnifiedWorkflowPlan } from './unified-workflows.js';

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull().defaultRandom(),
    parentOperationId: uuid('parent_operation_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    workflowVersion: integer('workflow_version').notNull(),
    configVersion: integer('config_version').notNull(),
    actor: jsonb().$type<Actor>().notNull(),
    testing: boolean().notNull(),
    plan: jsonb().$type<UnifiedWorkflowPlan>().notNull(),
    dependencies: jsonb().$type<JsonObject>().notNull(),
    status: text().notNull().default('running'),
    error: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique().on(t.tenantId, t.parentOperationId),
    foreignKey({
      columns: [t.tenantId, t.workflowId],
      foreignColumns: [workflows.tenantId, workflows.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.parentOperationId],
      foreignColumns: [operations.tenantId, operations.id],
    }),
  ],
);
export const workflowRunSteps = pgTable(
  'workflow_run_steps',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull().defaultRandom(),
    runId: uuid('run_id').notNull(),
    position: integer().notNull(),
    stepId: text('step_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    kind: text().notNull(),
    status: text().notNull().default('pending'),
    concreteInputs: jsonb('concrete_inputs').$type<JsonObject>(),
    inputHash: text('input_hash'),
    operationId: uuid('operation_id'),
    preparationToken: uuid('preparation_token'),
    result: jsonb().$type<JsonObject>(),
    evidence: jsonb().$type<JsonObject>(),
    error: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique().on(t.tenantId, t.runId, t.position),
    unique().on(t.tenantId, t.runId, t.stepId),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [workflowRuns.tenantId, workflowRuns.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.operationId],
      foreignColumns: [operations.tenantId, operations.id],
    }),
  ],
);
