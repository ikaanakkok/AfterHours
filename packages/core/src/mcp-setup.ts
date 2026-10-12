import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assertMembership } from './context.js';
import { tenantDb } from './db.js';
import { HttpError, requireAdmin } from './errors.js';
import * as s from './schema.js';
import { assertPublicConfig, encryptSecret, decryptSecret } from './security.js';
import { log } from './store.js';
import { inspectMcpConnection, validateMcpServerUrl } from './integrations/mcp.js';
import { ProviderError } from './integrations/http.js';
import { startMcpOAuth } from './mcp-oauth.js';
import type { CommandResult, TenantContext } from './types.js';

const idSchema = z.object({ id: z.string().uuid() }).strict();
const toolName = z.string().regex(/^[A-Za-z0-9_.:-]{1,116}$/);
async function testSnapshot(ctx: TenantContext, id: string) {
  return tenantDb(ctx.tenantId, async (db) => {
    const row = (
      await db.select().from(s.connections).where(eq(s.connections.id, id)).for('update')
    )[0];
    if (!row || row.deletedAt) throw new HttpError(404, 'NOT_FOUND', 'MCP system not found.');
    if (row.kind !== 'mcp' || row.config.mcpSetup !== true)
      throw new HttpError(400, 'MCP_REQUIRED', 'This record is not an MCP setup.');
    if (row.status === 'disabled')
      throw new HttpError(409, 'MCP_DISABLED', 'This MCP system is disabled. Save it again before connecting.');
    // Save holds this same connection row lock while replacing its credential.
    const secret = (
      await db.select().from(s.secrets).where(eq(s.secrets.connectionId, id)).for('share')
    )[0];
    return { conn: row, ciphertext: secret?.ciphertext };
  });
}
export async function handleMcpSetupCommand(
  ctx: TenantContext,
  action: string,
  payload: unknown,
  beforeMutation?: (db: import('./db.js').TenantDb) => Promise<void>,
): Promise<CommandResult> {
  await assertMembership(ctx);
  requireAdmin(ctx.role);
  if (action === 'backoffice.mcp.oauth.start')
    return startMcpOAuth(ctx, idSchema.parse(payload).id, beforeMutation);
  if (action === 'backoffice.mcp.save') {
    const p = z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(120),
        url: z.string().url().max(2000),
        description: z.string().trim().min(1).max(8000),
        accessToken: z
          .string()
          .trim()
          .min(1)
          .max(4000)
          .regex(/^[^\r\n]+$/)
          .optional(),
        clearToken: z.boolean().default(false),
        authMode: z.enum(['bearer', 'oauth']).optional(),
      })
      .strict()
      .parse(payload);
    assertPublicConfig({ url: p.url });
    let url: URL;
    try {
      url = validateMcpServerUrl({ url: p.url });
    } catch {
      throw new HttpError(422, 'INVALID_MCP_URL', 'Enter an HTTPS or local HTTP MCP server URL.');
    }
    if (p.clearToken && p.accessToken)
      throw new HttpError(
        422,
        'TOKEN_CONFLICT',
        'Choose either to enter a token or remove the saved token.',
      );
    if (p.authMode === 'oauth' && p.accessToken)
      throw new HttpError(422, 'TOKEN_CONFLICT', 'Do not enter a token for OAuth authentication.');
    const id = p.id ?? randomUUID();
    const ciphertext = p.accessToken
      ? await encryptSecret(ctx.tenantId, id, { accessToken: p.accessToken })
      : null;
    await tenantDb(ctx.tenantId, async (db) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':backoffice'},0))`,
      );

      if (beforeMutation) await beforeMutation(db);
      const old = p.id
        ? (await db.select().from(s.connections).where(eq(s.connections.id, id)).for('update'))[0]
        : null;
      if (p.id && (!old || old.deletedAt))
        throw new HttpError(404, 'NOT_FOUND', 'MCP system not found.');
      if (old && (old.kind !== 'mcp' || old.config.mcpSetup !== true))
        throw new HttpError(400, 'MCP_REQUIRED', 'The system type cannot be changed.');
      const authMode = p.authMode ?? (old?.config.authMode === 'oauth' ? 'oauth' : 'bearer');
      if (authMode === 'oauth' && p.accessToken)
        throw new HttpError(422, 'TOKEN_CONFLICT', 'Do not enter a token for OAuth authentication.');
      const collision = (
        await db
          .select()
          .from(s.connections)
          .where(
            and(
              inArray(s.connections.kind, ['browser', 'mcp']),
              isNull(s.connections.deletedAt),
              sql`lower(${s.connections.name})=lower(${p.name})`,
            ),
          )
      ).some((c) => c.id !== id);
      if (collision)
        throw new HttpError(
          409,
          'SYSTEM_NAME_EXISTS',
          'Enter a unique system name for use in workflows.',
        );
      // A changed endpoint must never inherit the previous server's credential.
      const sameEndpoint =
        old?.config.url === url.href && (old?.config.authMode ?? 'bearer') === authMode;
      if (p.clearToken || (old && !sameEndpoint))
        await db.delete(s.secrets).where(eq(s.secrets.connectionId, id));
      const values = {
        name: p.name,
        purpose: p.description,
        status: 'awaiting_test',
        lastError: null,
        lastTestAt: null,
        realAccountVerified: false,
        permissions: [] as string[],
        agents: ['admin'],
        config: {
          mcpSetup: true,
          url: url.href,
          transport: 'streamable_http',
          authMode,
          mcpRevision: Number(old?.config.mcpRevision ?? 0) + 1,
          discoveredTools: [],
          readOnlyTools: [],
        },
      };
      if (old) await db.update(s.connections).set(values).where(eq(s.connections.id, id));
      else
        await db
          .insert(s.connections)
          .values({ tenantId: ctx.tenantId, id, kind: 'mcp', ...values });
      if (ciphertext)
        await db
          .insert(s.secrets)
          .values({ tenantId: ctx.tenantId, connectionId: id, ciphertext })
          .onConflictDoUpdate({
            target: [s.secrets.tenantId, s.secrets.connectionId],
            set: { ciphertext },
          });
      if (authMode === 'oauth' && sameEndpoint && !p.clearToken) {
        const saved = (await db.select().from(s.secrets).where(eq(s.secrets.connectionId, id)))[0];
        if (saved) {
          const secret = await decryptSecret(ctx.tenantId, id, saved.ciphertext);
          if (secret.oauthRefreshLease) {
            const replacement = await encryptSecret(ctx.tenantId, id, {
              oauthClient: secret.oauthClient,
              oauthRedirectUri: secret.oauthRedirectUri,
            });
            await db
              .update(s.secrets)
              .set({ ciphertext: replacement })
              .where(eq(s.secrets.connectionId, id));
          } else if (secret.oauthBinding && typeof secret.oauthBinding === 'object') {
            const replacement = await encryptSecret(ctx.tenantId, id, {
              ...secret,
              oauthBinding: {
                ...(secret.oauthBinding as Record<string, unknown>),
                revision: values.config.mcpRevision,
              },
            });
            await db
              .update(s.secrets)
              .set({ ciphertext: replacement })
              .where(eq(s.secrets.connectionId, id));
          }
        }
      }
      await log(db, ctx.tenantId, ctx.actor, 'backoffice.mcp.saved', id, {
        credentialsChanged: !!ciphertext || p.clearToken,
        permissionsGranted: false,
      });
    });
    return {
      message: 'MCP system saved. Test the connection and confirm tool permissions.',
      data: { id },
    };
  }
  if (action === 'backoffice.mcp.test') {
    const { id } = idSchema.parse(payload),
      snapshot = await testSnapshot(ctx, id);
    const { conn } = snapshot;
    const secret = snapshot.ciphertext
      ? await decryptSecret(ctx.tenantId, id, snapshot.ciphertext)
      : {};
    const revisionCondition = and(
      eq(s.connections.id, id),
      sql`${s.connections.config}->>'mcpRevision'=${String(conn.config.mcpRevision)}`,
      sql`${s.connections.status}<>'disabled'`,
    );
    let tools: string[];
    try {
      const result = await inspectMcpConnection(conn.config, secret);
      if (!result.verified) throw new ProviderError('MCP connection could not be verified.');
      tools = [
        ...new Set(
          result.tools
            .map((t) => t.name)
            .filter(
              (name) =>
                toolName.safeParse(name).success &&
                !(typeof secret.accessToken === 'string' && name.includes(secret.accessToken)),
            ),
        ),
      ];
    } catch {
      await tenantDb(ctx.tenantId, (db) =>
        db
          .update(s.connections)
          .set({
            status: 'needs_attention',
            realAccountVerified: false,
            lastError:
              'MCP connection could not be verified. Check the server URL and reconnect your account or update its token.',
            lastTestAt: new Date(),
          })
          .where(revisionCondition),
      );
      throw new HttpError(
        422,
        'MCP_TEST_FAILED',
        'MCP connection could not be verified. Check the server URL and reconnect your account or update its token.',
      );
    }
    await tenantDb(ctx.tenantId, async (db) => {
      if (beforeMutation) await beforeMutation(db);
      // Lock and re-read so discovery cannot overwrite a concurrent save or authorization.
      const current = (
        await db.select().from(s.connections).where(revisionCondition).for('update')
      )[0];
      if (!current)
        throw new HttpError(409, 'MCP_CHANGED', 'MCP settings changed. Test the updated connection.');
      const readOnlyTools = Array.isArray(current.config.readOnlyTools)
        ? current.config.readOnlyTools.filter(
            (t): t is string => typeof t === 'string' && tools.includes(t),
          )
        : [];
      await db
        .update(s.connections)
        .set({
          status: 'ready',
          realAccountVerified: false,
          lastError: null,
          lastTestAt: new Date(),
          permissions: readOnlyTools.map((t) => `mcp:${t}`),
          config: { ...current.config, discoveredTools: tools, readOnlyTools },
        })
        .where(eq(s.connections.id, id));
      await log(db, ctx.tenantId, ctx.actor, 'backoffice.mcp.tested', id, {
        verified: true,
        toolCount: tools.length,
        realAccountVerified: false,
      });
    });
    return {
      message:
        'MCP connection verified. This test does not verify the business account identity. Confirm tool permissions separately.',
      data: { id, verified: true, tools },
    };
  }
  if (action === 'backoffice.mcp.authorize') {
    const p = idSchema
      .extend({ tools: z.array(toolName).max(100), revision: z.number().int().positive() })
      .strict()
      .parse(payload);
    await tenantDb(ctx.tenantId, async (db) => {
      if (beforeMutation) await beforeMutation(db);
      const conn = (
        await db.select().from(s.connections).where(eq(s.connections.id, p.id)).for('update')
      )[0];
      if (!conn || conn.kind !== 'mcp' || conn.config.mcpSetup !== true)
        throw new HttpError(404, 'NOT_FOUND', 'MCP system not found.');
      if (conn.status !== 'ready' || conn.config.mcpRevision !== p.revision)
        throw new HttpError(409, 'MCP_TEST_REQUIRED', 'Test the current MCP connection.');
      const discovered = Array.isArray(conn.config.discoveredTools)
        ? conn.config.discoveredTools
        : [];
      if (p.tools.some((t) => !discovered.includes(t)))
        throw new HttpError(
          422,
          'MCP_TOOL_UNKNOWN',
          'Only tools discovered in the latest test can be selected.',
        );
      const tools = [...new Set(p.tools)];
      await db
        .update(s.connections)
        .set({
          permissions: tools.map((t) => `mcp:${t}`),
          agents: ['admin'],
          config: { ...conn.config, readOnlyTools: tools },
        })
        .where(eq(s.connections.id, p.id));
      await log(db, ctx.tenantId, ctx.actor, 'backoffice.mcp.authorized', p.id, {
        tools,
        readOnlyConfirmed: true,
        agents: ['admin'],
      });
    });
    return { message: 'The administrator can now use the selected tools for read-only operations.' };
  }
  throw new HttpError(400, 'UNKNOWN_COMMAND', 'This MCP setup command is not supported.');
}
