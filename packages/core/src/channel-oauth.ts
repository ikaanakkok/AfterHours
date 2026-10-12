import { randomBytes, createHash } from 'node:crypto';
import { and, eq, isNull, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { tenantDb } from './db.js';
import * as s from './schema.js';
import { channelOAuthStates as states } from './channel-setup-schema.js';
import { encryptSecret, decryptSecret } from './security.js';
import { assertMembership, getContext } from './context.js';
import { HttpError, requireAdmin } from './errors.js';
import { log } from './store.js';
import { requestJson } from './integrations/http.js';
import type { TenantContext, CommandResult, JsonObject } from './types.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function deployment(kind: string) {
  const google = ['gmail', 'google_calendar'].includes(kind),
    microsoft = ['outlook', 'microsoft_calendar'].includes(kind);
  if (!google && !microsoft)
    throw new HttpError(400, 'OAUTH_KIND_INVALID', 'Google veya Microsoft kanalı seçin.');
  const prefix = google ? 'AFTERHOURS_GOOGLE' : 'AFTERHOURS_MICROSOFT';
  const clientId = process.env[`${prefix}_CLIENT_ID`],
    clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret)
    throw new HttpError(
      409,
      'OAUTH_SETUP_REQUIRED',
      'Bu sağlayıcının uygulama bağlantısı kurulum ekibi tarafından henüz hazırlanmadı. Sizden API anahtarı veya teknik ayar istenmiyor.',
    );
  const origin = new URL(process.env.AFTERHOURS_APP_URL || 'http://127.0.0.1:3000');
  if (
    origin.protocol !== 'https:' &&
    !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))
  )
    throw new HttpError(409, 'OAUTH_SETUP_REQUIRED', 'Güvenli uygulama adresi yapılandırılmalı.');
  return {
    google,
    clientId,
    clientSecret,
    redirectUri: new URL('/api/channels/oauth/callback', origin).href,
    authorize: google
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: google
      ? 'https://oauth2.googleapis.com/token'
      : 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  };
}
export function channelOAuthScopes(kind: string, config: JsonObject): string[] {
  if (kind === 'gmail')
    return [
      'https://www.googleapis.com/auth/gmail.readonly',
      ...(config.emailSend === true ? ['https://www.googleapis.com/auth/gmail.send'] : []),
    ];
  if (kind === 'google_calendar')
    return [
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
      ...(config.calendarWrite === true ? ['https://www.googleapis.com/auth/calendar.events'] : []),
    ];
  if (kind === 'outlook')
    return [
      'offline_access',
      'User.Read',
      config.emailSend === true ? 'Mail.ReadWrite' : 'Mail.Read',
      ...(config.emailSend === true ? ['Mail.Send'] : []),
    ];
  if (kind === 'microsoft_calendar')
    return [
      'offline_access',
      'User.Read',
      config.calendarWrite === true ? 'Calendars.ReadWrite' : 'Calendars.Read',
    ];
  throw new HttpError(400, 'OAUTH_KIND_INVALID', 'Bu kanal OAuth kullanmıyor.');
}
export async function startChannelOAuth(
  ctx: TenantContext,
  id: string,
  beforeMutation?: (db: import('./db.js').TenantDb) => Promise<void>,
): Promise<CommandResult> {
  await assertMembership(ctx);
  requireAdmin(ctx.role);
  return tenantDb(ctx.tenantId, async (db) => {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':channel-setup'},0))`,
    );

    if (beforeMutation) await beforeMutation(db);
    const conn = (await db.select().from(s.connections).where(eq(s.connections.id, id)))[0];
    if (!conn || conn.config.guidedSetup !== true)
      throw new HttpError(404, 'CHANNEL_NOT_FOUND', 'Önce kanal kurulumunu kaydedin.');
    const app = deployment(conn.kind),
      scopes = channelOAuthScopes(conn.kind, conn.config);
    const revision = Number(conn.config.setupRevision) + 1;
    const state = `${ctx.tenantId}.${randomBytes(32).toString('base64url')}`,
      verifier = randomBytes(48).toString('base64url');
    await db
      .update(states)
      .set({ consumedAt: new Date() })
      .where(and(eq(states.connectionId, id), isNull(states.consumedAt)));
    await db.insert(states).values({
      tenantId: ctx.tenantId,
      connectionId: id,
      userId: ctx.actor.id,
      stateHash: hash(state),
      revision,
      verifierCiphertext: await encryptSecret(ctx.tenantId, id, { verifier, scopes }),
      expiresAt: new Date(Date.now() + 600_000),
    });
    await db
      .update(s.connections)
      .set({
        status: 'awaiting_test',
        lastError: null,
        realAccountVerified: false,
        config: { ...conn.config, setupRevision: revision },
      })
      .where(eq(s.connections.id, id));
    const url = new URL(app.authorize);
    url.search = new URLSearchParams({
      client_id: app.clientId,
      response_type: 'code',
      redirect_uri: app.redirectUri,
      scope: scopes.join(' '),
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      ...(app.google
        ? { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' }
        : { response_mode: 'query', prompt: 'select_account' }),
    }).toString();
    await log(db, ctx.tenantId, ctx.actor, 'channel.oauth.started', id, {
      kind: conn.kind,
      scopes,
    });
    return { message: 'Hesabınızı sağlayıcının güvenli ekranında seçin.', data: { url: url.href } };
  });
}
const callbackSchema = z
  .object({
    state: z
      .string()
      .min(70)
      .max(150)
      .regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/),
    code: z.string().min(1).max(8000).optional(),
    error: z.string().max(2000).optional(),
  })
  .strict();
export async function completeChannelOAuthFromHeaders(headers: Headers, input: unknown) {
  const p = callbackSchema.parse(input);
  const tenantId = p.state.slice(0, 36);
  const ctx = await getContext(headers, tenantId);
  return completeChannelOAuth(ctx, p);
}
export async function completeChannelOAuth(
  ctx: TenantContext,
  input: unknown,
): Promise<{ connectionId: string }> {
  const p = callbackSchema.parse(input);
  await assertMembership(ctx);
  requireAdmin(ctx.role);
  if (p.state.slice(0, 36) !== ctx.tenantId)
    throw new HttpError(409, 'OAUTH_STATE_INVALID', 'Bağlantı isteği geçersiz veya süresi dolmuş.');
  const claim = await tenantDb(ctx.tenantId, async (db) => {
    const rows = await db
      .update(states)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(states.stateHash, hash(p.state)),
          eq(states.userId, ctx.actor.id),
          isNull(states.consumedAt),
          gt(states.expiresAt, new Date()),
        ),
      )
      .returning();
    const state = rows[0];
    if (!state)
      throw new HttpError(
        409,
        'OAUTH_STATE_INVALID',
        'Bağlantı isteği geçersiz, kullanılmış veya süresi dolmuş.',
      );
    const conn = (
      await db.select().from(s.connections).where(eq(s.connections.id, state.connectionId))
    )[0];
    if (!conn || conn.status === 'disabled' || Number(conn.config.setupRevision) !== state.revision)
      throw new HttpError(
        409,
        'OAUTH_STATE_INVALID',
        'Kanal ayarları değişti. Bağlantıyı yeniden başlatın.',
      );
    return { state, conn };
  });
  const { state, conn } = claim;
  try {
    if (p.error || !p.code) throw new Error('Consent incomplete');
    const app = deployment(conn.kind),
      secret = await decryptSecret(ctx.tenantId, conn.id, state.verifierCiphertext),
      scopes = channelOAuthScopes(conn.kind, conn.config);
    const token = await requestJson(app.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: p.code,
        client_id: app.clientId,
        client_secret: app.clientSecret,
        redirect_uri: app.redirectUri,
        code_verifier: String(secret.verifier),
      }),
    });
    if (
      typeof token.access_token !== 'string' ||
      !token.access_token ||
      String(token.token_type).toLowerCase() !== 'bearer' ||
      typeof token.scope !== 'string'
    )
      throw new Error('Invalid token');
    const granted = new Set(
      token.scope
        .split(/\s+/)
        .map((scope) => scope.replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase()),
    );
    if (
      scopes
        .filter((scope) => scope !== 'offline_access')
        .some((scope) => !granted.has(scope.toLowerCase()))
    )
      throw new Error('Insufficient scope');
    const headers = { Authorization: `Bearer ${token.access_token}` };
    let accountEmail: string, calendarId: string | undefined;
    if (conn.kind === 'gmail') {
      const profile = await requestJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers,
      });
      accountEmail = z.string().email().max(320).parse(profile.emailAddress);
    } else if (conn.kind === 'google_calendar') {
      const result = await requestJson(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
        { headers },
      );
      const items = z
        .array(
          z.object({
            id: z.string(),
            primary: z.boolean().optional(),
            accessRole: z.string().optional(),
          }),
        )
        .parse(result.items);
      const target = String(conn.config.calendarId ?? 'primary');
      const calendar = items.find((item) =>
        target === 'primary' ? item.primary === true : item.id === target,
      );
      if (
        !calendar ||
        (conn.config.calendarWrite === true &&
          !['owner', 'writer'].includes(calendar.accessRole ?? ''))
      )
        throw new Error('Calendar unavailable');
      calendarId = calendar.id;
      accountEmail = z
        .string()
        .email()
        .parse(items.find((item) => item.primary)?.id);
    } else {
      const profile = await requestJson(
        'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName',
        { headers },
      );
      accountEmail = z
        .string()
        .email()
        .max(320)
        .parse(profile.mail || profile.userPrincipalName);
      if (conn.kind === 'microsoft_calendar') {
        const target = String(conn.config.calendarId ?? 'primary');
        const calendar = await requestJson(
          target === 'primary'
            ? 'https://graph.microsoft.com/v1.0/me/calendar?$select=id,canEdit'
            : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(target)}?$select=id,canEdit`,
          { headers },
        );
        calendarId = z.string().min(1).parse(calendar.id);
        if (conn.config.calendarWrite === true && calendar.canEdit !== true)
          throw new Error('Calendar unavailable');
      }
    }
    if (typeof token.refresh_token !== 'string' || !token.refresh_token)
      throw new Error('Offline grant unavailable');
    const ciphertext = await encryptSecret(ctx.tenantId, conn.id, {
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(
        Date.now() +
          (typeof token.expires_in === 'number'
            ? Math.min(86_400, Math.max(0, token.expires_in))
            : 3600) *
            1000,
      ).toISOString(),
    });
    await assertMembership(ctx);
    await tenantDb(ctx.tenantId, async (db) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':channel-setup'},0))`,
      );
      const current = (
        await db.select().from(s.connections).where(eq(s.connections.id, conn.id))
      )[0];
      if (
        !current ||
        current.status === 'disabled' ||
        Number(current.config.setupRevision) !== state.revision
      )
        throw new HttpError(409, 'OAUTH_STATE_INVALID', 'Kanal değişti; yeniden bağlayın.');
      await db
        .insert(s.secrets)
        .values({ tenantId: ctx.tenantId, connectionId: conn.id, ciphertext })
        .onConflictDoUpdate({
          target: [s.secrets.tenantId, s.secrets.connectionId],
          set: { ciphertext },
        });
      await db
        .update(s.connections)
        .set({
          status: 'ready',
          realAccountVerified: true,
          lastTestAt: new Date(),
          lastError: null,
          config: {
            ...current.config,
            accountEmail,
            ...(calendarId ? { calendarId } : {}),
            directoryTenant: app.google ? undefined : 'common',
          },
        })
        .where(eq(s.connections.id, conn.id));
      await log(db, ctx.tenantId, ctx.actor, 'channel.oauth.verified', conn.id, {
        kind: conn.kind,
        scopes,
        accountEmail,
      });
    });
    return { connectionId: conn.id };
  } catch {
    await tenantDb(ctx.tenantId, async (db) => {
      await db
        .update(s.connections)
        .set({
          status: 'login_failed',
          realAccountVerified: false,
          lastError: 'Hesap veya gerekli izinler doğrulanamadı. Hesabı yeniden bağlayın.',
        })
        .where(
          and(
            eq(s.connections.id, conn.id),
            sql`${s.connections.config}->>'setupRevision'=${String(state.revision)}`,
            sql`${s.connections.status}<>'disabled'`,
          ),
        );
      await log(db, ctx.tenantId, ctx.actor, 'channel.oauth.failed', conn.id, { kind: conn.kind });
    });
    throw new HttpError(
      409,
      'OAUTH_FAILED',
      'Hesap bağlantısı doğrulanamadı. Hesabı yeniden bağlayın.',
    );
  }
}
