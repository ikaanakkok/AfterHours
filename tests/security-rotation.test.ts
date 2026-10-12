import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import { closeDb, tenantDb } from '../packages/core/src/db.js';
import * as s from '../packages/core/src/schema.js';
import {
  readConnectionSecret,
  rotateConnectionSecret,
  stableHash,
  writeConnectionSecret,
} from '../packages/core/src/security.js';

const tenantId = randomUUID(),
  connectionId = randomUUID();
let owner: Pool;
beforeAll(async () => {
  assertLocalDemoDatabase();
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [
    tenantId,
    'Credential CAS test',
  ]);
  await tenantDb(tenantId, (db) =>
    db.insert(s.connections).values({
      tenantId,
      id: connectionId,
      name: 'Controlled account',
      kind: 'gmail',
      purpose: 'Local CAS test',
    }),
  );
});
afterAll(async () => {
  await owner.query('DELETE FROM secrets WHERE tenant_id=$1', [tenantId]);
  await owner.query('DELETE FROM connections WHERE tenant_id=$1', [tenantId]);
  await owner.query('DELETE FROM tenants WHERE id=$1', [tenantId]);
  await owner.end();
  await closeDb();
});
describe('atomic credential rotation', () => {
  it('permits one concurrent refresh and refuses a second stale writer', async () => {
    const before = { accessToken: 'controlled-initial' };
    await writeConnectionSecret(tenantId, connectionId, before);
    const results = await Promise.all([
      rotateConnectionSecret(tenantId, connectionId, stableHash(before), {
        accessToken: 'controlled-one',
      }),
      rotateConnectionSecret(tenantId, connectionId, stableHash(before), {
        accessToken: 'controlled-two',
      }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(['controlled-one', 'controlled-two']).toContain(
      (await readConnectionSecret(tenantId, connectionId)).accessToken,
    );
  });
  it('preserves a newer reconnect and never recreates cleared credentials', async () => {
    const before = { accessToken: 'controlled-old' };
    await writeConnectionSecret(tenantId, connectionId, before);
    await writeConnectionSecret(tenantId, connectionId, { accessToken: 'controlled-reconnected' });
    expect(
      await rotateConnectionSecret(tenantId, connectionId, stableHash(before), {
        accessToken: 'controlled-stale',
      }),
    ).toBe(false);
    expect((await readConnectionSecret(tenantId, connectionId)).accessToken).toBe(
      'controlled-reconnected',
    );
    await tenantDb(tenantId, (db) =>
      db.delete(s.secrets).where(eq(s.secrets.connectionId, connectionId)),
    );
    expect(
      await rotateConnectionSecret(tenantId, connectionId, stableHash(before), {
        accessToken: 'controlled-stale',
      }),
    ).toBe(false);
    expect(await readConnectionSecret(tenantId, connectionId)).toEqual({});
  });
  it('cannot rotate another tenant connection', async () => {
    expect(
      await rotateConnectionSecret(randomUUID(), connectionId, stableHash({}), {
        accessToken: 'controlled-cross-tenant',
      }),
    ).toBe(false);
  });
});
