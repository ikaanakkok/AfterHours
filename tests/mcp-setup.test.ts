import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import { closeDb, tenantDb } from '../packages/core/src/db.js';
import * as s from '../packages/core/src/schema.js';
import { handleBackofficeCommand } from '../packages/core/src/backoffice.js';
import { readConnectionSecret } from '../packages/core/src/security.js';
import { runCommand } from '../packages/core/src/commands.js';
import { defaultConfig } from '../packages/core/src/policy.js';
import {
  completeMcpOAuth,
  mcpOAuthAccessToken,
  mcpOAuthFetch,
} from '../packages/core/src/mcp-oauth.js';
import { channelOAuthStates } from '../packages/core/src/channel-setup-schema.js';
import { encryptSecret } from '../packages/core/src/security.js';
import type { TenantContext } from '../packages/core/src/types.js';

const tenantId = randomUUID();
let owner: Pool, ctx: TenantContext, server: Server, url: string;
let listGate: Promise<void> | undefined, onList: (() => void) | undefined;
const methods: string[] = [];
const requests: { url: string; authorization: string }[] = [];
let refreshes = 0;
let rejectRefresh = false;
let omitRotatedRefreshToken = false;
const tokenForms: URLSearchParams[] = [];
const row = (id: string) =>
  tenantDb(
    tenantId,
    async (db) => (await db.select().from(s.connections).where(eq(s.connections.id, id)))[0]!,
  );
const save = async (name: string, extra: Record<string, unknown> = {}) =>
  String(
    (
      await handleBackofficeCommand(ctx, 'backoffice.mcp.save', {
        name,
        url,
        description: 'Controlled MCP test',
        ...extra,
      })
    ).data?.id,
  );
