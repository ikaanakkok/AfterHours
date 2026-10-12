import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import { tenantDb, closeDb } from '../packages/core/src/db.js';
import * as s from '../packages/core/src/schema.js';
import { channelOAuthStates } from '../packages/core/src/channel-setup-schema.js';
import {
  handleChannelSetupCommand,
  channelSetupAvailability,
} from '../packages/core/src/channel-setup.js';
import { completeChannelOAuth } from '../packages/core/src/channel-oauth.js';
import { channelOAuthScopes } from '../packages/core/src/channel-oauth.js';
import { sendEmail } from '../packages/core/src/integrations/email.js';
import { getCalendarAvailability } from '../packages/core/src/integrations/calendar.js';
import { readConnectionSecret } from '../packages/core/src/security.js';
import type { TenantContext } from '../packages/core/src/types.js';
const tenantId = randomUUID();
let owner: Pool, ctx: TenantContext;
beforeAll(async () => {
  assertLocalDemoDatabase();
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const admin = (
    await owner.query('SELECT user_id FROM memberships WHERE tenant_id=$1 AND role=$2 LIMIT 1', [
      '11111111-1111-4111-8111-111111111111',
      'admin',
    ])
  ).rows[0];
  await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [tenantId, 'Channel setup test']);
  await owner.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
    tenantId,
    admin.user_id,
    'admin',
  ]);
  ctx = { tenantId, actor: { type: 'admin', id: admin.user_id }, role: 'admin' };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await owner.query('DELETE FROM channel_oauth_states WHERE tenant_id=$1', [tenantId]);
  await owner.query('DELETE FROM secrets WHERE tenant_id=$1', [tenantId]);
  await owner.query('DELETE FROM audit WHERE tenant_id=$1', [tenantId]);
  await owner.query('DELETE FROM connections WHERE tenant_id=$1', [tenantId]);
  await owner.query('DELETE FROM memberships WHERE tenant_id=$1', [tenantId]);
  await owner.query('DELETE FROM tenants WHERE id=$1', [tenantId]);
  await closeDb();
  await owner.end();
});
const save = (kind: string, extra = {}) =>
  handleChannelSetupCommand(ctx, 'channel.setup.save', {
    kind,
    name: 'Test channel',
    purpose: 'Customer requests',
    ...extra,
  });
