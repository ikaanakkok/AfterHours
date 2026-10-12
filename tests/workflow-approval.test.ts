import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtureServer } from '../scripts/fixture.js';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import { tenantDb, closeDb } from '../packages/core/src/db.js';
import * as s from '../packages/core/src/schema.js';
import * as u from '../packages/core/src/unified-workflow-schema.js';
import { drainUnifiedWorkflowRuns } from '../packages/core/src/unified-workflows.js';
import { defaultConfig } from '../packages/core/src/policy.js';
import { runCommand } from '../packages/core/src/commands.js';
import { executeOperation } from '../packages/core/src/runtime.js';
import { stableHash, writeConnectionSecret } from '../packages/core/src/security.js';
import type { TenantContext, WorkflowDefinition } from '../packages/core/src/types.js';

const tenantId = randomUUID(),
  systemId = randomUUID(),
  providerId = randomUUID();
let owner: Pool,
  ctx: TenantContext,
  directory: string,
  fixture: ReturnType<typeof createFixtureServer>,
  origin: string;
const operation = (id: string) =>
  tenantDb(
    tenantId,
    async (db) => (await db.select().from(s.operations).where(eq(s.operations.id, id)))[0]!,
  );
async function approve(id: string) {
  const approval = await tenantDb(
    tenantId,
    async (db) =>
      (
        await db
          .select()
          .from(s.approvals)
          .where(and(eq(s.approvals.operationId, id), eq(s.approvals.status, 'pending')))
      )[0]!,
  );
  await runCommand(ctx, 'approval.resolve', { id: approval.id, decision: 'approve' });
}
beforeAll(async () => {
  assertLocalDemoDatabase();
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const user = (
    await owner.query<{ user_id: string }>(
      'SELECT user_id FROM memberships WHERE tenant_id=$1 AND role=$2 LIMIT 1',
      ['11111111-1111-4111-8111-111111111111', 'admin'],
    )
  ).rows[0]!;
  await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [
    tenantId,
    'Approval regression',
  ]);
  await owner.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
    tenantId,
    user.user_id,
    'admin',
  ]);
  ctx = { tenantId, actor: { type: 'admin', id: user.user_id }, role: 'admin' };
  directory = await mkdtemp(join(tmpdir(), 'afterhours-approval-'));
  fixture = createFixtureServer({ dataDir: directory });
  await new Promise<void>((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
  const address = fixture.server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture unavailable');
  origin = `http://127.0.0.1:${address.port}`;
  await tenantDb(tenantId, async (db) => {
    await db
      .insert(s.configurations)
      .values({ tenantId, version: 1, value: defaultConfig('Approval test') });
    await db.insert(s.connections).values([
      {
        tenantId,
        id: systemId,
        name: 'Approval ERP',
        kind: 'browser',
        purpose: 'Controlled write test',
        status: 'ready',
        config: { mode: 'demo', startUrl: origin + '/requests/new', allowedOrigins: [origin] },
        permissions: ['browser.execute'],
        agents: ['admin', 'cron'],
      },
      {
        tenantId,
        id: providerId,
        name: 'Mock AI',
        kind: 'ai_provider',
        purpose: 'Controlled JSON transport',
        status: 'ready',
        config: { provider: 'opencode_go', model: 'glm-5.3-flash', enabled: true },
        permissions: [],
        agents: ['admin'],
      },
    ]);
  });
  await writeConnectionSecret(tenantId, providerId, { apiKey: 'test-only-no-real-key' });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (fixture) await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  if (owner) {
    for (const table of [
      'trials',
      'approvals',
      'handoffs',
      'audit',
      'workflow_run_steps',
      'workflow_runs',
      'operations',
      'cron_jobs',
      'workflows',
      'secrets',
      'connections',
      'configurations',
      'memberships',
    ])
      await owner.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
    await owner.query('DELETE FROM tenants WHERE id=$1', [tenantId]);
    await owner.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  await closeDb();
});
describe('Concrete workflow approval and fresh credential verification', () => {
  const definition = (): WorkflowDefinition => ({
    name: 'Approved request',
    purpose: 'Write and read back',
    connectionId: systemId,
    inputs: [{ key: 'description', label: 'Request', required: true }],
    steps: [
      { action: 'goto', url: origin + '/requests/new' },
      { action: 'fill', selector: '[name="customerName"]', value: 'Approval test' },
      { action: 'fill', selector: '[name="customerAddress"]', value: 'test@example.test' },
      { action: 'fill', selector: '[name="description"]', value: '{{description}}' },
      { action: 'fill', selector: '[name="reference"]', value: '{{reference}}' },
      { action: 'click', selector: 'button[type="submit"]' },
    ],
    verification: {
      selector: '#request-record',
      recordIdSelector: '#request-id',
      expected: '{{description}}',
    },
    idempotency: {
      lookupUrl: origin + '/requests/by-reference/{{reference}}',
      recordIdSelector: '#request-id',
      absentSelector: '[data-afterhours-lookup="absent"]',
    },
    requiresApproval: true,
  });
  const writer = (description: string) => ({
    id: 'write',
    kind: 'browser.write',
    connectionId: systemId,
    inputs: { definition: definition(), values: { description } },
    bindings: [],
  });
  async function children(parentId: string) {
    return tenantDb(tenantId, async (db) => {
      const run = (
        await db.select().from(u.workflowRuns).where(eq(u.workflowRuns.parentOperationId, parentId))
      )[0];
      return run
        ? db
            .select()
            .from(u.workflowRunSteps)
            .where(eq(u.workflowRunSteps.runId, run.id))
            .orderBy(u.workflowRunSteps.position)
        : [];
    });
  }
  function controlledModel(plan: unknown) {
    const model = vi.fn(
      async (_url, options) =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(
                    String(
                      (options?.headers as Record<string, string>)?.['x-opencode-session'],
                    ).endsWith(':workflow_questions')
                      ? { questions: [] }
                      : plan,
                  ),
                },
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', model);
    return model;
  }
  async function settle(parentId: string) {
    await executeOperation(tenantId, parentId);
    for (let attempt = 0; attempt < 12; attempt++) {
      await drainUnifiedWorkflowRuns(tenantId);
      for (const row of await children(parentId)) {
        if (!row.operationId || row.status === 'succeeded') continue;
        const child = await operation(row.operationId);
        if (child.status === 'awaiting_approval') await approve(child.id);
        if (['queued', 'awaiting_approval'].includes(child.status))
          await executeOperation(tenantId, child.id);
      }
      if (['succeeded', 'needs_attention', 'failed'].includes((await operation(parentId)).status))
        return;
    }
    throw new Error('Controlled workflow did not settle');
  }
  it('approves each frozen write once and requires new concrete approval for manual cron runs', async () => {
    const model = controlledModel({ version: 2, steps: [writer('Concrete approved request')] });
    const before = (await fixture.records()).length;
    const saved = await runCommand(ctx, 'workflow.text.save', {
      name: 'Approved writer',
      text: 'Approval ERP > talep oluştur > her 10 dakika',
    });
    const wid = String(saved.data?.id);
    const test = await runCommand(ctx, 'workflow.text.test', { id: wid });
    const parentId = String(test.data?.operationId);
    expect((await operation(parentId)).status).toBe('queued');
    await executeOperation(tenantId, parentId);
    await drainUnifiedWorkflowRuns(tenantId);
    const step = (await children(parentId))[0]!;
    const child = await operation(step.operationId!);
    expect(child).toMatchObject({
      status: 'awaiting_approval',
      inputs: { values: { description: 'Concrete approved request' } },
    });
    expect(await fixture.records()).toHaveLength(before);
    await executeOperation(tenantId, child.id);
    expect(await fixture.records()).toHaveLength(before);
    await approve(child.id);
    await executeOperation(tenantId, child.id);
    await executeOperation(tenantId, child.id);
    await drainUnifiedWorkflowRuns(tenantId);
    expect((await operation(parentId)).status).toBe('succeeded');
    expect(await fixture.records()).toHaveLength(before + 1);
    expect(
      model.mock.calls.filter(
        ([, options]) =>
          !String((options?.headers as Record<string, string>)?.['x-opencode-session']).endsWith(
            ':workflow_questions',
          ),
      ),
    ).toHaveLength(1);
    await runCommand(ctx, 'workflow.text.confirm', {
      id: wid,
      operationId: parentId,
      confirmed: true,
    });
    const cron = await tenantDb(
      tenantId,
      async (db) => (await db.select().from(s.cronJobs).where(eq(s.cronJobs.workflowId, wid)))[0]!,
    );
    const future = await runCommand(ctx, 'cron.run', { id: cron.id });
    const futureId = String(future.data?.operationId);
    expect(await operation(futureId)).toMatchObject({
      status: 'queued',
      connectionId: null,
      inputs: { compiledPlan: { version: 2 } },
    });
    await executeOperation(tenantId, futureId);
    await drainUnifiedWorkflowRuns(tenantId);
    const nextChild = await operation((await children(futureId))[0]!.operationId!);
    expect(nextChild.status).toBe('awaiting_approval');
    expect(nextChild.id).not.toBe(child.id);
    expect(nextChild.payloadHash).not.toBe(child.payloadHash);
    expect(await fixture.records()).toHaveLength(before + 1);
    vi.unstubAllGlobals();
  });
  it('preserves verified write evidence after a later read fails and does not replay it', async () => {
    const secondId = randomUUID();
    await tenantDb(tenantId, async (db) => {
      const system = (
        await db.select().from(s.connections).where(eq(s.connections.id, systemId))
      )[0]!;
      await db.insert(s.connections).values({ ...system, id: secondId, name: 'Follow-up ERP' });
    });
    controlledModel({
      version: 2,
      steps: [
        writer('Partial execution evidence'),
        {
          id: 'read',
          kind: 'browser.read',
          connectionId: secondId,
          inputs: { url: origin + '/requests', selector: '#does-not-exist', expected: 'verified' },
          bindings: [],
        },
      ],
    });
    const before = (await fixture.records()).length;
    const saved = await runCommand(ctx, 'workflow.text.save', {
      name: 'Partial workflow',
      text: 'Approval ERP > talep oluştur > Follow-up ERP > sonucu doğrula',
    });
    const tested = await runCommand(ctx, 'workflow.text.test', { id: String(saved.data?.id) });
    const id = String(tested.data?.operationId);
    await settle(id);
    expect(await operation(id)).toMatchObject({
      status: 'needs_attention',
      result: {
        verified: false,
        safeToRetry: false,
        completedSteps: [
          {
            stepId: 'write',
            result: { verified: true, externalRecordId: expect.stringMatching(/^REQ-/) },
          },
        ],
      },
    });
    expect(await fixture.records()).toHaveLength(before + 1);
    await executeOperation(tenantId, id);
    await drainUnifiedWorkflowRuns(tenantId);
    expect(await fixture.records()).toHaveLength(before + 1);
    vi.unstubAllGlobals();
  });
  it.each(['edit', 'pause', 'revoke'] as const)(
    'stops before a later write after %s during an in-flight read',
    async (change) => {
      let blocked = false,
        entered!: () => void,
        release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const proceed = new Promise<void>((resolve) => {
        release = resolve;
      });
      const gate = createServer(async (_req, res) => {
        if (blocked) {
          entered();
          await proceed;
        }
        res.setHeader('Content-Type', 'text/html');
        res.end('<div id="ready">ready</div>');
      });
      await new Promise<void>((resolve) => gate.listen(0, '127.0.0.1', resolve));
      const address = gate.address();
      if (!address || typeof address === 'string') throw new Error('Gate listener missing');
      const gateOrigin = `http://127.0.0.1:${address.port}`,
        gateId = randomUUID();
      await tenantDb(tenantId, async (db) => {
        const system = (
          await db.select().from(s.connections).where(eq(s.connections.id, systemId))
        )[0]!;
        await db.insert(s.connections).values({
          ...system,
          id: gateId,
          name: `Gate ${change} ERP`,
          config: { ...system.config, startUrl: gateOrigin, allowedOrigins: [gateOrigin] },
        });
      });
      controlledModel({
        version: 2,
        steps: [
          {
            id: 'read',
            kind: 'browser.read',
            connectionId: gateId,
            inputs: { url: gateOrigin, selector: '#ready', expected: 'ready' },
            bindings: [],
          },
          writer(`Security gate ${change}`),
        ],
      });
      let removed = false;
      try {
        const text = `Gate ${change} ERP > durum oku > Approval ERP > talep oluştur > her 10 dakika`;
        const saved = await runCommand(ctx, 'workflow.text.save', { name: `Race ${change}`, text });
        const wid = String(saved.data?.id);
        const tested = await runCommand(ctx, 'workflow.text.test', { id: wid });
        const testId = String(tested.data?.operationId);
        await settle(testId);
        expect((await operation(testId)).status).toBe('succeeded');
        await runCommand(ctx, 'workflow.text.confirm', {
          id: wid,
          operationId: testId,
          confirmed: true,
        });
        const cron = await tenantDb(
          tenantId,
          async (db) =>
            (await db.select().from(s.cronJobs).where(eq(s.cronJobs.workflowId, wid)))[0]!,
        );
        const queued = await runCommand(ctx, 'cron.run', { id: cron.id });
        const parentId = String(queued.data?.operationId);
        // This controlled run uses the admin actor to test membership revocation as well as workflow changes.
        await tenantDb(tenantId, (db) =>
          db.update(s.operations).set({ actor: ctx.actor }).where(eq(s.operations.id, parentId)),
        );
        await tenantDb(tenantId, async (db) => {
          const row = (
            await db.select().from(s.operations).where(eq(s.operations.id, parentId))
          )[0]!;
          const payloadHash = stableHash({
            capability: row.capability,
            inputs: row.inputs,
            actor: row.actor,
            connectionId: row.connectionId ?? undefined,
            configVersion: row.configVersion,
          });
          await db.update(s.operations).set({ payloadHash }).where(eq(s.operations.id, parentId));
        });
        await executeOperation(tenantId, parentId);
        await drainUnifiedWorkflowRuns(tenantId);
        const read = (await children(parentId))[0]!;
        if ((await operation(read.operationId!)).status === 'awaiting_approval')
          await approve(read.operationId!);
        const before = (await fixture.records()).length;
        blocked = true;
        const running = executeOperation(tenantId, read.operationId!);
        await started;
        if (change === 'edit')
          await runCommand(ctx, 'workflow.text.save', {
            id: wid,
            name: `Race ${change}`,
            text: text.replace('durum oku', 'yeni durumu oku'),
          });
        if (change === 'pause')
          await runCommand(ctx, 'workflow.text.toggle', { id: wid, enabled: false });
        if (change === 'revoke') {
          await owner.query('DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2', [
            tenantId,
            ctx.actor.id,
          ]);
          removed = true;
        }
        release();
        await running;
        await drainUnifiedWorkflowRuns(tenantId);
        expect((await operation(parentId)).status).toBe('needs_attention');
        expect(await fixture.records()).toHaveLength(before);
        expect((await children(parentId))[1]?.operationId).toBeNull();
        expect((await operation(parentId)).result).toMatchObject({
          verified: false,
          safeToRetry: false,
        });
      } finally {
        release();
        if (removed)
          await owner.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
            tenantId,
            ctx.actor.id,
            'admin',
          ]);
        vi.unstubAllGlobals();
        await new Promise<void>((resolve) => gate.close(() => resolve()));
      }
    },
  );
  it('tests replacement credentials afresh instead of accepting a cached session', async () => {
    let submissions = 0;
    const server = createServer((req, res) => {
      const page = () => {
        res.setHeader('content-type', 'text/html');
        if (req.headers.cookie?.includes('session=verified'))
          res.end('<span>fixture-account</span><button>Logout</button>');
        else
          res.end(
            '<form method="post"><input name="username"><input type="password" name="password"><button type="submit">Login</button></form>',
          );
      };
      if (req.method !== 'POST') {
        page();
        return;
      }
      let body = '';
      req.on('data', (chunk) => (body += String(chunk)));
      req.on('end', () => {
        submissions++;
        const data = new URLSearchParams(body);
        if (
          data.get('username') === 'fixture-account' &&
          data.get('password') === 'correct-fixture-password'
        ) {
          res.setHeader('set-cookie', 'session=verified; Path=/; HttpOnly');
          res.statusCode = 303;
          res.setHeader('location', '/');
          res.end();
        } else page();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Login fixture unavailable');
    try {
      const saved = await runCommand(ctx, 'backoffice.save', {
          name: 'Credentials ERP',
          url: `http://127.0.0.1:${address.port}`,
          description: 'Fresh login verification',
          username: 'fixture-account',
          password: 'correct-fixture-password',
        }),
        id = String(saved.data?.id);
      const first = await runCommand(ctx, 'backoffice.test', { id });
      await executeOperation(tenantId, String(first.data?.operationId));
      expect((await operation(String(first.data?.operationId))).status).toBe('succeeded');
      await runCommand(ctx, 'backoffice.save', {
        id,
        name: 'Credentials ERP',
        url: `http://127.0.0.1:${address.port}`,
        description: 'Replacement password test',
        username: 'fixture-account',
        password: 'incorrect-fixture-password',
      });
      const second = await runCommand(ctx, 'backoffice.test', { id });
      await executeOperation(tenantId, String(second.data?.operationId));
      expect((await operation(String(second.data?.operationId))).status).toBe('failed');
      const connection = await tenantDb(
        tenantId,
        async (db) => (await db.select().from(s.connections).where(eq(s.connections.id, id)))[0]!,
      );
      expect(connection.status).toBe('login_failed');
      expect(submissions).toBe(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
