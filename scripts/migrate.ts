import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
process.loadEnvFile('.env');
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const quote = (v: string) => `'${v.replaceAll("'", "''")}'`;
try {
  const app = process.env.POSTGRES_APP_PASSWORD,
    auth = process.env.POSTGRES_AUTH_PASSWORD;
  if (!app || !auth) throw new Error('Missing database role passwords. Run pnpm setup.');
  await pool.query(
    `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='afterhours_app') THEN CREATE ROLE afterhours_app LOGIN PASSWORD ${quote(app)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='afterhours_auth') THEN CREATE ROLE afterhours_auth LOGIN PASSWORD ${quote(auth)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF; END $$;`,
  );
  await pool.query(
    'CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS public.afterhours_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  for (const file of readdirSync('migrations')
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    if ((await pool.query('SELECT name FROM afterhours_migrations WHERE name=$1', [file])).rowCount)
      continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(`migrations/${file}`, 'utf8'));
      await client.query('INSERT INTO afterhours_migrations(name) VALUES($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  await pool.query(
    'CREATE SCHEMA IF NOT EXISTS boss AUTHORIZATION afterhours_app; GRANT USAGE ON SCHEMA public TO afterhours_app, afterhours_auth; GRANT USAGE ON SCHEMA auth TO afterhours_auth; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA auth TO afterhours_auth; GRANT SELECT ON tenants,memberships TO afterhours_app,afterhours_auth;',
  );
  const rows = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('tenants','memberships','afterhours_migrations')",
  );
  for (const { tablename } of rows.rows) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error('Unexpected table');
    await pool.query(
      `ALTER TABLE "${tablename}" ENABLE ROW LEVEL SECURITY; ALTER TABLE "${tablename}" FORCE ROW LEVEL SECURITY; DROP POLICY IF EXISTS tenant_scope ON "${tablename}"; CREATE POLICY tenant_scope ON "${tablename}" TO afterhours_app USING (tenant_id::text = current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id',true)); GRANT SELECT,INSERT,UPDATE,DELETE ON "${tablename}" TO afterhours_app;`,
    );
  }
  await pool.query(
    'REVOKE UPDATE,DELETE ON audit FROM afterhours_app; REVOKE ALL ON SCHEMA public FROM PUBLIC; ALTER ROLE afterhours_app SET statement_timeout=30000; ALTER ROLE afterhours_auth SET statement_timeout=30000;',
  );
  console.log('Tenant RLS, composite relations, runtime roles and append-only audit applied.');
} finally {
  await pool.end();
}
