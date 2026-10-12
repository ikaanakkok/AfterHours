import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  discoverOAuthServerInfo,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  type OAuthServerInfo,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { tenantDb, type TenantDb } from './db.js';
import * as s from './schema.js';
import { channelOAuthStates as states } from './channel-setup-schema.js';
import { assertMembership, getContext } from './context.js';
import { HttpError, requireAdmin } from './errors.js';
import { encryptSecret, decryptSecret } from './security.js';
import { log } from './store.js';
import { validateMcpServerUrl } from './integrations/mcp.js';
import type { CommandResult, JsonObject, TenantContext } from './types.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function mcpOAuthRedirectUri() {
  const origin = validateMcpServerUrl({
    url: process.env.AFTERHOURS_APP_URL || 'http://127.0.0.1:3000',
  });
  return new URL('/api/mcp/oauth/callback', origin).href;
}
// OAuth discovery must not turn an administrator's MCP URL into arbitrary credential destinations.
// This delivery supports same-origin authorization servers, including hosted Notion.
export function mcpOAuthFetch(serverUrl: string): typeof fetch {
  const origin = validateMcpServerUrl({ url: serverUrl }).origin;
  return async (input, init) => {
    const target = validateMcpServerUrl({
      url: input instanceof Request ? input.url : String(input),
    });
    if (target.origin !== origin) throw new Error('OAuth endpoint origin mismatch');
    return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  };
}
function checkMetadata(serverUrl: string, info: OAuthServerInfo) {
  const origin = new URL(serverUrl).origin;
  for (const address of [
    info.authorizationServerUrl,
    info.authorizationServerMetadata?.issuer,
    info.authorizationServerMetadata?.authorization_endpoint,
    info.authorizationServerMetadata?.token_endpoint,
    info.authorizationServerMetadata?.registration_endpoint,
  ]) {
    if (!address || validateMcpServerUrl({ url: address }).origin !== origin)
      throw new Error('OAuth metadata unsupported');
  }
  if (!info.authorizationServerMetadata?.code_challenge_methods_supported?.includes('S256'))
    throw new Error('PKCE S256 required');
}
const asJson = (value: unknown): JsonObject => JSON.parse(JSON.stringify(value)) as JsonObject;
function expiry(tokens: OAuthTokens) {
  return Date.now() + Math.max(0, Math.min(tokens.expires_in ?? 3600, 604800)) * 1000;
}
const callback = z
  .object({
    state: z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/),
    code: z.string().min(1).max(8000).optional(),
    error: z.string().max(2000).optional(),
  })
  .strict();

