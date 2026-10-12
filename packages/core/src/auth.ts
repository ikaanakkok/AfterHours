import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { getAuthDb } from './db.js';
import { env } from './env.js';
import { user, session, account, verification } from './schema.js';

export const auth = betterAuth({
  appName: 'AfterHours',
  baseURL: env('AFTERHOURS_APP_URL'),
  secret: env('BETTER_AUTH_SECRET'),
  database: drizzleAdapter(getAuthDb(), {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.AFTERHOURS_SEED_SIGNUP !== '1',
    minPasswordLength: 12,
  },
  trustedOrigins: [env('AFTERHOURS_APP_URL')],
  advanced: {
    cookiePrefix: 'afterhours',
    useSecureCookies: env('AFTERHOURS_APP_URL').startsWith('https://'),
  },
  rateLimit: { enabled: true, window: 60, max: 60 },
});
