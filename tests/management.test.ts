import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import { closeDb, tenantDb } from '../packages/core/src/db.js';
import { defaultConfig } from '../packages/core/src/policy.js';
import * as s from '../packages/core/src/schema.js';
import { managementPlans } from '../packages/core/src/management-schema.js';
import {
  applyManagementPlan,
  getManagementPlans,
  handleManagementMessage,
  processPendingManagementPlans,
  validateManagementResponse,
} from '../packages/core/src/management.js';
import { generateTenantProviderJson } from '../packages/core/src/ai-providers.js';
import type { TenantContext } from '../packages/core/src/types.js';

vi.mock('../packages/core/src/ai-providers.js', async (original) => ({
  ...(await original<typeof import('../packages/core/src/ai-providers.js')>()),
  generateTenantProviderJson: vi.fn(),
}));

const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  connectionId = randomUUID(),
  calendarConnectionId = randomUUID();
let owner: Pool, admin: TenantContext, staff: TenantContext;
const provider = vi.mocked(generateTenantProviderJson);
const proposal = (actions: unknown[]) => ({
  kind: 'proposal',
  summary: 'İnceleyip uygulayın.',
  actions,
});
beforeEach(async () => {
  for (const table of [
    'management_plans',
    'admin_messages',
    'proposals',
    'approvals',
    'handoffs',
    'audit',
    'operations',
    'workflows',
    'drafts',
    'calendar_events',
    'configurations',
  ])
    await owner.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
  await tenantDb(tenantId, async (db) => {
    await db
      .insert(s.configurations)
      .values({ tenantId, version: 1, value: defaultConfig('Management tests') });
    await db
      .update(s.connections)
      .set({
        permissions: ['email.draft', 'email.send'],
        config: { mode: 'demo' },
        status: 'ready',
        realAccountVerified: false,
      })
      .where(eq(s.connections.id, connectionId));
  });
});
const configuration = (name: string, baseVersion = 1) => ({
  command: 'config.update',
  payload: { baseVersion, patch: { businessName: name } },
});
async function newPlan(actions: unknown[]) {
  provider.mockResolvedValueOnce(proposal(actions));
  const response = await handleManagementMessage(admin, { body: 'Bu değişiklikleri öner.' });
  return String(response.data?.proposalId);
}
async function plan(id: string) {
  return tenantDb(
    tenantId,
    async (db) => (await db.select().from(managementPlans).where(eq(managementPlans.id, id)))[0]!,
  );
}
beforeAll(async () => {
  assertLocalDemoDatabase();
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const users = (
    await owner.query<{ user_id: string; role: string }>(
      'SELECT user_id,role FROM memberships WHERE tenant_id=$1',
      ['11111111-1111-4111-8111-111111111111'],
    )
  ).rows;
  const user = users.find((u) => u.role === 'admin')!,
    employee = users.find((u) => u.role === 'staff')!;
  await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2),($3,$4)', [
    tenantId,
    'Management tests',
    otherTenantId,
    'Other management',
  ]);
  await owner.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3),($1,$4,$5)', [
    tenantId,
    user.user_id,
    'admin',
    employee.user_id,
    'staff',
  ]);
  admin = { tenantId, role: 'admin', actor: { type: 'admin', id: user.user_id } };
  staff = { tenantId, role: 'staff', actor: { type: 'staff', id: employee.user_id } };
  await tenantDb(tenantId, async (db) => {
    await db
      .insert(s.configurations)
      .values({ tenantId, version: 1, value: defaultConfig('Management tests') });
    await db.insert(s.connections).values({
      tenantId,
      id: connectionId,
      name: 'Controlled mailbox',
      kind: 'gmail',
      purpose: 'Controlled tests',
      status: 'ready',
      config: { mode: 'demo' },
      permissions: ['email.draft', 'email.send', 'calendar.read'],
      agents: ['admin'],
    });
    await db.insert(s.connections).values({
      tenantId,
      id: calendarConnectionId,
      name: 'Controlled calendar',
      kind: 'google_calendar',
      purpose: 'Controlled tests',
      status: 'ready',
      config: { mode: 'demo' },
      permissions: ['calendar.read'],
      agents: ['admin'],
    });
  });
});
afterEach(() => {
  provider.mockReset();
  vi.restoreAllMocks();
});
afterAll(async () => {
  if (owner) {
    for (const table of [
      'management_plans',
      'admin_messages',
      'proposals',
      'approvals',
      'handoffs',
      'audit',
      'operations',
      'workflows',
      'drafts',
      'calendar_events',
      'context_questions',
      'context_attachments',
      'context_corpora',
      'secrets',
      'connections',
      'configurations',
      'memberships',
      'runtime',
    ])
      await owner.query(`DELETE FROM ${table} WHERE tenant_id IN ($1,$2)`, [
        tenantId,
        otherTenantId,
      ]);
    await owner.query('DELETE FROM tenants WHERE id IN ($1,$2)', [tenantId, otherTenantId]);
    await owner.end();
  }
  await closeDb();
});
describe('Management typed response boundary', () => {
  it('allows credential-free MCP setup and testing but keeps tool classification in the panel', () => {
    const actions = [
      {
        command: 'backoffice.mcp.save',
        payload: {
          name: 'Inventory',
          url: 'https://mcp.example.test/',
          description: 'Read inventory',
        },
      },
      { command: 'backoffice.mcp.test', payload: { id: randomUUID() } },
    ];
    expect(validateManagementResponse(proposal(actions))).toMatchObject({ actions });
    for (const action of [
      {
        command: 'backoffice.mcp.authorize',
        payload: { id: randomUUID(), tools: ['inventory'], revision: 1 },
      },
      {
        command: 'backoffice.mcp.save',
        payload: { ...actions[0]!.payload, accessToken: 'secret' },
      },
      { command: 'backoffice.mcp.save', payload: { ...actions[0]!.payload, clearToken: true } },
    ])
      expect(() => validateManagementResponse(proposal([action]))).toThrow();
  });
  it('rejects absent, empty, wrong-type, oversized and arbitrary command responses', () => {
    for (const value of [
      null,
      undefined,
      '',
      [],
      { kind: 'reply', body: '' },
      { kind: 'proposal', summary: 'x', actions: [] },
      proposal([
        { command: 'approval.resolve', payload: { id: randomUUID(), decision: 'approve' } },
      ]),
      proposal([{ command: 'payment.link', payload: {} }]),
      proposal([
        {
          command: 'config.update',
          payload: { baseVersion: 1, patch: { businessName: 'x' }, tenantId },
        },
      ]),
      proposal(Array.from({ length: 11 }, () => configuration('x'))),
      proposal(Array.from({ length: 10_001 }, () => configuration('x'))),
    ])
      expect(() => validateManagementResponse(value)).toThrow();
  });
  it('preserves Turkish Unicode and refuses model credentials and unresolved payload templates', () => {
    expect(validateManagementResponse({ kind: 'reply', body: 'Çalışma saati 👋' })).toEqual({
      kind: 'reply',
      body: 'Çalışma saati 👋',
    });
    expect(() =>
      validateManagementResponse(
        proposal([
          {
            command: 'backoffice.save',
            payload: {
              name: 'ERP',
              url: 'https://erp.example',
              description: 'x',
              password: 'secret',
            },
          },
        ]),
      ),
    ).toThrow();
    expect(() =>
      validateManagementResponse(
        proposal([
          {
            command: 'mcp.execute',
            payload: { connectionId, tool: 'write', arguments: { apiKey: 'secret' } },
          },
        ]),
      ),
    ).toThrow();
    expect(() =>
      validateManagementResponse(
        proposal([
          {
            command: 'email.draft',
            payload: { connectionId, to: 'a@example.com', subject: 'x', body: '{{step.result}}' },
          },
        ]),
      ),
    ).toThrow();
  });
});
describe('Persistent management conversation and explicit proposals', () => {
  it('applies an MCP endpoint edit and verified discovery without granting model-classified tools', async () => {
    const { runCommand } = await import('../packages/core/src/commands.js');
    const adapter = await import('../packages/core/src/integrations/mcp.js');
    vi.spyOn(adapter, 'inspectMcpConnection').mockResolvedValue({
      verified: true,
      tools: [
        { name: 'inventory', description: 'Untrusted tool', inputSchema: {}, annotations: {} },
      ],
    });
    const created = await runCommand(admin, 'backoffice.mcp.save', {
      name: 'Inventory',
      url: 'https://mcp.example.test/',
      description: 'Before',
    });
    const id = String(created.data?.id);
    const pid = await newPlan([
      {
        command: 'backoffice.mcp.save',
        payload: {
          id,
          name: 'Inventory',
          url: 'https://mcp.example.test/v2',
          description: 'After',
        },
      },
      { command: 'backoffice.mcp.test', payload: { id } },
    ]);
    await applyManagementPlan(admin, pid);
    expect((await plan(pid)).status).toBe('applied');
    const record = await tenantDb(
      tenantId,
      async (db) => (await db.select().from(s.connections).where(eq(s.connections.id, id)))[0]!,
    );
    expect(record).toMatchObject({
      status: 'ready',
      permissions: [],
      agents: ['admin'],
      realAccountVerified: false,
      config: {
        url: 'https://mcp.example.test/v2',
        mcpRevision: 2,
        discoveredTools: ['inventory'],
        readOnlyTools: [],
      },
    });
  });
  it('supplies bounded persisted history, Context and safe system state to the chosen provider', async () => {
    provider.mockResolvedValueOnce({ kind: 'question', body: 'İşletme adınız nedir?' });
    await handleManagementMessage(admin, { body: 'İşletme adını değiştirelim.' });
    provider.mockResolvedValueOnce(proposal([configuration('Çınar 👋')]));
    const response = await handleManagementMessage(admin, { body: 'Çınar 👋' });
    const input = provider.mock.calls[1]![3] as {
      history: Array<{ role: string; body: string }>;
      state: Record<string, unknown>;
    };
    expect(
      input.history.some((m) => m.role === 'assistant' && m.body === 'İşletme adınız nedir?'),
    ).toBe(true);
    expect(input.history.at(-1)?.body).toBe('Çınar 👋');
    expect(input.state).toHaveProperty('context');
    expect(input.state).toHaveProperty('connections');
    const stored = await plan(String(response.data?.proposalId));
    expect(stored.status).toBe('pending');
    expect(
      (await owner.query('SELECT count(*)::int AS n FROM drafts WHERE tenant_id=$1', [tenantId]))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await owner.query('SELECT max(version)::int AS v FROM configurations WHERE tenant_id=$1', [
          tenantId,
        ])
      ).rows[0].v,
    ).toBe(1);
  });
  it('persists user and honest provider failure without inventing a successful proposal', async () => {
    provider.mockRejectedValueOnce(new Error('secret=never-print-this'));
    const response = await handleManagementMessage(admin, { body: 'Bana yardım et.' });
    expect(response.data).toMatchObject({ status: 'awaiting_provider' });
    expect(response.message).not.toContain('never-print-this');
    const turns = await tenantDb(tenantId, (db) =>
      db.select().from(s.adminMessages).orderBy(s.adminMessages.createdAt),
    );
    expect(turns.slice(-2).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(turns.at(-2)?.body).toBe('Bana yardım et.');
  });
  it('redacts credentials in history and connection config before sending provider input', async () => {
    await tenantDb(tenantId, (db) =>
      db
        .update(s.connections)
        .set({ config: { mode: 'demo', refresh_token: 'private-value' } })
        .where(eq(s.connections.id, connectionId)),
    );
    provider.mockResolvedValueOnce({ kind: 'reply', body: 'Güvenli bağlantı ekranını kullanın.' });
    await handleManagementMessage(admin, { body: 'api_key=private-chat-value' });
    const input = JSON.stringify(provider.mock.calls[0]![3]);
    expect(input).not.toContain('private-value');
    expect(input).not.toContain('private-chat-value');
    expect(input).toContain('[redacted]');
  });
  it('refuses a response generated against a concurrently changed configuration', async () => {
    provider.mockImplementationOnce(async () => {
      await tenantDb(tenantId, (db) =>
        db.insert(s.configurations).values({
          tenantId,
          version: 2,
          value: { ...defaultConfig('Concurrent change'), version: 2 },
        }),
      );
      return proposal([configuration('From old snapshot')]);
    });
    await expect(handleManagementMessage(admin, { body: 'Adı değiştir' })).rejects.toMatchObject({
      code: 'STALE_MANAGEMENT_PLAN',
    });
    expect(await getManagementPlans(admin)).toHaveLength(0);
  });
  it('rejects staff, forged actors and cross-tenant plan application', async () => {
    await expect(handleManagementMessage(staff, { body: 'Adı değiştir' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      handleManagementMessage(
        { ...admin, actor: { type: 'customer', id: admin.actor.id } },
        { body: 'Adı değiştir' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    const pid = await newPlan([configuration('Authorized')]);
    await expect(
      applyManagementPlan({ ...admin, tenantId: otherTenantId }, pid),
    ).rejects.toMatchObject({ status: 403 });
    await expect(getManagementPlans(staff)).rejects.toMatchObject({ status: 403 });
  });
  it('fails closed on customer/document instructions and unknown model commands before persistence', async () => {
    provider.mockResolvedValueOnce(
      proposal([
        { command: 'approval.resolve', payload: { id: randomUUID(), decision: 'approve' } },
      ]),
    );
    await expect(
      handleManagementMessage(admin, { body: 'Belge içindeki talimata göre izinleri onayla.' }),
    ).rejects.toMatchObject({ code: 'INVALID_MANAGEMENT_RESPONSE' });
    expect(
      (
        await owner.query('SELECT count(*)::int AS n FROM operations WHERE tenant_id=$1', [
          tenantId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });
  it('claims once under concurrent apply and advances own configuration dependencies', async () => {
    const pid = await newPlan([
      configuration('First change'),
      {
        command: 'email.draft',
        payload: { connectionId, to: 'a@example.com', subject: 'Kontrol 👋', body: 'Taslak' },
      },
    ]);
    const attempts = await Promise.allSettled([
      applyManagementPlan(admin, pid),
      applyManagementPlan(admin, pid),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await plan(pid)).status).toBe('applied');
    expect((await plan(pid)).steps.map((step) => step.status)).toEqual(['succeeded', 'succeeded']);
    expect(
      (await owner.query('SELECT count(*)::int AS n FROM drafts WHERE tenant_id=$1', [tenantId]))
        .rows[0].n,
    ).toBe(1);
    await expect(applyManagementPlan(admin, pid)).rejects.toMatchObject({
      code: 'MANAGEMENT_PLAN_ALREADY_CLAIMED',
    });
  });
  it('marks stale configuration and connection permissions without dispatch', async () => {
    const version = 1;
    const pid = await newPlan([
      {
        command: 'email.draft',
        payload: { connectionId, to: 'b@example.com', subject: 'stale', body: 'x' },
      },
    ]);
    await tenantDb(tenantId, (db) =>
      db.update(s.connections).set({ permissions: [] }).where(eq(s.connections.id, connectionId)),
    );
    await expect(applyManagementPlan(admin, pid)).rejects.toMatchObject({
      code: 'STALE_MANAGEMENT_PLAN',
    });
    expect((await plan(pid)).status).toBe('stale');
    await tenantDb(tenantId, (db) =>
      db
        .update(s.connections)
        .set({ permissions: ['email.draft', 'email.send'] })
        .where(eq(s.connections.id, connectionId)),
    );
    const configId = await newPlan([configuration('Too late', version)]);
    await tenantDb(tenantId, (db) =>
      db.insert(s.configurations).values({
        tenantId,
        version: version + 1,
        value: { ...defaultConfig('Changed elsewhere'), version: version + 1 },
      }),
    );
    await expect(applyManagementPlan(admin, configId)).rejects.toMatchObject({
      code: 'STALE_MANAGEMENT_PLAN',
    });
  });
  it('preserves a concurrent connection edit made after claiming an action but before mutation', async () => {
    const pid = await newPlan([
      { command: 'connection.update', payload: { id: connectionId, name: 'Proposed name' } },
    ]);
    const commands = await import('../packages/core/src/commands.js');
    const original = commands.runCommand;
    vi.spyOn(commands, 'runCommand').mockImplementationOnce(async (...args) => {
      await tenantDb(tenantId, (db) =>
        db
          .update(s.connections)
          .set({ name: 'Another admin name' })
          .where(eq(s.connections.id, connectionId)),
      );
      return original(...args);
    });
    await applyManagementPlan(admin, pid);
    expect((await plan(pid)).status).toBe('needs_review');
    const connection = await tenantDb(
      tenantId,
      async (db) =>
        (await db.select().from(s.connections).where(eq(s.connections.id, connectionId)))[0]!,
    );
    expect(connection.name).toBe('Another admin name');
    expect((await plan(pid)).steps[0]?.status).toBe('needs_review');
  });
  it('preserves completed steps when a later command fails and never replays them', async () => {
    const pid = await newPlan([
      {
        command: 'email.draft',
        payload: { connectionId, to: 'c@example.com', subject: 'Partial', body: 'Saved' },
      },
      {
        command: 'email.draft',
        payload: { connectionId, to: 'd@example.com', subject: 'Failure', body: 'x' },
      },
    ]);
    const commands = await import('../packages/core/src/commands.js');
    const real = commands.runCommand;
    let count = 0;
    vi.spyOn(commands, 'runCommand').mockImplementation(async (...args) => {
      if (++count === 2) throw new Error('uncertain network outcome');
      return real(...args);
    });
    await applyManagementPlan(admin, pid);
    const stored = await plan(pid);
    expect(stored.status).toBe('needs_review');
    expect(stored.steps.map((step) => step.status)).toEqual(['succeeded', 'needs_review']);
    await processPendingManagementPlans(tenantId);
    expect(count).toBe(2);
  });
  it('creates no send operation until explicit apply and then waits for existing email approval', async () => {
    const draftId = randomUUID();
    await tenantDb(tenantId, (db) =>
      db.insert(s.drafts).values({
        tenantId,
        id: draftId,
        connectionId,
        to: 'approved@example.com',
        subject: 'Review first',
        body: 'Send only on request',
      }),
    );
    const pid = await newPlan([{ command: 'email.send', payload: { id: draftId } }]);
    expect(
      (
        await owner.query('SELECT count(*)::int AS n FROM operations WHERE tenant_id=$1', [
          tenantId,
        ])
      ).rows[0].n,
    ).toBe(0);
    await applyManagementPlan(admin, pid);
    expect((await plan(pid)).status).toBe('awaiting_operation');
    const operation = await tenantDb(
      tenantId,
      async (db) => (await db.select().from(s.operations))[0]!,
    );
    expect(operation.status).toBe('awaiting_approval');
    await processPendingManagementPlans(tenantId);
    expect((await plan(pid)).status).toBe('awaiting_operation');
  });
  it('stops on OAuth user action and only continues after the correct channel is verified', async () => {
    const pid = await newPlan([
      { command: 'channel.oauth.start', payload: { id: connectionId } },
      {
        command: 'email.draft',
        payload: {
          connectionId,
          to: 'oauth@example.com',
          subject: 'After consent',
          body: 'Draft only',
        },
      },
    ]);
    const commands = await import('../packages/core/src/commands.js'),
      real = commands.runCommand;
    vi.spyOn(commands, 'runCommand').mockImplementation(async (...args) =>
      args[1] === 'channel.oauth.start'
        ? {
            message: 'Connect account',
            data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=test-state' },
          }
        : real(...args),
    );
    await applyManagementPlan(admin, pid);
    expect((await plan(pid)).status).toBe('awaiting_user');
    await processPendingManagementPlans(tenantId);
    expect((await plan(pid)).steps[1]?.status).toBe('pending');
    expect((await getManagementPlans(admin))[0]?.steps[0]?.result?.data?.url).toContain(
      'accounts.google.com',
    );
    await tenantDb(tenantId, (db) =>
      db
        .update(s.connections)
        .set({ realAccountVerified: true })
        .where(eq(s.connections.id, connectionId)),
    );
    await processPendingManagementPlans(tenantId);
    expect((await plan(pid)).status).toBe('applied');
  });
  it('rejects terminal operation success without verification instead of running the next action', async () => {
    const pid = await newPlan([
      {
        command: 'calendar.query',
        payload: {
          connectionId: calendarConnectionId,
          start: '2026-10-12T09:00:00Z',
          end: '2026-10-12T10:00:00Z',
        },
      },
      {
        command: 'email.draft',
        payload: {
          connectionId,
          to: 'unverified@example.com',
          subject: 'Do not create',
          body: 'x',
        },
      },
    ]);
    await applyManagementPlan(admin, pid);
    const operationId = String((await plan(pid)).steps[0]?.result?.data?.operationId);
    await tenantDb(tenantId, (db) =>
      db
        .update(s.operations)
        .set({ status: 'succeeded', result: { verified: false } })
        .where(eq(s.operations.id, operationId)),
    );
    await processPendingManagementPlans(tenantId);
    const stored = await plan(pid);
    expect(stored.status).toBe('needs_review');
    expect(stored.steps[1]?.status).toBe('pending');
  });
  it('does not rebase an approved configuration step over a later administrator edit', async () => {
    const commands = await import('../packages/core/src/commands.js');
    const pid = await newPlan([
      {
        command: 'config.update',
        payload: { baseVersion: 1, patch: { requireApproval: ['email.send', 'calendar.cancel'] } },
      },
      configuration('Old suggested name'),
    ]);
    await applyManagementPlan(admin, pid);
    const waiting = await plan(pid),
      proposalId = String(waiting.steps[0]?.result?.data?.proposalId);
    const legacyProposal = await tenantDb(
      tenantId,
      async (db) => (await db.select().from(s.proposals).where(eq(s.proposals.id, proposalId)))[0]!,
    );
    await commands.runCommand(admin, 'approval.resolve', {
      id: legacyProposal.approvalId,
      decision: 'approve',
    });
    await commands.runCommand(admin, 'config.update', {
      baseVersion: 2,
      patch: { businessName: 'Latest administrator name' },
    });
    await processPendingManagementPlans(tenantId);
    const stored = await plan(pid);
    expect(stored.status).toBe('needs_review');
    expect(stored.steps[1]?.status).toBe('pending');
    const latest = await tenantDb(
      tenantId,
      async (db) =>
        (await db.select().from(s.configurations).orderBy(s.configurations.version))[2]!,
    );
    expect(latest.value.businessName).toBe('Latest administrator name');
    expect(
      (
        await owner.query('SELECT max(version)::int AS v FROM configurations WHERE tenant_id=$1', [
          tenantId,
        ])
      ).rows[0].v,
    ).toBe(3);
  });
  it('continues after exactly the approved configuration transition without marking its own change stale', async () => {
    const commands = await import('../packages/core/src/commands.js');
    const pid = await newPlan([
      {
        command: 'config.update',
        payload: { baseVersion: 1, patch: { requireApproval: ['email.send', 'calendar.cancel'] } },
      },
      configuration('Confirmed sequence'),
    ]);
    await applyManagementPlan(admin, pid);
    const proposalId = String((await plan(pid)).steps[0]?.result?.data?.proposalId);
    const legacyProposal = await tenantDb(
      tenantId,
      async (db) => (await db.select().from(s.proposals).where(eq(s.proposals.id, proposalId)))[0]!,
    );
    await commands.runCommand(admin, 'approval.resolve', {
      id: legacyProposal.approvalId,
      decision: 'approve',
    });
    await processPendingManagementPlans(tenantId);
    expect((await plan(pid)).status).toBe('applied');
    expect(
      (
        await owner.query('SELECT value FROM configurations WHERE tenant_id=$1 AND version=3', [
          tenantId,
        ])
      ).rows[0].value.businessName,
    ).toBe('Confirmed sequence');
  });
  it('does not absorb connection edits made after its concrete access approval', async () => {
    const commands = await import('../packages/core/src/commands.js');
    const pid = await newPlan([
      {
        command: 'connection.update',
        payload: {
          id: connectionId,
          name: 'Planned mailbox',
          permissions: ['email.draft', 'email.send', 'email.read'],
        },
      },
      {
        command: 'email.draft',
        payload: {
          connectionId,
          to: 'stale-connection@example.com',
          subject: 'Do not create',
          body: 'x',
        },
      },
    ]);
    await applyManagementPlan(admin, pid);
    const approvalId = String((await plan(pid)).steps[0]?.result?.data?.approvalId);
    await commands.runCommand(admin, 'approval.resolve', { id: approvalId, decision: 'approve' });
    await commands.runCommand(admin, 'connection.update', {
      id: connectionId,
      name: 'Latest mailbox',
    });
    await processPendingManagementPlans(tenantId);
    expect((await plan(pid)).status).toBe('needs_review');
    expect((await plan(pid)).steps[1]?.status).toBe('pending');
    expect(
      (await owner.query('SELECT count(*)::int AS n FROM drafts WHERE tenant_id=$1', [tenantId]))
        .rows[0].n,
    ).toBe(0);
  });
  it('does not replace workflow dependencies with a newer version when a queued test finishes', async () => {
    const workflowId = randomUUID(),
      operationId = randomUUID();
    await tenantDb(tenantId, async (db) => {
      await db.insert(s.workflows).values({
        tenantId,
        id: workflowId,
        name: 'Controlled workflow',
        purpose: 'Controlled test',
        sourceText: 'Controlled step',
        mode: 'text',
        definition: {
          name: 'Controlled',
          purpose: 'Controlled',
          connectionId,
          inputs: [],
          steps: [],
          verification: { selector: 'body', recordIdSelector: 'body' },
          idempotency: { lookupUrl: 'https://example.com', recordIdSelector: 'body' },
          requiresApproval: false,
        },
      });
      await db.insert(s.operations).values({
        tenantId,
        id: operationId,
        capability: 'workflow.text.test',
        actor: admin.actor,
        workflowId,
        inputs: { workflowVersion: 1 },
        idempotencyKey: randomUUID(),
        payloadHash: 'controlled',
        configVersion: 1,
      });
    });
    const pid = await newPlan([
      { command: 'workflow.text.test', payload: { id: workflowId } },
      {
        command: 'email.draft',
        payload: {
          connectionId,
          to: 'stale-workflow@example.com',
          subject: 'Do not create',
          body: 'x',
        },
      },
    ]);
    const commands = await import('../packages/core/src/commands.js'),
      real = commands.runCommand;
    vi.spyOn(commands, 'runCommand').mockImplementation(async (...args) =>
      args[1] === 'workflow.text.test'
        ? { message: 'Controlled test queued', data: { operationId } }
        : real(...args),
    );
    await applyManagementPlan(admin, pid);
    await tenantDb(tenantId, async (db) => {
      await db
        .update(s.workflows)
        .set({ version: 2, sourceText: 'Other administrator workflow' })
        .where(eq(s.workflows.id, workflowId));
      await db
        .update(s.operations)
        .set({ status: 'succeeded', result: { verified: true } })
        .where(eq(s.operations.id, operationId));
    });
    await processPendingManagementPlans(tenantId);
    expect((await plan(pid)).status).toBe('needs_review');
    expect((await plan(pid)).steps[1]?.status).toBe('pending');
    await owner.query('DELETE FROM operations WHERE tenant_id=$1 AND workflow_id=$2', [
      tenantId,
      workflowId,
    ]);
    await owner.query('DELETE FROM workflows WHERE tenant_id=$1 AND id=$2', [tenantId, workflowId]);
  });
  it('waits for verified queued work before continuing and parks crash leftovers', async () => {
    const pid = await newPlan([
      {
        command: 'calendar.query',
        payload: {
          connectionId: calendarConnectionId,
          start: '2026-10-12T09:00:00Z',
          end: '2026-10-12T10:00:00Z',
        },
      },
      {
        command: 'email.draft',
        payload: { connectionId, to: 'e@example.com', subject: 'After verified read', body: 'x' },
      },
    ]);
    await applyManagementPlan(admin, pid);
    const waiting = await plan(pid),
      operationId = String(waiting.steps[0]?.result?.data?.operationId);
    expect(waiting.status).toBe('awaiting_operation');
    expect(waiting.steps[1]?.status).toBe('pending');
    await tenantDb(tenantId, (db) =>
      db
        .update(s.operations)
        .set({ status: 'succeeded', result: { verified: true, events: [] } })
        .where(eq(s.operations.id, operationId)),
    );
    await processPendingManagementPlans(tenantId);
    expect((await plan(pid)).status).toBe('applied');
    const crashed = await newPlan([configuration('Never replay', 1)]);
    await tenantDb(tenantId, (db) =>
      db
        .update(managementPlans)
        .set({
          status: 'applying',
          updatedAt: new Date(0),
          steps: [
            {
              command: 'config.update',
              payload: { baseVersion: 1, patch: { businessName: 'Never replay' } },
              status: 'dispatching',
            },
          ],
        })
        .where(and(eq(managementPlans.id, crashed), eq(managementPlans.status, 'pending'))),
    );
    await processPendingManagementPlans(tenantId);
    expect((await plan(crashed)).status).toBe('needs_review');
  });
});