export async function startMcpOAuth(
  ctx: TenantContext,
  id: string,
  beforeMutation?: (db: TenantDb) => Promise<void>,
): Promise<CommandResult> {
  await assertMembership(ctx);
  requireAdmin(ctx.role);
  const intent = await tenantDb(ctx.tenantId, async (db) => {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':backoffice'},0))`,
    );
    if (beforeMutation) await beforeMutation(db);
    const conn = (
      await db.select().from(s.connections).where(eq(s.connections.id, id)).for('update')
    )[0];
    if (
      !conn ||
      conn.kind !== 'mcp' ||
      conn.deletedAt ||
      conn.config.mcpSetup !== true ||
      conn.config.authMode !== 'oauth' ||
      conn.status === 'disabled'
    )
      throw new HttpError(409, 'MCP_OAUTH_REQUIRED', 'Save an MCP system with OAuth authentication first.');
    if (Number(conn.config.oauthStartingUntil) > Date.now())
      throw new HttpError(409, 'MCP_OAUTH_BUSY', 'The connection request is being prepared. Please wait.');
    const stored = (await db.select().from(s.secrets).where(eq(s.secrets.connectionId, id)))[0];
    const revision = Number(conn.config.mcpRevision) + 1;
    await db
      .update(states)
      .set({ consumedAt: new Date() })
      .where(and(eq(states.connectionId, id), isNull(states.consumedAt)));
    await db
      .update(s.connections)
      .set({
        status: 'awaiting_test',
        permissions: [],
        lastTestAt: null,
        lastError: null,
        realAccountVerified: false,
        config: {
          ...conn.config,
          mcpRevision: revision,
          discoveredTools: [],
          readOnlyTools: [],
          oauthStartingUntil: Date.now() + 120000,
        },
      })
      .where(eq(s.connections.id, id));
    return { conn, revision, ciphertext: stored?.ciphertext };
  });
  try {
    const serverUrl = String(intent.conn.config.url),
      redirectUri = mcpOAuthRedirectUri();
    const fetchFn = mcpOAuthFetch(serverUrl),
      info = await discoverOAuthServerInfo(serverUrl, { fetchFn });
    checkMetadata(serverUrl, info);
    const old = intent.ciphertext ? await decryptSecret(ctx.tenantId, id, intent.ciphertext) : {};
    const client =
      old.oauthRedirectUri === redirectUri && old.oauthClient
        ? (old.oauthClient as OAuthClientInformationMixed)
        : await registerClient(info.authorizationServerUrl, {
            metadata: info.authorizationServerMetadata,
            fetchFn,
            clientMetadata: {
              client_name: 'AfterHours',
              redirect_uris: [redirectUri],
              grant_types: ['authorization_code', 'refresh_token'],
              response_types: ['code'],
              token_endpoint_auth_method: 'none',
            },
          });
    const state = `${ctx.tenantId}.${randomBytes(32).toString('base64url')}`;
    const { authorizationUrl, codeVerifier } = await startAuthorization(
      info.authorizationServerUrl,
      {
        metadata: info.authorizationServerMetadata,
        clientInformation: client,
        redirectUrl: redirectUri,
        state,
        resource: serverUrl,
      },
    );
    if (authorizationUrl.origin !== new URL(serverUrl).origin)
      throw new Error('Invalid authorization origin');
    await assertMembership(ctx);
    const verifierCiphertext = await encryptSecret(ctx.tenantId, id, {
      purpose: 'mcp_oauth',
      codeVerifier,
      client: asJson(client),
      info: asJson(info),
      redirectUri,
      serverUrl,
    });
    const ciphertext = await encryptSecret(ctx.tenantId, id, {
      oauthClient: asJson(client),
      oauthRedirectUri: redirectUri,
    });
    return await tenantDb(ctx.tenantId, async (db) => {
      const current = (
        await db.select().from(s.connections).where(eq(s.connections.id, id)).for('update')
      )[0];
      if (
        !current ||
        current.deletedAt ||
        current.status === 'disabled' ||
        current.config.mcpRevision !== intent.revision ||
        current.config.url !== serverUrl
      )
        throw new Error('Connection changed');
      await db.insert(states).values({
        tenantId: ctx.tenantId,
        connectionId: id,
        userId: ctx.actor.id,
        stateHash: hash(state),
        revision: intent.revision,
        expiresAt: new Date(Date.now() + 600000),
        verifierCiphertext,
      });
      await db
        .insert(s.secrets)
        .values({ tenantId: ctx.tenantId, connectionId: id, ciphertext })
        .onConflictDoUpdate({
          target: [s.secrets.tenantId, s.secrets.connectionId],
          set: { ciphertext },
        });
      await db
        .update(s.connections)
        .set({ config: { ...current.config, oauthStartingUntil: 0 } })
        .where(eq(s.connections.id, id));
      await log(db, ctx.tenantId, ctx.actor, 'mcp.oauth.started', id, {});
      return {
        message: 'Sign in to your account and approve access.',
        data: { url: authorizationUrl.href },
      };
    });
  } catch {
    await tenantDb(ctx.tenantId, async (db) => {
      const current = (
        await db.select().from(s.connections).where(eq(s.connections.id, id)).for('update')
      )[0];
      if (
        current &&
        !current.deletedAt &&
        current.status !== 'disabled' &&
        current.config.mcpRevision === intent.revision
      )
        await db
          .update(s.connections)
          .set({
            status: 'needs_attention',
            lastError: 'OAuth could not start. Try connecting again.',
            config: { ...current.config, oauthStartingUntil: 0 },
          })
          .where(eq(s.connections.id, id));
    });
    throw new HttpError(
      422,
      'MCP_OAUTH_FAILED',
      'OAuth could not start. The server must support OAuth and dynamic client registration on the same origin.',
    );
  }
}

export async function completeMcpOAuthFromHeaders(headers: Headers, input: unknown) {
  const p = callback.parse(input);
  return completeMcpOAuth(await getContext(headers, p.state.slice(0, 36)), p);
}
export async function completeMcpOAuth(ctx: TenantContext, input: unknown) {
  const p = callback.parse(input);
  await assertMembership(ctx);
  requireAdmin(ctx.role);
  if (p.state.slice(0, 36) !== ctx.tenantId)
    throw new HttpError(409, 'OAUTH_STATE_INVALID', 'Invalid connection request.');
  const claim = await tenantDb(ctx.tenantId, async (db) => {
    const pending = (
      await db
        .select()
        .from(states)
        .where(
          and(
            eq(states.stateHash, hash(p.state)),
            eq(states.userId, ctx.actor.id),
            isNull(states.consumedAt),
            gt(states.expiresAt, new Date()),
          ),
        )
        .for('update')
    )[0];
    if (!pending)
      throw new HttpError(409, 'OAUTH_STATE_INVALID', 'This request has already been used or has expired.');
    const secret = await decryptSecret(
      ctx.tenantId,
      pending.connectionId,
      pending.verifierCiphertext,
    );
    if (secret.purpose !== 'mcp_oauth')
      throw new HttpError(409, 'OAUTH_STATE_INVALID', 'Invalid connection request.');
    await db.update(states).set({ consumedAt: new Date() }).where(eq(states.id, pending.id));
    return { pending, secret };
  });
  const { pending, secret } = claim;
  const matches = (conn: typeof s.connections.$inferSelect | undefined) =>
    conn &&
    !conn.deletedAt &&
    conn.kind === 'mcp' &&
    conn.config.authMode === 'oauth' &&
    conn.status !== 'disabled' &&
    conn.config.mcpRevision === pending.revision &&
    conn.config.url === secret.serverUrl;
  try {
    if (p.error || !p.code) throw new Error('Consent not granted');
    const initial = await tenantDb(
      ctx.tenantId,
      async (db) =>
        (
          await db.select().from(s.connections).where(eq(s.connections.id, pending.connectionId))
        )[0],
    );
    if (!matches(initial)) throw new Error('Connection changed');
    const info = secret.info as unknown as OAuthServerInfo,
      serverUrl = String(secret.serverUrl);
    checkMetadata(serverUrl, info);
    const tokens = await exchangeAuthorization(info.authorizationServerUrl, {
      metadata: info.authorizationServerMetadata,
      clientInformation: secret.client as OAuthClientInformationMixed,
      authorizationCode: p.code,
      codeVerifier: String(secret.codeVerifier),
      redirectUri: String(secret.redirectUri),
      resource: serverUrl,
      fetchFn: mcpOAuthFetch(serverUrl),
    });
    if (tokens.token_type.toLowerCase() !== 'bearer' || !tokens.refresh_token)
      throw new Error('Invalid tokens');
    await assertMembership(ctx);
    const ciphertext = await encryptSecret(ctx.tenantId, pending.connectionId, {
      accessToken: tokens.access_token,
      oauthTokens: asJson(tokens),
      oauthClient: secret.client,
      oauthInfo: secret.info,
      oauthRedirectUri: secret.redirectUri,
      oauthExpiresAt: expiry(tokens),
      oauthBinding: {
        tenantId: ctx.tenantId,
        connectionId: pending.connectionId,
        revision: pending.revision,
        serverUrl,
        grantId: randomUUID(),
      },
    });
    return await tenantDb(ctx.tenantId, async (db) => {
      const conn = (
        await db
          .select()
          .from(s.connections)
          .where(eq(s.connections.id, pending.connectionId))
          .for('update')
      )[0];
      if (!matches(conn)) throw new Error('Connection changed');
      await assertMembership(ctx);
      await db
        .update(s.secrets)
        .set({ ciphertext })
        .where(eq(s.secrets.connectionId, pending.connectionId));
      await db
        .update(s.connections)
        .set({ status: 'awaiting_test', lastError: null })
        .where(eq(s.connections.id, pending.connectionId));
      await log(db, ctx.tenantId, ctx.actor, 'mcp.oauth.connected', pending.connectionId, {
        permissionsGranted: false,
      });
      return { connectionId: pending.connectionId };
    });
  } catch {
    throw new HttpError(409, 'MCP_OAUTH_FAILED', 'OAuth could not be completed. Reconnect your account.');
  }
}

/** Persisted leases serialize refreshes without holding database clients during network I/O. */
export async function mcpOAuthAccessToken(config: JsonObject, secret: JsonObject): Promise<string> {
  const binding = z
    .object({
      tenantId: z.string().uuid(),
      connectionId: z.string().uuid(),
      revision: z.number(),
      serverUrl: z.string(),
      grantId: z.string().uuid(),
    })
    .parse(secret.oauthBinding);
  if (binding.serverUrl !== config.url || binding.revision !== config.mcpRevision)
    throw new Error('OAuth reconnect required');
  const matches = (conn: typeof s.connections.$inferSelect | undefined) =>
    conn &&
    !conn.deletedAt &&
    conn.status !== 'disabled' &&
    conn.config.url === binding.serverUrl &&
    conn.config.mcpRevision === binding.revision;
  for (let attempt = 0; attempt < 500; attempt++) {
    const leaseId = randomUUID();
    const claim = await tenantDb(binding.tenantId, async (db) => {
      const conn = (
        await db
          .select()
          .from(s.connections)
          .where(eq(s.connections.id, binding.connectionId))
          .for('update')
      )[0];
      const stored = (
        await db.select().from(s.secrets).where(eq(s.secrets.connectionId, binding.connectionId))
      )[0];
      if (!matches(conn) || !stored) throw new Error('OAuth connection changed');
      const current = await decryptSecret(
        binding.tenantId,
        binding.connectionId,
        stored.ciphertext,
      );
      if ((current.oauthBinding as JsonObject | undefined)?.grantId !== binding.grantId)
        throw new Error('OAuth grant changed');
      if (
        Number(current.oauthExpiresAt) > Date.now() + 60000 &&
        typeof current.accessToken === 'string'
      )
        return { token: current.accessToken };
      if (current.oauthRefreshLease) {
        if (Number(current.oauthRefreshUntil) > Date.now()) return { wait: true };
        // An abandoned exchange may already have rotated the token; never replay it.
        const ciphertext = await encryptSecret(binding.tenantId, binding.connectionId, {
          oauthClient: current.oauthClient,
          oauthRedirectUri: current.oauthRedirectUri,
        });
        await db
          .update(s.secrets)
          .set({ ciphertext })
          .where(eq(s.secrets.connectionId, binding.connectionId));
        await db
          .update(s.connections)
          .set({
            status: 'needs_attention',
            lastError: 'Reconnect your account.',
            permissions: [],
          })
          .where(eq(s.connections.id, binding.connectionId));
        return { failed: true };
      }
      const ciphertext = await encryptSecret(binding.tenantId, binding.connectionId, {
        ...current,
        oauthRefreshLease: leaseId,
        oauthRefreshUntil: Date.now() + 60000,
      });
      await db
        .update(s.secrets)
        .set({ ciphertext })
        .where(eq(s.secrets.connectionId, binding.connectionId));
      return { current };
    });
    if (claim.token) return claim.token;
    if (claim.failed) throw new Error('OAuth reconnect required');
    if (claim.wait) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    const current = claim.current!;
    let tokens: OAuthTokens | undefined;
    try {
      const info = current.oauthInfo as unknown as OAuthServerInfo;
      checkMetadata(binding.serverUrl, info);
      tokens = await refreshAuthorization(info.authorizationServerUrl, {
        metadata: info.authorizationServerMetadata,
        clientInformation: current.oauthClient as OAuthClientInformationMixed,
        refreshToken: String((current.oauthTokens as JsonObject).refresh_token),
        resource: binding.serverUrl,
        fetchFn: mcpOAuthFetch(binding.serverUrl),
      });
      if (tokens.token_type.toLowerCase() !== 'bearer') throw new Error('Invalid token type');
      tokens.refresh_token ??= String((current.oauthTokens as JsonObject).refresh_token);
    } catch {
      tokens = undefined;
    }
    const replacement = tokens
      ? {
          ...current,
          accessToken: tokens.access_token,
          oauthTokens: asJson(tokens),
          oauthExpiresAt: expiry(tokens),
        }
      : { oauthClient: current.oauthClient, oauthRedirectUri: current.oauthRedirectUri };
    const ciphertext = await encryptSecret(binding.tenantId, binding.connectionId, replacement);
    await tenantDb(binding.tenantId, async (db) => {
      const conn = (
        await db
          .select()
          .from(s.connections)
          .where(eq(s.connections.id, binding.connectionId))
          .for('update')
      )[0];
      const stored = (
        await db.select().from(s.secrets).where(eq(s.secrets.connectionId, binding.connectionId))
      )[0];
      if (!matches(conn) || !stored) throw new Error('OAuth connection changed');
      const latest = await decryptSecret(binding.tenantId, binding.connectionId, stored.ciphertext);
      if (
        latest.oauthRefreshLease !== leaseId ||
        (latest.oauthBinding as JsonObject | undefined)?.grantId !== binding.grantId
      )
        throw new Error('OAuth grant changed');
      await db
        .update(s.secrets)
        .set({ ciphertext })
        .where(eq(s.secrets.connectionId, binding.connectionId));
      if (!tokens)
        await db
          .update(s.connections)
          .set({
            status: 'needs_attention',
            lastError: 'Reconnect your account.',
            permissions: [],
          })
          .where(eq(s.connections.id, binding.connectionId));
    });
    if (!tokens) throw new Error('OAuth reconnect required');
    return tokens.access_token;
  }
  throw new Error('OAuth refresh busy');
}
