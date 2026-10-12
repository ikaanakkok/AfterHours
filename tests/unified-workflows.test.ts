import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtureServer } from '../scripts/fixture.js';
import { getCalendarAvailability } from '../packages/core/src/integrations/calendar.js';
import { runCommand } from '../packages/core/src/commands.js';
import { resolveWorkflowSystems } from '../packages/core/src/workflow-bindings.js';
import { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import {
  drainUnifiedWorkflowRuns,
  executeUnifiedBrowserStep,
  resolveUnifiedStepInputs,
  startUnifiedWorkflowRun,
  unifiedWorkflowPlanSchema,
} from '../packages/core/src/unified-workflows.js';
import * as u from '../packages/core/src/unified-workflow-schema.js';
import * as s from '../packages/core/src/schema.js';
import { emailDraftSources, emailMessages } from '../packages/core/src/email-schema.js';
import { saveGuardedEmailDraft } from '../packages/core/src/email-drafts.js';
import { tenantDb, closeDb } from '../packages/core/src/db.js';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import { defaultConfig } from '../packages/core/src/policy.js';
import { stableHash } from '../packages/core/src/security.js';
import type { JsonObject, TenantContext } from '../packages/core/src/types.js';

const calendarId = randomUUID(),
  browserId = randomUUID(),
  mailId = randomUUID();
const browserDefinition = {
  name: 'Booking',
  purpose: 'Create the requested booking',
  connectionId: browserId,
  inputs: [{ key: 'start', label: 'Start', required: true }],
  steps: [
    { action: 'goto', url: 'http://127.0.0.1:4001/new' },
    { action: 'fill', selector: '#start', value: '{{start}}' },
    { action: 'click', selector: '#save' },
  ],
  verification: { selector: '#saved', recordIdSelector: '#record-id' },
  idempotency: {
    lookupUrl: 'http://127.0.0.1:4001/search?ref={{reference}}',
    recordIdSelector: '#record-id',
    absentSelector: '#absent',
  },
  requiresApproval: true,
};
const mixedPlan = () =>
  unifiedWorkflowPlanSchema.parse({
    version: 2,
    steps: [
      {
        id: 'slots',
        kind: 'calendar.query',
        connectionId: calendarId,
        inputs: { start: '2026-10-12T06:00:00Z', end: '2026-10-12T15:00:00Z' },
      },
      {
        id: 'booking',
        kind: 'browser.write',
        connectionId: browserId,
        inputs: { definition: browserDefinition, values: {} },
        bindings: [{ target: ['values', 'start'], fromStep: 'slots', path: ['slots', 0, 'start'] }],
      },
      {
        id: 'reply',
        kind: 'email.draft',
        connectionId: mailId,
        inputs: { to: 'customer@example.test', subject: 'Booking confirmation' },
        bindings: [{ target: ['body'], fromStep: 'booking', path: ['externalRecordId'] }],
      },
    ],
  });

describe('typed version2 plans and verified output bindings', () => {
  it('binds named calendar, browser, email and MCP systems in text order', () => {
    expect(
      resolveWorkflowSystems('Calendar > ERP > Mail > Support tools', [
        { id: calendarId, name: 'Calendar', kind: 'google_calendar' },
        { id: browserId, name: 'ERP', kind: 'browser' },
        { id: mailId, name: 'Mail', kind: 'gmail' },
        { id: 'mcp-system', name: 'Support tools', kind: 'mcp' },
      ]),
    ).toEqual({ systemIds: [calendarId, browserId, mailId, 'mcp-system'], error: null });
  });
  it('resolves earlier verified outputs into a new concrete value without changing the plan', () => {
    const plan = mixedPlan(),
      step = plan.steps[1]!;
    const result = resolveUnifiedStepInputs(step, [
      {
        stepId: 'slots',
        status: 'succeeded',
        result: { verified: true, slots: [{ start: '2026-10-12T09:00:00Z' }] },
      },
    ]);
    expect(result.values).toEqual({ start: '2026-10-12T09:00:00Z' });
    expect(step.kind).toBe('browser.write');
    if (step.kind === 'browser.write') expect(step.inputs.values).toEqual({});
  });
  it('rejects missing, unverified, failed, or absent output fields', () => {
    const step = mixedPlan().steps[1]!;
    for (const prior of [
      [],
      [{ stepId: 'slots', status: 'succeeded', result: { verified: false } }],
      [{ stepId: 'slots', status: 'needs_attention', result: { verified: true, slots: [] } }],
      [{ stepId: 'slots', status: 'succeeded', result: { verified: true, slots: [] } }],
    ])
      expect(() => resolveUnifiedStepInputs(step, prior)).toThrow();
  });
  it('rejects forward or self references, duplicate IDs, removed payments and prototype paths', () => {
    const original = mixedPlan();
    for (const bad of [
      {
        ...original,
        steps: [
          {
            ...original.steps[0],
            bindings: [{ target: ['start'], fromStep: 'booking', path: ['externalRecordId'] }],
          },
          ...original.steps.slice(1),
        ],
      },
      { ...original, steps: [original.steps[0], { ...original.steps[1], id: 'slots' }] },
      {
        version: 2,
        steps: [{ id: 'pay', kind: 'payment.link', connectionId: calendarId, inputs: {} }],
      },
      {
        ...original,
        steps: [
          original.steps[0],
          {
            ...original.steps[1],
            bindings: [{ target: ['__proto__', 'polluted'], fromStep: 'slots', path: ['slots'] }],
          },
          original.steps[2],
        ],
      },
    ])
      expect(() => unifiedWorkflowPlanSchema.parse(bad)).toThrow();
  });
  it('bounds plan size and rejects null, empty and invalid types', () => {
    for (const bad of [
      null,
      undefined,
      {},
      [],
      { version: 2, steps: [] },
      { version: 2, steps: Array.from({ length: 10001 }, () => mixedPlan().steps[0]) },
    ])
      expect(() => unifiedWorkflowPlanSchema.parse(bad)).toThrow();
  });
  it('copies Unicode and SQL-looking text as data without interpreting it', () => {
    const step = mixedPlan().steps[2]!;
    expect(
      resolveUnifiedStepInputs(step, [
        {
          stepId: 'booking',
          status: 'succeeded',
          result: { verified: true, externalRecordId: "✨ kayıt ' DROP TABLE —" },
        },
      ]).body,
    ).toBe("✨ kayıt ' DROP TABLE —");
  });
});

const tenantId = randomUUID(),
  otherTenantId = randomUUID();
let owner: Pool, ctx: TenantContext;
const workflowIds: string[] = [];
async function newRun(plan = mixedPlan()) {
  const workflowId = randomUUID(),
    operationId = randomUUID();
  const systemIds = [...new Set(plan.steps.map((step) => step.connectionId))];
  const sourceText = systemIds
    .map((id) => (id === calendarId ? 'Calendar' : id === browserId ? 'ERP' : 'Mail'))
    .join(' > ');
  workflowIds.push(workflowId);
  await tenantDb(tenantId, async (db) => {
    await db.insert(s.workflows).values({
      tenantId,
      id: workflowId,
      name: 'Mixed workflow',
      purpose: 'Find a slot, book and prepare draft',
      connectionId: systemIds[0],
      mode: 'text',
      sourceText,
      systemIds,
      version: 1,
      status: 'awaiting_test',
      definition: browserDefinition as typeof s.workflows.$inferInsert.definition,
      clarification: {
        status: 'ready',
        version: 1,
        analyzedVersion: 1,
        questions: [],
        error: null,
        analysisSource: 'controlled_fixture',
        generation: 'test-generation',
      },
    });
    await db.insert(s.operations).values({
      tenantId,
      id: operationId,
      capability: 'workflow.text.test',
      actor: ctx.actor,
      workflowId,
      connectionId: systemIds[0],
      configVersion: 1,
      idempotencyKey: operationId,
      payloadHash: 'test',
      inputs: { workflowVersion: 1, textSnapshot: sourceText },
      status: 'running',
    });
  });
  const op = await tenantDb(
    tenantId,
    async (db) =>
      (await db.select().from(s.operations).where(eq(s.operations.id, operationId)))[0]!,
  );
  const started = await startUnifiedWorkflowRun(tenantId, op, plan);
  return { workflowId, operationId, runId: String(started.runId) };
}
const steps = (runId: string) =>
  tenantDb(tenantId, (db) =>
    db
      .select()
      .from(u.workflowRunSteps)
      .where(eq(u.workflowRunSteps.runId, runId))
      .orderBy(u.workflowRunSteps.position),
  );
const parent = (id: string) =>
  tenantDb(
    tenantId,
    async (db) => (await db.select().from(s.operations).where(eq(s.operations.id, id)))[0]!,
  );
async function complete(id: string, result: JsonObject, status = 'succeeded') {
  await tenantDb(tenantId, (db) =>
    db
      .update(s.operations)
      .set({ status, result, updatedAt: new Date() })
      .where(eq(s.operations.id, id)),
  );
}

describe('persisted sequential mixed workflows', () => {
  beforeAll(async () => {
    assertLocalDemoDatabase();
    owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
    const admin = (
      await owner.query<{ user_id: string }>(
        'SELECT user_id FROM memberships WHERE tenant_id=$1 AND role=$2 LIMIT 1',
        ['11111111-1111-4111-8111-111111111111', 'admin'],
      )
    ).rows[0]!;
    await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2),($3,$4)', [
      tenantId,
      'Unified workflow tests',
      otherTenantId,
      'Other tenant',
    ]);
    await owner.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      tenantId,
      admin.user_id,
      'admin',
    ]);
    ctx = { tenantId, role: 'admin', actor: { type: 'admin', id: admin.user_id } };
    await tenantDb(tenantId, async (db) => {
      await db
        .insert(s.configurations)
        .values({ tenantId, version: 1, value: defaultConfig('Unified tests') });
      await db.insert(s.connections).values([
        {
          tenantId,
          id: calendarId,
          name: 'Calendar',
          kind: 'google_calendar',
          purpose: 'Find slots',
          status: 'ready',
          config: { mode: 'demo' },
          permissions: ['calendar.read', 'calendar.create'],
          agents: ['admin'],
        },
        {
          tenantId,
          id: browserId,
          name: 'ERP',
          kind: 'browser',
          purpose: 'Controlled booking',
          status: 'ready',
          config: {
            mode: 'demo',
            loginRevision: 1,
            startUrl: 'http://127.0.0.1:4001',
            allowedOrigins: ['http://127.0.0.1:4001'],
          },
          permissions: ['browser.execute'],
          agents: ['admin'],
        },
        {
          tenantId,
          id: mailId,
          name: 'Mail',
          kind: 'gmail',
          purpose: 'Prepare drafts',
          status: 'ready',
          config: { mode: 'demo' },
          permissions: ['email.draft', 'email.send'],
          agents: ['admin'],
        },
      ]);
    });
  });
  afterAll(async () => {
    if (owner) {
      for (const table of [
        'workflow_run_steps',
        'workflow_runs',
        'approvals',
        'handoffs',
        'audit',
        'operations',
        'email_draft_sources',
        'drafts',
        'email_messages',
        'messages',
        'conversations',
        'trials',
        'cron_jobs',
        'workflows',
        'configurations',
        'connections',
        'memberships',
      ])
        await owner.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
      await owner.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [
        [tenantId, otherTenantId],
      ]);
      await owner.end();
    }
    await closeDb();
  });
  it('queues only the first read and concurrent drain creates one persisted child', async () => {
    const run = await newRun();
    await Promise.all([drainUnifiedWorkflowRuns(tenantId), drainUnifiedWorkflowRuns(tenantId)]);
    const rows = await steps(run.runId);
    expect(rows[0]?.operationId).toBeTruthy();
    expect(rows[1]?.operationId).toBeNull();
    expect(rows[2]?.status).toBe('pending');
    const child = await parent(rows[0]!.operationId!);
    expect(child).toMatchObject({
      capability: 'calendar.read',
      actor: ctx.actor,
      workflowId: run.workflowId,
      status: 'queued',
    });
    expect(
      await startUnifiedWorkflowRun(tenantId, await parent(run.operationId), mixedPlan()),
    ).toMatchObject({ runId: run.runId });
  });
  it('resolves a verified calendar read before requesting exact browser write approval then saves one draft', async () => {
    const run = await newRun();
    await drainUnifiedWorkflowRuns(tenantId);
    let rows = await steps(run.runId);
    await complete(rows[0]!.operationId!, {
      verified: true,
      slots: [{ start: '2026-10-12T09:00:00Z' }],
    });
    await drainUnifiedWorkflowRuns(tenantId);
    rows = await steps(run.runId);
    const booking = await parent(rows[1]!.operationId!);
    expect(booking.status).toBe('awaiting_approval');
    expect(booking.inputs.values).toEqual({ start: '2026-10-12T09:00:00Z' });
    expect(rows[1]?.concreteInputs?.values).toEqual({ start: '2026-10-12T09:00:00Z' });
    await drainUnifiedWorkflowRuns(tenantId);
    expect((await steps(run.runId))[2]?.status).toBe('pending');
    await complete(booking.id, {
      verified: true,
      externalRecordId: 'controlled-booking-1',
      evidence: { recordId: 'controlled-booking-1' },
    });
    await drainUnifiedWorkflowRuns(tenantId);
    await drainUnifiedWorkflowRuns(tenantId);
    expect(await parent(run.operationId)).toMatchObject({
      status: 'succeeded',
      result: { verified: true, compiledPlan: { version: 2 } },
    });
    const result = (await steps(run.runId))[2]!.result!;
    const draft = await tenantDb(
      tenantId,
      async (db) =>
        (
          await db
            .select()
            .from(s.drafts)
            .where(eq(s.drafts.id, String(result.id)))
        )[0]!,
    );
    expect(draft).toMatchObject({
      body: 'controlled-booking-1',
      status: 'draft',
      connectionId: mailId,
    });
    await drainUnifiedWorkflowRuns(tenantId);
    expect(
      await tenantDb(tenantId, (db) => db.select().from(s.drafts).where(eq(s.drafts.id, draft.id))),
    ).toHaveLength(1);
  });
  it('preserves completed results and stops after an unknown child without requeuing writes', async () => {
    const run = await newRun();
    await drainUnifiedWorkflowRuns(tenantId);
    let rows = await steps(run.runId);
    await complete(rows[0]!.operationId!, {
      verified: true,
      slots: [{ start: '2026-10-12T09:00:00Z' }],
    });
    await drainUnifiedWorkflowRuns(tenantId);
    rows = await steps(run.runId);
    const childId = rows[1]!.operationId!;
    await complete(
      childId,
      { verified: false, outcome: 'unknown', safeToRetry: false },
      'needs_attention',
    );
    await drainUnifiedWorkflowRuns(tenantId);
    await drainUnifiedWorkflowRuns(tenantId);
    rows = await steps(run.runId);
    expect(rows[0]?.status).toBe('succeeded');
    expect(rows[1]?.operationId).toBe(childId);
    expect(rows[2]?.status).toBe('pending');
    expect(await parent(run.operationId)).toMatchObject({ status: 'needs_attention' });
  });
  it('does not accept succeeded-but-unverified results as input', async () => {
    const run = await newRun();
    await drainUnifiedWorkflowRuns(tenantId);
    const first = (await steps(run.runId))[0]!;
    await complete(first.operationId!, { verified: false, slots: [{ start: 'invented' }] });
    await drainUnifiedWorkflowRuns(tenantId);
    expect((await steps(run.runId))[1]?.operationId).toBeNull();
    expect(await parent(run.operationId)).toMatchObject({ status: 'needs_attention' });
  });
  it('rechecks current connection permissions before later steps', async () => {
    const run = await newRun();
    await drainUnifiedWorkflowRuns(tenantId);
    const first = (await steps(run.runId))[0]!;
    await complete(first.operationId!, {
      verified: true,
      slots: [{ start: '2026-10-12T09:00:00Z' }],
    });
    await tenantDb(tenantId, (db) =>
      db.update(s.connections).set({ permissions: [] }).where(eq(s.connections.id, browserId)),
    );
    await drainUnifiedWorkflowRuns(tenantId);
    expect((await steps(run.runId))[1]?.operationId).toBeNull();
    expect(await parent(run.operationId)).toMatchObject({ status: 'needs_attention' });
    await tenantDb(tenantId, (db) =>
      db
        .update(s.connections)
        .set({ permissions: ['browser.execute'] })
        .where(eq(s.connections.id, browserId)),
    );
  });
  it('keeps persisted runs tenant isolated', async () => {
    const run = await newRun();
    expect(
      await tenantDb(otherTenantId, (db) =>
        db.select().from(u.workflowRuns).where(eq(u.workflowRuns.id, run.runId)),
      ),
    ).toHaveLength(0);
    await expect(
      startUnifiedWorkflowRun(otherTenantId, await parent(run.operationId), mixedPlan()),
    ).rejects.toThrow();
  });
  it('links an inbound reply to its actual sender and freezes thread context before send approval', async () => {
    const sourceMessageId = randomUUID(),
      conversationId = randomUUID();
    await tenantDb(tenantId, async (db) => {
      await db
        .update(s.connections)
        .set({ config: { mode: 'demo', accountEmail: 'owner@example.test' } })
        .where(eq(s.connections.id, mailId));
      await db.insert(s.conversations).values({
        tenantId,
        id: conversationId,
        connectionId: mailId,
        channel: 'email',
        customerName: 'Thread participant',
        customerAddress: 'first-sender@example.test',
      });
      await db.insert(s.messages).values({
        tenantId,
        id: sourceMessageId,
        conversationId,
        connectionId: mailId,
        direction: 'inbound',
        body: 'Please reply to the second sender',
        status: 'processed',
        externalId: sourceMessageId,
      });
      await db.insert(emailMessages).values({
        tenantId,
        messageId: sourceMessageId,
        connectionId: mailId,
        accountEmail: 'owner@example.test',
        providerMessageId: 'provider-message',
        sourceAddress: 'second-sender@example.test',
        threadId: 'provider-thread',
        internetMessageId: '<source@example.test>',
        subject: 'Existing conversation',
        sourceDate: new Date(),
      });
    });
    const plan = unifiedWorkflowPlanSchema.parse({
      version: 2,
      steps: [
        {
          id: 'reply',
          kind: 'email.draft',
          connectionId: mailId,
          inputs: {
            to: 'SECOND-sender@example.test',
            subject: 'Existing conversation',
            body: 'Saved reply',
            sourceMessageId,
          },
        },
        {
          id: 'send',
          kind: 'email.send',
          connectionId: mailId,
          inputs: {},
          bindings: [{ target: ['id'], fromStep: 'reply', path: ['id'] }],
        },
      ],
    });
    const run = await newRun(plan);
    await drainUnifiedWorkflowRuns(tenantId);
    let rows = await steps(run.runId);
    expect(rows[0]?.status).toBe('succeeded');
    const draftId = String(rows[0]?.result?.id);
    expect(
      await tenantDb(tenantId, (db) =>
        db.select().from(emailDraftSources).where(eq(emailDraftSources.draftId, draftId)),
      ),
    ).toMatchObject([{ sourceMessageId }]);
    await drainUnifiedWorkflowRuns(tenantId);
    rows = await steps(run.runId);
    expect(await parent(rows[1]!.operationId!)).toMatchObject({
      status: 'awaiting_approval',
      inputs: {
        draftId,
        threadId: 'provider-thread',
        sourceMessageId: 'provider-message',
        inReplyTo: '<source@example.test>',
      },
    });
    expect(
      await tenantDb(tenantId, (db) => db.select().from(s.drafts).where(eq(s.drafts.id, draftId))),
    ).toMatchObject([{ body: 'Saved reply', status: 'awaiting_approval' }]);
  });
  it('rejects outbound or changed-account reply sources and never creates an unrelated draft', async () => {
    for (const [direction, accountEmail] of [
      ['outbound', 'owner@example.test'],
      ['inbound', 'previous-account@example.test'],
    ]) {
      const sourceMessageId = randomUUID(),
        conversationId = randomUUID();
      await tenantDb(tenantId, async (db) => {
        await db.insert(s.conversations).values({
          tenantId,
          id: conversationId,
          connectionId: mailId,
          channel: 'email',
          customerName: 'Customer',
          customerAddress: 'customer@example.test',
          threadKey: conversationId,
        });
        await db.insert(s.messages).values({
          tenantId,
          id: sourceMessageId,
          conversationId,
          connectionId: mailId,
          direction: direction!,
          body: 'Email',
          status: 'processed',
          externalId: sourceMessageId,
        });
        await db.insert(emailMessages).values({
          tenantId,
          messageId: sourceMessageId,
          connectionId: mailId,
          accountEmail: accountEmail!,
          providerMessageId: sourceMessageId,
          sourceAddress: 'customer@example.test',
          threadId: sourceMessageId,
          subject: 'Source subject',
          sourceDate: new Date(),
        });
      });
      const count = (await tenantDb(tenantId, (db) => db.select().from(s.drafts))).length;
      const run = await newRun(
        unifiedWorkflowPlanSchema.parse({
          version: 2,
          steps: [
            {
              id: 'reply',
              kind: 'email.draft',
              connectionId: mailId,
              inputs: {
                to: 'customer@example.test',
                subject: 'Source subject',
                body: 'Reply',
                sourceMessageId,
              },
            },
          ],
        }),
      );
      await drainUnifiedWorkflowRuns(tenantId);
      expect(await parent(run.operationId)).toMatchObject({ status: 'needs_attention' });
      expect((await tenantDb(tenantId, (db) => db.select().from(s.drafts))).length).toBe(count);
    }
  });
  it('serializes concurrent reply creation and preserves the original draft when requested contents change', async () => {
    const sourceMessageId = randomUUID(),
      conversationId = randomUUID();
    await tenantDb(tenantId, async (db) => {
      await db
        .update(s.connections)
        .set({ config: { mode: 'demo', accountEmail: 'owner@example.test' } })
        .where(eq(s.connections.id, mailId));
      await db.insert(s.conversations).values({
        tenantId,
        id: conversationId,
        connectionId: mailId,
        channel: 'email',
        customerName: 'Customer',
        customerAddress: 'customer@example.test',
        threadKey: conversationId,
      });
      await db.insert(s.messages).values({
        tenantId,
        id: sourceMessageId,
        conversationId,
        connectionId: mailId,
        direction: 'inbound',
        body: 'A source message',
        status: 'processed',
        externalId: sourceMessageId,
      });
      await db.insert(emailMessages).values({
        tenantId,
        messageId: sourceMessageId,
        connectionId: mailId,
        accountEmail: 'owner@example.test',
        providerMessageId: sourceMessageId,
        sourceAddress: 'customer@example.test',
        threadId: sourceMessageId,
        subject: 'Source subject',
        sourceDate: new Date(),
      });
    });
    const request = {
      to: 'customer@example.test',
      subject: 'Source subject',
      body: 'Original saved reply',
      sourceMessageId,
    };
    const save = (body = request.body) =>
      tenantDb(tenantId, async (db) => {
        const connection = (
          await db.select().from(s.connections).where(eq(s.connections.id, mailId))
        )[0]!;
        return saveGuardedEmailDraft(db, tenantId, ctx.actor, connection, { ...request, body });
      });
    const [one, two] = await Promise.all([save(), save()]);
    expect(one.id).toBe(two.id);
    expect(
      await tenantDb(tenantId, (db) =>
        db
          .select()
          .from(emailDraftSources)
          .where(eq(emailDraftSources.sourceMessageId, sourceMessageId)),
      ),
    ).toHaveLength(1);
    await expect(save('Changed reply')).rejects.toMatchObject({
      code: 'EMAIL_SOURCE_ALREADY_DRAFTED',
    });
    expect(
      await tenantDb(tenantId, (db) => db.select().from(s.drafts).where(eq(s.drafts.id, one.id))),
    ).toMatchObject([{ body: 'Original saved reply' }]);
  });
  it('finds a controlled calendar slot, creates a real Chromium fixture record and prepares a draft after exact approval', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'afterhours-unified-proof-'));
    const fixture = createFixtureServer({ dataDir: join(directory, 'records'), testMode: true });
    await new Promise<void>((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
    const address = fixture.server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      await tenantDb(tenantId, (db) =>
        db
          .update(s.connections)
          .set({
            config: { mode: 'demo', loginRevision: 2, startUrl: origin, allowedOrigins: [origin] },
          })
          .where(eq(s.connections.id, browserId)),
      );
      const base = mixedPlan();
      const plan = unifiedWorkflowPlanSchema.parse({
        ...base,
        steps: [
          base.steps[0],
          {
            id: 'booking',
            kind: 'browser.write',
            connectionId: browserId,
            inputs: {
              definition: {
                name: 'Controlled booking',
                purpose: 'Save the verified slot',
                connectionId: browserId,
                requiresApproval: true,
                inputs: ['customerName', 'customerAddress', 'description'].map((key) => ({
                  key,
                  label: key,
                  required: true,
                })),
                steps: [
                  { action: 'goto', url: origin },
                  { action: 'fill', selector: '#customerName', value: '{{customerName}}' },
                  { action: 'fill', selector: '#customerAddress', value: '{{customerAddress}}' },
                  { action: 'fill', selector: '#description', value: '{{description}}' },
                  { action: 'fill', selector: '#reference', value: '{{reference}}' },
                  { action: 'click', selector: '#create-request' },
                ],
                verification: {
                  selector: '#request-record',
                  recordIdSelector: '#request-id',
                  expected: '{{description}}',
                },
                idempotency: {
                  lookupUrl: `${origin}/requests/by-reference/{{reference}}`,
                  recordIdSelector: '#request-id',
                  absentSelector: '[data-afterhours-lookup="absent"]',
                },
              },
              values: { customerName: 'Deniz', customerAddress: 'customer@example.test' },
            },
            bindings: [
              { target: ['values', 'description'], fromStep: 'slots', path: ['slots', 0, 'start'] },
            ],
          },
          base.steps[2],
        ],
      });
      const run = await newRun(plan);
      await drainUnifiedWorkflowRuns(tenantId);
      const first = (await steps(run.runId))[0]!;
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), {
              headers: { 'Content-Type': 'application/json' },
            }),
        ),
      );
      const availability = await getCalendarAvailability(
        'google_calendar',
        { calendarId: 'primary' },
        { accessToken: 'controlled-token' },
        {
          start: '2026-10-12T06:00:00Z',
          end: '2026-10-12T15:00:00Z',
          timezone: 'Europe/Istanbul',
          duration: 45,
          buffer: 15,
          hours: [{ day: 1, start: '09:00', end: '18:00' }],
        },
      );
      vi.unstubAllGlobals();
      expect(availability.slots[0]?.start).toBe('2026-10-12T06:15:00.000Z');
      await complete(first.operationId!, { verified: true, ...availability });
      await drainUnifiedWorkflowRuns(tenantId);
      const booking = (await steps(run.runId))[1]!;
      const child = await parent(booking.operationId!);
      await expect(executeUnifiedBrowserStep(tenantId, child)).rejects.toThrow('onay');
      expect(await fixture.records()).toHaveLength(0);
      const approval = await tenantDb(
        tenantId,
        async (db) =>
          (
            await db
              .select()
              .from(s.approvals)
              .where(and(eq(s.approvals.operationId, child.id), eq(s.approvals.status, 'pending')))
          )[0]!,
      );
      await runCommand(ctx, 'approval.resolve', { id: approval.id, decision: 'approve' });
      const written = await executeUnifiedBrowserStep(tenantId, await parent(child.id));
      expect(written).toMatchObject({
        verified: true,
        externalRecordId: expect.stringMatching(/^REQ-/),
      });
      await complete(child.id, written);
      await drainUnifiedWorkflowRuns(tenantId);
      await drainUnifiedWorkflowRuns(tenantId);
      expect(await fixture.records()).toHaveLength(1);
      expect((await fixture.records())[0]?.description).toBe(availability.slots[0]?.start);
      const final = (await steps(run.runId))[2]!;
      const draft = await tenantDb(
        tenantId,
        async (db) =>
          (
            await db
              .select()
              .from(s.drafts)
              .where(eq(s.drafts.id, String(final.result?.id)))
          )[0]!,
      );
      expect(draft.body).toBe(written.externalRecordId);
      expect(draft.status).toBe('draft');
      expect(await parent(run.operationId)).toMatchObject({
        status: 'succeeded',
        result: { verified: true },
      });
      await drainUnifiedWorkflowRuns(tenantId);
      expect(await fixture.records()).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 45_000);
});