async function connection(id: string) {
  return tenantDb(
    tenantId,
    async (db) => (await db.select().from(s.connections).where(eq(s.connections.id, id)))[0]!,
  );
}
describe('guided channel setup', () => {
  it('requests Outlook draft-write permission only for enabled sending and verifies delivery', async () => {
    vi.stubEnv('AFTERHOURS_MICROSOFT_CLIENT_ID', 'test-ms-client');
    vi.stubEnv('AFTERHOURS_MICROSOFT_CLIENT_SECRET', 'test-ms-secret');
    expect(channelOAuthScopes('outlook', { emailSend: false })).toContain('Mail.Read');
    expect(channelOAuthScopes('outlook', { emailSend: false })).not.toContain('Mail.ReadWrite');
    const id = String((await save('outlook', { emailSend: true })).data?.id);
    const url = new URL(
      String((await handleChannelSetupCommand(ctx, 'channel.oauth.start', { id })).data?.url),
    );
    const scopes = new Set(url.searchParams.get('scope')!.split(' '));
    let sent = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (target: string | URL, init?: RequestInit) => {
        const address = String(target);
        if (address.includes('/oauth2/v2.0/token'))
          return Response.json({
            access_token: 'outlook-access',
            refresh_token: 'outlook-refresh',
            token_type: 'Bearer',
            scope: [...scopes].join(' '),
            expires_in: 3600,
          });
        if (address.includes('/me?$select='))
          return Response.json({ mail: 'outlook@example.test' });
        if (address.endsWith('/send')) {
          if (!scopes.has('Mail.Send')) return new Response(null, { status: 403 });
          sent = true;
          return new Response(null, { status: 202 });
        }
        if (init?.method === 'POST') {
          if (!scopes.has('Mail.ReadWrite')) return new Response(null, { status: 403 });
          return Response.json({ id: 'new-outlook-message', isDraft: true });
        }
        return Response.json({
          value: sent
            ? [
                {
                  id: 'new-outlook-message',
                  isDraft: false,
                  sentDateTime: new Date().toISOString(),
                },
              ]
            : [],
        });
      }),
    );
    await completeChannelOAuth(ctx, {
      state: url.searchParams.get('state')!,
      code: 'outlook-code',
    });
    const conn = await connection(id);
    const result = await sendEmail(
      'outlook',
      conn.config,
      await readConnectionSecret(tenantId, id),
      {
        to: 'customer@example.test',
        subject: 'Test',
        body: 'Controlled test only',
        reference: 'outlook-setup-scope',
      },
    );
    expect(result.verified).toBe(true);
    expect(sent).toBe(true);
  });
  it('requests Google Calendar availability scope while keeping write consent optional', async () => {
    const read = channelOAuthScopes('google_calendar', { calendarWrite: false });
    const write = channelOAuthScopes('google_calendar', { calendarWrite: true });
    expect(read).toContain('https://www.googleapis.com/auth/calendar.readonly');
    expect(read).not.toContain('https://www.googleapis.com/auth/calendar.events');
    expect(write).toContain('https://www.googleapis.com/auth/calendar.events');
    const scopes = new Set(read);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (target: string | URL) => {
        if (
          String(target).endsWith('/freeBusy') &&
          scopes.has('https://www.googleapis.com/auth/calendar.readonly')
        )
          return Response.json({ calendars: { primary: { busy: [] } } });
        return new Response(null, { status: 403 });
      }),
    );
    const availability = await getCalendarAvailability(
      'google_calendar',
      { calendarId: 'primary' },
      { accessToken: 'calendar-test' },
      {
        start: '2026-10-12T06:00:00Z',
        end: '2026-10-12T15:00:00Z',
        timezone: 'Europe/Istanbul',
        duration: 45,
        buffer: 10,
        hours: [{ day: 1, start: '09:00', end: '18:00' }],
      },
    );
    expect(availability.slots.length).toBeGreaterThan(0);
  });
  it('creates live WhatsApp without raw grants and never marks unsupported SMS ready', async () => {
    const result = await save('whatsapp', { customerReplies: true });
    const c = await connection(String(result.data?.id));
    expect(c.status).toBe('awaiting_test');
    expect(c.config).toMatchObject({ mode: 'live', linkRequested: true, linkAttempt: 1 });
    expect(c.agents).toEqual(['admin', 'customer']);
    expect(c.permissions).toEqual(['message.send']);
    const sms = await connection(String((await save('sms')).data?.id));
    expect(sms.status).toBe('missing_info');
    expect(sms.realAccountVerified).toBe(false);
    await expect(save('gmail', { permissions: ['payment.link'] })).rejects.toThrow();
  });
  it('reports missing deployment OAuth instead of asking business owner for app credentials', async () => {
    vi.stubEnv('AFTERHOURS_GOOGLE_CLIENT_ID', '');
    vi.stubEnv('AFTERHOURS_GOOGLE_CLIENT_SECRET', '');
    expect(channelSetupAvailability().google).toBe(false);
    const id = String((await save('gmail')).data?.id);
    await expect(
      handleChannelSetupCommand(ctx, 'channel.oauth.start', { id }),
    ).rejects.toMatchObject({ code: 'OAUTH_SETUP_REQUIRED' });
    expect((await connection(id)).status).toBe('missing_info');
  });
  it('binds OAuth to initiating admin, PKCE, scopes and a single use state', async () => {
    vi.stubEnv('AFTERHOURS_GOOGLE_CLIENT_ID', 'test-client');
    vi.stubEnv('AFTERHOURS_GOOGLE_CLIENT_SECRET', 'test-client-secret');
    const id = String((await save('gmail', { emailSend: true })).data?.id);
    const start = await handleChannelSetupCommand(ctx, 'channel.oauth.start', { id });
    const url = new URL(String(start.data?.url));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('gmail.send');
    const state = url.searchParams.get('state')!;
    await expect(
      completeChannelOAuth(
        { ...ctx, actor: { type: 'admin', id: 'wrong-user' } },
        { state, code: 'fake-code' },
      ),
    ).rejects.toThrow();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'test-access',
            refresh_token: 'test-refresh',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: url.searchParams.get('scope'),
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ emailAddress: 'verified@example.test' })),
      );
    vi.stubGlobal('fetch', fetchMock);
    await completeChannelOAuth(ctx, { state, code: 'fake-code' });
    expect((await connection(id)).status).toBe('ready');
    expect((await connection(id)).config.accountEmail).toBe('verified@example.test');
    expect((await readConnectionSecret(tenantId, id)).accessToken).toBe('test-access');
    await expect(completeChannelOAuth(ctx, { state, code: 'fake-code' })).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('rejects missing granted scopes and leaves no credential vault', async () => {
    vi.stubEnv('AFTERHOURS_GOOGLE_CLIENT_ID', 'test-client');
    vi.stubEnv('AFTERHOURS_GOOGLE_CLIENT_SECRET', 'test-client-secret');
    const id = String((await save('gmail', { emailSend: true })).data?.id);
    const url = new URL(
      String((await handleChannelSetupCommand(ctx, 'channel.oauth.start', { id })).data?.url),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'unusable',
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
            token_type: 'Bearer',
          }),
        ),
      ),
    );
    await expect(
      completeChannelOAuth(ctx, { state: url.searchParams.get('state')!, code: 'fake' }),
    ).rejects.toMatchObject({ code: 'OAUTH_FAILED' });
    expect((await connection(id)).status).toBe('login_failed');
    expect(await readConnectionSecret(tenantId, id)).toEqual({});
  });
  it('rejects expired state and provider cancellation without exposing provider details', async () => {
    vi.stubEnv('AFTERHOURS_GOOGLE_CLIENT_ID', 'test-client');
    vi.stubEnv('AFTERHOURS_GOOGLE_CLIENT_SECRET', 'test-client-secret');
    const id = String((await save('gmail')).data?.id);
    const start = async () =>
      new URL(
        String((await handleChannelSetupCommand(ctx, 'channel.oauth.start', { id })).data?.url),
      ).searchParams.get('state')!;
    const expired = await start();
    await tenantDb(tenantId, (db) =>
      db
        .update(channelOAuthStates)
        .set({ expiresAt: new Date(0) })
        .where(eq(channelOAuthStates.connectionId, id)),
    );
    await expect(completeChannelOAuth(ctx, { state: expired, code: 'fake' })).rejects.toMatchObject(
      { code: 'OAUTH_STATE_INVALID' },
    );
    const state = await start();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      completeChannelOAuth(ctx, { state, error: 'access_denied: private-provider-details' }),
    ).rejects.toMatchObject({ code: 'OAUTH_FAILED' });
    expect((await connection(id)).lastError).not.toContain('private-provider-details');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('allows only one concurrent callback and invalidates the old attempt when reconnecting', async () => {
    vi.stubEnv('AFTERHOURS_GOOGLE_CLIENT_ID', 'test-client');
    vi.stubEnv('AFTERHOURS_GOOGLE_CLIENT_SECRET', 'test-client-secret');
    const id = String((await save('gmail')).data?.id);
    const first = new URL(
      String((await handleChannelSetupCommand(ctx, 'channel.oauth.start', { id })).data?.url),
    );
    const second = new URL(
      String((await handleChannelSetupCommand(ctx, 'channel.oauth.start', { id })).data?.url),
    );
    await expect(
      completeChannelOAuth(ctx, { state: first.searchParams.get('state')!, code: 'old' }),
    ).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'test-access',
            refresh_token: 'test-refresh',
            token_type: 'Bearer',
            scope: second.searchParams.get('scope'),
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ emailAddress: 'concurrent@example.test' })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const results = await Promise.allSettled([
      completeChannelOAuth(ctx, { state: second.searchParams.get('state')!, code: 'new' }),
      completeChannelOAuth(ctx, { state: second.searchParams.get('state')!, code: 'new' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await connection(id)).status).toBe('ready');
  });
});
