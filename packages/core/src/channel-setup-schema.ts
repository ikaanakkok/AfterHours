import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  primaryKey,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { connections, tenants } from './schema.js';
export const channelOAuthStates = pgTable(
  'channel_oauth_states',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull().defaultRandom(),
    connectionId: uuid('connection_id').notNull(),
    userId: text('user_id').notNull(),
    stateHash: text('state_hash').notNull(),
    verifierCiphertext: text('verifier_ciphertext').notNull(),
    revision: integer().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [connections.tenantId, connections.id],
    }),
  ],
);