beforeAll(async () => {
  assertLocalDemoDatabase();
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const admin = (
    await owner.query<{ user_id: string }>(
      'SELECT user_id FROM memberships WHERE tenant_id=$1 AND role=$2 LIMIT 1',
      ['11111111-1111-4111-8111-111111111111', 'admin'],
    )
  ).rows[0]!;
  await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [tenantId, 'MCP setup test']);
  await owner.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
    tenantId,
    admin.user_id,
    'admin',
  ]);
  ctx = { tenantId, actor: { type: 'admin', id: admin.user_id }, role: 'admin' };
  await tenantDb(tenantId, (db) =>
    db.insert(s.configurations).values({ tenantId, version: 1, value: defaultConfig('MCP test') }),
  );
  server = createServer(async (req, res) => {
    const origin = new URL(url).origin;
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url?.startsWith('/.well-known/oauth-protected-resource')) {
      json({ resource: url, authorization_servers: [origin] });
      return;
    }
    if (req.url === '/.well-known/oauth-authorization-server') {
      json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
      return;
    }
    if (req.url === '/register') {
      json(
        {
          client_id: 'controlled-client',
          redirect_uris: ['http://127.0.0.1:3005/api/mcp/oauth/callback'],
        },
        201,
      );
      return;
    }
    if (req.url === '/token') {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      const form = new URLSearchParams(body);
      tokenForms.push(form);
      if (form.get('grant_type') === 'refresh_token') {
        refreshes++;
        if (rejectRefresh) {
          json({ error: 'invalid_grant' }, 400);
          return;
        }
      }
      json({
        access_token: `controlled-access-${refreshes}`,
        ...(!omitRotatedRefreshToken ? { refresh_token: `controlled-refresh-${refreshes}` } : {}),
        token_type: 'Bearer',
        expires_in: 3600,
      });
      return;
    }
    requests.push({ url: req.url ?? '', authorization: req.headers.authorization ?? '' });
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const request = JSON.parse(body) as { id?: string | number; method: string };
    methods.push(request.method);
    if (request.id === undefined) {
      res.writeHead(202);
      res.end();
      return;
    }
    if (request.method === 'tools/list') {
      onList?.();
      await listGate;
    }
    const result =
      request.method === 'initialize'
        ? {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture', version: '1' },
          }
        : request.method === 'tools/list'
          ? {
              tools: [
                ...(req.headers.authorization?.startsWith('Bearer controlled-access-')
                  ? [{ name: req.headers.authorization.slice(7), inputSchema: { type: 'object' } }]
                  : []),
                {
                  name: 'read_stock',
                  inputSchema: { type: 'object' },
                  annotations: { readOnlyHint: true },
                },
                { name: 'write_stock', inputSchema: { type: 'object' } },
              ],
            }
          : {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable');
  url = `http://127.0.0.1:${address.port}/mcp`;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (owner) {
    for (const table of [
      'audit',
      'runtime',
      'channel_oauth_states',
      'secrets',
      'connections',
      'configurations',
      'memberships',
    ])
      await owner.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
    await owner.query('DELETE FROM tenants WHERE id=$1', [tenantId]);
    await owner.end();
  }
  await closeDb();
});
describe('Backoffice MCP setup', () => {
  it('completes single-use PKCE OAuth and serializes rotated refresh tokens without granting tools', async () => {
    const id = await save('OAuth controlled', { authMode: 'oauth' });
    const started = await handleBackofficeCommand(ctx, 'backoffice.mcp.oauth.start', { id });
    const auth = new URL(String(started.data?.url));
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    const state = auth.searchParams.get('state')!;
    await completeMcpOAuth(ctx, { state, code: 'controlled-code' });
    const stored = await readConnectionSecret(tenantId, id);
    expect(stored.accessToken).toBe('controlled-access-0');
    expect(tokenForms.at(-1)?.get('code_verifier')).toBeTruthy();
    expect((await row(id)).status).toBe('awaiting_test');
    expect((await row(id)).permissions).toEqual([]);
    await expect(completeMcpOAuth(ctx, { state, code: 'replay' })).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    });
    await handleBackofficeCommand(ctx, 'backoffice.mcp.test', { id });
    expect((await row(id)).status).toBe('ready');
    expect((await row(id)).permissions).toEqual([]);
    expect(requests.some((r) => r.authorization === 'Bearer controlled-access-0')).toBe(true);
    await tenantDb(tenantId, async (db) =>
      db
        .update(s.secrets)
        .set({ ciphertext: await encryptSecret(tenantId, id, { ...stored, oauthExpiresAt: 0 }) })
        .where(eq(s.secrets.connectionId, id)),
    );
    const config = (await row(id)).config;
    expect(
      await Promise.all([mcpOAuthAccessToken(config, stored), mcpOAuthAccessToken(config, stored)]),
    ).toEqual(['controlled-access-1', 'controlled-access-1']);
    expect(refreshes).toBe(1);
    expect((await readConnectionSecret(tenantId, id)).oauthTokens).toMatchObject({
      refresh_token: 'controlled-refresh-1',
    });
    await save('OAuth renamed', { id });
    expect((await row(id)).config.authMode).toBe('oauth');
    const latest = await readConnectionSecret(tenantId, id);
    await tenantDb(tenantId, async (db) =>
      db
        .update(s.secrets)
        .set({ ciphertext: await encryptSecret(tenantId, id, { ...latest, oauthExpiresAt: 0 }) })
        .where(eq(s.secrets.connectionId, id)),
    );
    omitRotatedRefreshToken = true;
    try {
      await mcpOAuthAccessToken((await row(id)).config, latest);
      const refreshed = await readConnectionSecret(tenantId, id);
      expect(refreshed.oauthTokens).toMatchObject({ refresh_token: 'controlled-refresh-1' });
      await tenantDb(tenantId, async (db) =>
        db
          .update(s.secrets)
          .set({
            ciphertext: await encryptSecret(tenantId, id, { ...refreshed, oauthExpiresAt: 0 }),
          })
          .where(eq(s.secrets.connectionId, id)),
      );
      await mcpOAuthAccessToken((await row(id)).config, refreshed);
      expect(tokenForms.at(-1)?.get('refresh_token')).toBe('controlled-refresh-1');
      const newest = await readConnectionSecret(tenantId, id);
      await tenantDb(tenantId, async (db) =>
        db
          .update(s.secrets)
          .set({ ciphertext: await encryptSecret(tenantId, id, { ...newest, oauthExpiresAt: 0 }) })
          .where(eq(s.secrets.connectionId, id)),
      );
      await handleBackofficeCommand(ctx, 'backoffice.mcp.test', { id });
      expect((await row(id)).config.discoveredTools).toEqual(['read_stock', 'write_stock']);
    } finally {
      omitRotatedRefreshToken = false;
    }
  });
  it('rejects callbacks after edits, disabling, expiry and denied consent', async () => {
    for (const mode of ['edit', 'disable', 'expire', 'deny']) {
      const id = await save(`OAuth ${mode}`, { authMode: 'oauth' });
      const started = await handleBackofficeCommand(ctx, 'backoffice.mcp.oauth.start', { id });
      const state = new URL(String(started.data?.url)).searchParams.get('state')!;
      if (mode === 'edit') await save(`OAuth ${mode}`, { id, authMode: 'oauth' });
      if (mode === 'disable')
        await tenantDb(tenantId, (db) =>
          db.update(s.connections).set({ status: 'disabled' }).where(eq(s.connections.id, id)),
        );
      if (mode === 'expire')
        await tenantDb(tenantId, (db) =>
          db
            .update(channelOAuthStates)
            .set({ expiresAt: new Date(0) })
            .where(eq(channelOAuthStates.connectionId, id)),
        );
      await expect(
        completeMcpOAuth(ctx, {
          state,
          ...(mode === 'deny' ? { error: 'access_denied' } : { code: 'controlled' }),
        }),
      ).rejects.toThrow();
      expect((await row(id)).permissions).toEqual([]);
      expect((await readConnectionSecret(tenantId, id)).accessToken).toBeUndefined();
    }
  });
  it('stops failed refresh replay and rejects foreign OAuth destinations', async () => {
    await expect(mcpOAuthFetch(url)('https://foreign.example/token')).rejects.toThrow();
    const id = await save('OAuth refresh failure', { authMode: 'oauth' });
    const started = await handleBackofficeCommand(ctx, 'backoffice.mcp.oauth.start', { id });
    await completeMcpOAuth(ctx, {
      state: new URL(String(started.data?.url)).searchParams.get('state'),
      code: 'controlled',
    });
    const secret = await readConnectionSecret(tenantId, id);
    await tenantDb(tenantId, async (db) =>
      db
        .update(s.secrets)
        .set({ ciphertext: await encryptSecret(tenantId, id, { ...secret, oauthExpiresAt: 0 }) })
        .where(eq(s.secrets.connectionId, id)),
    );
    rejectRefresh = true;
    try {
      const before = refreshes;
      await expect(mcpOAuthAccessToken((await row(id)).config, secret)).rejects.toThrow();
      await expect(mcpOAuthAccessToken((await row(id)).config, secret)).rejects.toThrow();
      expect(refreshes).toBe(before + 1);
      expect((await row(id)).status).toBe('needs_attention');
      expect((await readConnectionSecret(tenantId, id)).accessToken).toBeUndefined();
    } finally {
      rejectRefresh = false;
    }
  });
  it('rejects generic setup metadata and bypasses of managed MCP configuration', async () => {
    await expect(
      runCommand(ctx, 'connection.create', {
        name: 'Forged discovery',
        kind: 'mcp',
        purpose: 'Test',
        config: {
          mcpSetup: true,
          readOnlyTools: ['write_stock'],
          discoveredTools: ['write_stock'],
        },
      }),
    ).rejects.toMatchObject({ code: 'DEDICATED_SETUP_REQUIRED' });
    const id = await save('Dedicated guards');
    await expect(
      runCommand(ctx, 'connection.secret', { id, secrets: { accessToken: 'test' } }),
    ).rejects.toMatchObject({ code: 'DEDICATED_SETUP_REQUIRED' });
    await expect(
      runCommand(ctx, 'connection.update', { id, permissions: ['mcp:write_stock'] }),
    ).rejects.toMatchObject({ code: 'DEDICATED_SETUP_REQUIRED' });
    await expect(runCommand(ctx, 'connection.test', { id })).rejects.toMatchObject({
      code: 'DEDICATED_SETUP_REQUIRED',
    });
  });

  it('encrypts credentials, discovers without tool calls or automatic grants, then explicitly authorizes selected tools', async () => {
    const id = await save('Stock MCP', { accessToken: 'controlled-test-token' });
    expect((await row(id)).permissions).toEqual([]);
    expect((await row(id)).config).not.toHaveProperty('accessToken');
    expect((await readConnectionSecret(tenantId, id)).accessToken).toBe('controlled-test-token');
    await expect(
      handleBackofficeCommand(ctx, 'backoffice.mcp.authorize', {
        id,
        revision: 1,
        tools: ['read_stock'],
      }),
    ).rejects.toMatchObject({ code: 'MCP_TEST_REQUIRED' });
    await handleBackofficeCommand(ctx, 'backoffice.mcp.test', { id });
    const tested = await row(id);
    expect(tested.status).toBe('ready');
    expect(tested.realAccountVerified).toBe(false);
    expect(tested.permissions).toEqual([]);
    expect(tested.config.discoveredTools).toEqual(['read_stock', 'write_stock']);
    expect(methods).not.toContain('tools/call');
    await expect(
      handleBackofficeCommand(ctx, 'backoffice.mcp.authorize', {
        id,
        revision: 1,
        tools: ['unknown'],
      }),
    ).rejects.toMatchObject({ code: 'MCP_TOOL_UNKNOWN' });
    await handleBackofficeCommand(ctx, 'backoffice.mcp.authorize', {
      id,
      revision: 1,
      tools: ['read_stock'],
    });
    expect((await row(id)).permissions).toEqual(['mcp:read_stock']);
    expect((await row(id)).agents).toEqual(['admin']);
    await save('Stock MCP', { id });
    expect((await readConnectionSecret(tenantId, id)).accessToken).toBe('controlled-test-token');
    expect((await row(id)).permissions).toEqual([]);
    expect((await row(id)).lastTestAt).toBeNull();
    await expect(
      handleBackofficeCommand(ctx, 'backoffice.mcp.authorize', {
        id,
        revision: 1,
        tools: ['read_stock'],
      }),
    ).rejects.toMatchObject({ code: 'MCP_TEST_REQUIRED' });
  });
  it('does not inherit credentials when the server address changes and supports explicit token removal', async () => {
    const id = await save('Token lifecycle', { accessToken: 'fixture-token' });
    await save('Token lifecycle', { id, url: `${url}?server=other` });
    expect(await readConnectionSecret(tenantId, id)).toEqual({});
    await save('Token lifecycle', { id, accessToken: 'replacement-token' });
    await save('Token lifecycle', { id, clearToken: true });
    expect(await readConnectionSecret(tenantId, id)).toEqual({});
  });
  it('rejects unsafe endpoints and URL credentials without saving', async () => {
    for (const badUrl of [
      'http://example.com/mcp',
      'https://user:pass@example.com/mcp',
      'https://example.com/mcp?access_token=fixture',
      'https://example.com/mcp#fragment',
      'https://metadata.google.internal/mcp',
    ])
      await expect(save('Invalid endpoint', { url: badUrl })).rejects.toThrow();
  });
  it('keeps named browser and MCP systems unambiguous in both save paths', async () => {
    await save('Shared system');
    await expect(
      handleBackofficeCommand(ctx, 'backoffice.save', {
        name: 'shared SYSTEM',
        url: 'https://example.com',
        description: 'Browser test',
      }),
    ).rejects.toMatchObject({ code: 'SYSTEM_NAME_EXISTS' });
    await handleBackofficeCommand(ctx, 'backoffice.save', {
      name: 'Browser unique',
      url: 'https://example.com',
      description: 'Browser test',
    });
    await expect(save('browser UNIQUE')).rejects.toMatchObject({ code: 'SYSTEM_NAME_EXISTS' });
  });
  it('rejects staff mutation, missing membership and cross-tenant connection access', async () => {
    await expect(
      handleBackofficeCommand({ ...ctx, role: 'staff' }, 'backoffice.mcp.save', {
        name: 'Denied',
        url,
        description: 'Test',
      }),
    ).rejects.toThrow();
    const otherId = randomUUID();
    await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [otherId, 'Other MCP tenant']);
    try {
      await expect(
        handleBackofficeCommand({ ...ctx, tenantId: otherId }, 'backoffice.mcp.save', {
          name: 'Denied',
          url,
          description: 'Test',
        }),
      ).rejects.toThrow();
      await owner.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
        otherId,
        ctx.actor.id,
        'admin',
      ]);
      const id = await save('Tenant scoped');
      await expect(
        handleBackofficeCommand({ ...ctx, tenantId: otherId }, 'backoffice.mcp.test', { id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await owner.query('DELETE FROM memberships WHERE tenant_id=$1', [otherId]);
      await owner.query('DELETE FROM tenants WHERE id=$1', [otherId]);
    }
  });
  it('rejects stale discovery after a concurrent save', async () => {
    const id = await save('Concurrent MCP');
    let release!: () => void;
    listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      onList = resolve;
    });
    const test = handleBackofficeCommand(ctx, 'backoffice.mcp.test', { id });
    const rejection = expect(test).rejects.toMatchObject({ code: 'MCP_CHANGED' });
    try {
      await started;
      await save('Concurrent MCP', { id });
    } finally {
      release();
      listGate = undefined;
      onList = undefined;
    }
    await rejection;
    expect((await row(id)).status).toBe('awaiting_test');
    expect((await row(id)).config.discoveredTools).toEqual([]);
  });

  it('snapshots the endpoint and credential atomically during concurrent token rotation', async () => {
    const id = await save('Atomic credential snapshot', { accessToken: 'snapshot-old' });
    const blocker = await owner.connect();
    let release!: () => void;
    listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      onList = resolve;
    });
    let testing: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      const blockingPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!.pid;
      await blocker.query(
        'SELECT ciphertext FROM secrets WHERE tenant_id=$1 AND connection_id=$2 FOR UPDATE',
        [tenantId, id],
      );
      testing = handleBackofficeCommand(ctx, 'backoffice.mcp.test', { id }).catch((error) => error);
      let snapshotWaiting = false;
      for (let n = 0; n < 100; n++) {
        const pending = await owner.query<{ blocked: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%secrets%') AS blocked",
          [blockingPid],
        );
        if (pending.rows[0]!.blocked) {
          snapshotWaiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(snapshotWaiting).toBe(true);
      let saved = false;
      const saving = save('Atomic credential snapshot', {
        id,
        url: `${url}?rotated=1`,
        accessToken: 'snapshot-new',
      }).then(() => {
        saved = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(saved).toBe(false);
      const requestStart = requests.length;
      await blocker.query('COMMIT');
      await started;
      await saving;
      release();
      expect(await testing).toMatchObject({ code: 'MCP_CHANGED' });
      const sent = requests.slice(requestStart).filter((request) => request.url === '/mcp');
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.every((request) => request.authorization === 'Bearer snapshot-old')).toBe(true);
      expect((await readConnectionSecret(tenantId, id)).accessToken).toBe('snapshot-new');
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      release();
      listGate = undefined;
      onList = undefined;
      await testing;
    }
  });
  it('does not revive a connection disabled during discovery', async () => {
    const id = await save('Paused MCP');
    let release!: () => void;
    listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      onList = resolve;
    });
    const test = handleBackofficeCommand(ctx, 'backoffice.mcp.test', { id });
    const rejection = expect(test).rejects.toMatchObject({ code: 'MCP_CHANGED' });
    try {
      await started;
      await tenantDb(tenantId, (db) =>
        db.update(s.connections).set({ status: 'disabled' }).where(eq(s.connections.id, id)),
      );
    } finally {
      release();
      listGate = undefined;
      onList = undefined;
    }
    await rejection;
    expect((await row(id)).status).toBe('disabled');
    expect((await row(id)).config.discoveredTools).toEqual([]);
  });
  it('reports failed connection tests without granting readiness', async () => {
    const id = await save('Unavailable MCP', { url: `${url}/unavailable` });
    await save('Unavailable MCP', { id, url: 'http://127.0.0.1:1/mcp' });
    await expect(handleBackofficeCommand(ctx, 'backoffice.mcp.test', { id })).rejects.toMatchObject(
      { code: 'MCP_TEST_FAILED' },
    );
    expect((await row(id)).status).toBe('needs_attention');
    expect((await row(id)).permissions).toEqual([]);
  });
});
