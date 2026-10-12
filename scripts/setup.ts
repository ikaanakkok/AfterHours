import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

if (!existsSync('.env')) {
  const owner = randomBytes(24).toString('hex'),
    app = randomBytes(24).toString('hex'),
    auth = randomBytes(24).toString('hex');
  const lines = [
    'AFTERHOURS_MODE=demo',
    'AFTERHOURS_APP_URL=http://127.0.0.1:3000',
    `POSTGRES_OWNER_PASSWORD=${owner}`,
    `POSTGRES_APP_PASSWORD=${app}`,
    `POSTGRES_AUTH_PASSWORD=${auth}`,
    `MIGRATION_DATABASE_URL=postgresql://afterhours_owner:${owner}@127.0.0.1:55432/afterhours`,
    `DATABASE_URL=postgresql://afterhours_app:${app}@127.0.0.1:55432/afterhours`,
    `AUTH_DATABASE_URL=postgresql://afterhours_auth:${auth}@127.0.0.1:55432/afterhours`,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}`,
    'AFTERHOURS_FIXTURE_URL=http://127.0.0.1:4001',
  ];
  writeFileSync('.env', lines.join('\n') + '\n', { mode: 0o600 });
  console.log('Local .env created with unique credentials. No accounts are connected.');
} else console.log('Existing .env preserved.');
mkdirSync('.data', { recursive: true, mode: 0o700 });
if (process.platform === 'darwin') {
  try {
    execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'AfterHours.local.master', '-a', 'afterhours'],
      { stdio: 'ignore' },
    );
    console.log('Existing Mac Keychain encryption key preserved.');
  } catch {
    execFileSync(
      '/usr/bin/security',
      [
        'add-generic-password',
        '-s',
        'AfterHours.local.master',
        '-a',
        'afterhours',
        '-w',
        randomBytes(32).toString('hex'),
      ],
      { stdio: 'ignore' },
    );
    console.log('Encryption master key stored in Mac Keychain.');
  }
} else console.log('Live credential storage requires Mac Keychain.');
console.log('Next: pnpm db:up, pnpm db:migrate, pnpm seed.');
