import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import * as schema from './schema.js';
import { env } from './env.js';

let pool: Pool | undefined;
let authPool: Pool | undefined;
let queue: Promise<PgBoss> | undefined;
export function getPool() {
  return (pool ??= new Pool({ connectionString: env('DATABASE_URL'), max: 12 }));
}
export function getAuthDb() {
  return drizzle((authPool ??= new Pool({ connectionString: env('AUTH_DATABASE_URL'), max: 5 })), {
    schema,
  });
}
export type TenantDb = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
export async function tenantDb<T>(tenantId: string, fn: (db: TenantDb) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('Invalid tenant context');
  return drizzle(getPool(), { schema }).transaction(async (db) => {
    await db.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(db);
  });
}
export function getQueue(): Promise<PgBoss> {
  return (queue ??= (async () => {
    const boss = new PgBoss({
      connectionString: env('DATABASE_URL'),
      schema: 'boss',
      createSchema: false,
      migrate: true,
      supervise: true,
    });
    boss.on('error', () => {
      /* Caller operation state remains the source of truth; no payload logging. */
    });
    await boss.start();
    await boss.createQueue('afterhours.operation', { retryLimit: 0 });
    await boss.createQueue('afterhours.conversation', {
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
    });
    return boss;
  })().catch((error) => {
    queue = undefined;
    throw error;
  }));
}
export async function enqueue(
  queueName: 'afterhours.operation' | 'afterhours.conversation',
  data: { tenantId: string; operationId?: string; conversationId?: string },
) {
  try {
    await (await getQueue()).send(queueName, data);
  } catch {
    /* Persisted queued rows are recovered by worker polling. */
  }
}
export async function closeDb() {
  if (queue) {
    const active = await queue.catch(() => null);
    if (active) await active.stop();
  }
  if (pool) await pool.end();
  if (authPool) await authPool.end();
  pool = undefined;
  authPool = undefined;
  queue = undefined;
}
