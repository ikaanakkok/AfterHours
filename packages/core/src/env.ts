import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';

export const projectRoot = process.env.AFTERHOURS_PROJECT_ROOT
  ? resolve(process.env.AFTERHOURS_PROJECT_ROOT) + sep
  : fileURLToPath(new URL('../../../', import.meta.url));
const envFile = join(projectRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing configuration: ${name}. Run pnpm setup.`);
  return value;
}
export const isDemo = () => process.env.AFTERHOURS_MODE === 'demo';
export function assertLocalDemoDatabase() {
  const database = new URL(env('MIGRATION_DATABASE_URL'));
  if (
    !isDemo() ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
    database.port !== '55432' ||
    database.pathname !== '/afterhours' ||
    database.username !== 'afterhours_owner'
  )
    throw new Error(
      'Demo setup and database tests require the dedicated local AfterHours database on port 55432.',
    );
}
