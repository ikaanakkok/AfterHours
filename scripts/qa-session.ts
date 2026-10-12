import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { auth } from '../packages/core/src/auth.js';
import { closeDb } from '../packages/core/src/db.js';
import { env, isDemo, projectRoot } from '../packages/core/src/env.js';
import { join } from 'node:path';

// Test-only local authentication. Passwords and cookie values are never printed.
const origin = new URL(env('AFTERHOURS_APP_URL'));
if (!isDemo() || origin.hostname !== '127.0.0.1')
  throw new Error('QA sessions are limited to the local demo.');
const access = JSON.parse(readFileSync(join(projectRoot, '.data/demo-access.json'), 'utf8')) as {
  password: string;
};
const email = process.argv[2] === 'staff' ? 'staff@afterhours.local' : 'admin@afterhours.local';
try {
  const response = await auth.api.signInEmail({
    body: { email, password: access.password },
    asResponse: true,
  });
  if (!response.ok) throw new Error('Local demo login failed. Run pnpm seed.');
  const cookies = response.headers.getSetCookie().map((line) => {
    const [pair, ...attributes] = line.split(';');
    const delimiter = pair!.indexOf('=');
    const properties = new Map(
      attributes.map((value) => {
        const [key, ...parts] = value.trim().split('=');
        return [key!.toLowerCase(), parts.join('=')];
      }),
    );
    return {
      name: pair!.slice(0, delimiter),
      value: pair!.slice(delimiter + 1),
      domain: origin.hostname,
      path: properties.get('path') || '/',
      httpOnly: properties.has('httponly'),
      secure: properties.has('secure'),
      sameSite: 'Lax',
      expires: properties.has('max-age')
        ? Date.now() / 1000 + Number(properties.get('max-age'))
        : -1,
    };
  });
  if (!cookies.length) throw new Error('Demo login did not return a session.');
  mkdirSync(join(projectRoot, '.data/qa'), { recursive: true, mode: 0o700 });
  const path = join(
    projectRoot,
    `.data/qa/${email.startsWith('staff') ? 'staff' : 'admin'}-cookies.json`,
  );
  writeFileSync(path, JSON.stringify(cookies), { mode: 0o600 });
  console.log(`Local QA session saved: ${path}`);
} finally {
  await closeDb();
}
