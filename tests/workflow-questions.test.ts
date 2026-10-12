import { describe, expect, it } from 'vitest';
import {
  assertWorkflowClarified,
  emptyWorkflowClarification,
} from '../packages/core/src/workflow-clarifications.js';

describe('workflow clarification gate', () => {
  it('blocks unanalyzed, unanswered and stale instructions', () => {
    expect(() =>
      assertWorkflowClarified({ version: 2, clarification: emptyWorkflowClarification(2) }),
    ).toThrow();
    const ready = {
      ...emptyWorkflowClarification(2),
      status: 'ready' as const,
      analyzedVersion: 2,
    };
    expect(() => assertWorkflowClarified({ version: 2, clarification: ready })).not.toThrow();
    expect(() => assertWorkflowClarified({ version: 3, clarification: ready })).toThrow();
    expect(() =>
      assertWorkflowClarified({
        version: 2,
        clarification: {
          ...ready,
          questions: [
            {
              id: 'a',
              prompt: 'Hangi durum?',
              reason: 'uncertain',
              answer: null,
              status: 'open' as const,
              workflowVersion: 2,
            },
          ],
        },
      }),
    ).toThrow();
  });
});

import { afterAll, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { tenantDb, closeDb } from '../packages/core/src/db.js';
import * as s from '../packages/core/src/schema.js';
import { defaultConfig } from '../packages/core/src/policy.js';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import {
  analyzeWorkflowQuestions,
  assertWorkflowClarificationDependencies,
  handleWorkflowClarificationCommand,
} from '../packages/core/src/workflow-clarifications.js';
import { handleTextWorkflowCommand } from '../packages/core/src/text-workflows.js';
import type { TenantContext } from '../packages/core/src/types.js';
const fake = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('../packages/core/src/ai-providers.js', () => ({ generateProviderJson: fake.generate }));
const tenant = randomUUID(),
  otherTenant = randomUUID(),
  connection = randomUUID();
let owner: Pool, ctx: TenantContext, staff: TenantContext;
const getWorkflow = (id: string) =>
  tenantDb(
    tenant,
    async (db) => (await db.select().from(s.workflows).where(eq(s.workflows.id, id)))[0]!,
  );
beforeAll(async () => {
  assertLocalDemoDatabase();
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const users = (
    await owner.query<{ user_id: string; role: string }>(
      'SELECT user_id,role FROM memberships WHERE tenant_id=$1',
      ['11111111-1111-4111-8111-111111111111'],
    )
  ).rows;
  const admin = users.find((u) => u.role === 'admin')!,
    employee = users.find((u) => u.role === 'staff')!;
  await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2),($3,$4)', [
    tenant,
    'Workflow questions',
    otherTenant,
    'Other questions',
  ]);
  await owner.query(
    'INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3),($1,$4,$5),($6,$2,$3)',
    [tenant, admin.user_id, 'admin', employee.user_id, 'staff', otherTenant],
  );
  ctx = { tenantId: tenant, role: 'admin', actor: { type: 'admin', id: admin.user_id } };
  staff = { tenantId: tenant, role: 'staff', actor: { type: 'staff', id: employee.user_id } };
  await tenantDb(tenant, async (db) => {
    await db
      .insert(s.configurations)
      .values({ tenantId: tenant, version: 1, value: defaultConfig('Question test') });
    await db.insert(s.connections).values({
      tenantId: tenant,
      id: connection,
      name: 'Question ERP',
      kind: 'browser',
      purpose: 'Requests',
      status: 'ready',
      permissions: ['browser.execute'],
      agents: ['admin'],
      config: { startUrl: 'http://127.0.0.1:4001', allowedOrigins: ['http://127.0.0.1:4001'] },
    });
  });
});
afterAll(async () => {
  if (owner) {
    for (const table of [
      'runtime',
      'cron_jobs',
      'approvals',
      'operations',
      'workflows',
      'audit',
      'configurations',
      'connections',
      'memberships',
    ]) {
      // Keep cleanup table names fixed; workflows here never execute external operations.
      await owner.query(`DELETE FROM ${table} WHERE tenant_id=$1 OR tenant_id=$2`, [
        tenant,
        otherTenant,
      ]);
    }
    await owner.query('DELETE FROM tenants WHERE id=$1 OR id=$2', [tenant, otherTenant]);
    await owner.end();
  }
  await closeDb();
});
describe('persistent workflow questions (controlled provider responses)', () => {
  it('asks questions, blocks test, persists answers, then requires a new verified test', async () => {
    const saved = await handleTextWorkflowCommand(ctx, 'workflow.text.save', {
      name: 'Ask first',
      text: 'Question ERP > yeni talepleri işle > her 10 dakika',
    });
    const id = String(saved.data?.id);
    fake.generate.mockResolvedValueOnce({
      questions: [{ prompt: 'Yeni talep hangi durumdur?', reason: 'Durum belirsiz.' }],
    });
    await analyzeWorkflowQuestions(ctx, id);
    let w = await getWorkflow(id);
    expect(w.clarification?.status).toBe('needs_answers');
    expect(w.enabled).toBe(false);
    await expect(
      handleTextWorkflowCommand(ctx, 'workflow.text.test', { id }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_QUESTIONS_REQUIRED' });
    const question = w.clarification!.questions[0]!;
    fake.generate.mockResolvedValueOnce({ questions: [] });
    await handleWorkflowClarificationCommand(ctx, 'workflow.questions.answer', {
      id,
      questionId: question.id,
      answer: 'Yalnızca bekleyen durumundaki talepler.',
      version: w.version,
    });
    w = await getWorkflow(id);
    expect(w.version).toBe(2);
    expect(w.clarification?.status).toBe('ready');
    expect(w.clarification?.questions[0]?.answer).toContain('bekleyen');
    expect(w.publishedVersion).toBeNull();
    const jobs = await tenantDb(tenant, (db) =>
      db.select().from(s.cronJobs).where(eq(s.cronJobs.workflowId, id)),
    );
    expect(jobs[0]?.enabled).toBe(false);
    await expect(
      handleWorkflowClarificationCommand(ctx, 'workflow.questions.answer', {
        id,
        questionId: question.id,
        answer: 'Farklı cevap',
        version: 1,
      }),
    ).rejects.toMatchObject({ code: 'STALE_WORKFLOW' });
    await expect(
      handleWorkflowClarificationCommand(staff, 'workflow.questions.answer', {
        id,
        questionId: question.id,
        answer: 'Yetkisiz',
        version: 2,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      analyzeWorkflowQuestions({ ...ctx, tenantId: otherTenant }, id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('updates question counts and blocks a completed analysis when business settings change', async () => {
    const saved = await handleTextWorkflowCommand(ctx, 'workflow.text.save', {
      name: 'Dynamic questions',
      text: 'Question ERP > talepleri işle',
    });
    const id = String(saved.data?.id);
    fake.generate.mockResolvedValueOnce({
      questions: [
        { prompt: 'Hangi durum?', reason: 'Durum eksik' },
        { prompt: 'Sonuç kime bildirilsin?', reason: 'Alıcı eksik' },
      ],
    });
    await analyzeWorkflowQuestions(ctx, id);
    let w = await getWorkflow(id);
    expect(w.clarification?.questions.filter((q) => q.status === 'open')).toHaveLength(2);
    fake.generate.mockResolvedValueOnce({
      questions: [{ prompt: 'Sonuç kime bildirilsin?', reason: 'Alıcı eksik' }],
    });
    await handleWorkflowClarificationCommand(ctx, 'workflow.questions.answer', {
      id,
      questionId: w.clarification!.questions[0]!.id,
      answer: 'Bekleyen talepler.',
      version: w.version,
    });
    w = await getWorkflow(id);
    expect(w.clarification?.questions.filter((q) => q.status === 'open')).toHaveLength(1);
    fake.generate.mockResolvedValueOnce({
      questions: [
        { prompt: 'Sonuç kime bildirilsin?', reason: 'Alıcı eksik' },
        { prompt: 'Hangi günlerde?', reason: 'Gün belirsiz' },
      ],
    });
    await analyzeWorkflowQuestions(ctx, id);
    expect(
      (await getWorkflow(id)).clarification?.questions.filter((q) => q.status === 'open'),
    ).toHaveLength(2);
    fake.generate.mockResolvedValueOnce({ questions: [] });
    await analyzeWorkflowQuestions(ctx, id);
    w = await getWorkflow(id);
    await expect(assertWorkflowClarificationDependencies(tenant, w)).resolves.toBeUndefined();
    await tenantDb(tenant, (db) =>
      db.insert(s.configurations).values({
        tenantId: tenant,
        version: 2,
        value: { ...defaultConfig('Changed business'), version: 2 },
      }),
    );
    await expect(assertWorkflowClarificationDependencies(tenant, w)).rejects.toMatchObject({
      code: 'WORKFLOW_ANALYSIS_STALE',
    });
  });
  it('rejects an old successful test after a fresh analysis and clears transient browser errors', async () => {
    const saved = await handleTextWorkflowCommand(ctx, 'workflow.text.save', {
        name: 'Analysis generation',
        text: 'Question ERP > talepleri listele',
      }),
      id = String(saved.data?.id);
    fake.generate.mockResolvedValue({ questions: [] });
    await analyzeWorkflowQuestions(ctx, id);
    const tested = await handleTextWorkflowCommand(ctx, 'workflow.text.test', { id });
    const operationId = String(tested.data?.operationId);
    await tenantDb(tenant, async (db) => {
      const w = (await db.select().from(s.workflows).where(eq(s.workflows.id, id)))[0]!;
      await db
        .update(s.operations)
        .set({
          status: 'succeeded',
          result: {
            verified: true,
            compiledPlan: {
              systems: [
                {
                  connectionId: connection,
                  plan: {
                    kind: 'read',
                    url: 'http://127.0.0.1:4001',
                    selector: '#request-count',
                    expected: '0',
                  },
                },
              ],
              systemRevisions: { [connection]: 0 },
            },
          },
        })
        .where(eq(s.operations.id, operationId));
      await db
        .update(s.workflows)
        .set({ planningError: 'Okuma kanıtı bulunamadı veya belirsiz.' })
        .where(eq(s.workflows.id, w.id));
    });
    await analyzeWorkflowQuestions(ctx, id);
    const w = await getWorkflow(id);
    expect(w.clarification?.status).toBe('ready');
    expect(w.clarification?.questions.filter((q) => q.status === 'open')).toHaveLength(0);
    expect(w.planningError).toBeNull();
    await expect(
      handleTextWorkflowCommand(ctx, 'workflow.text.confirm', { id, operationId, confirmed: true }),
    ).rejects.toMatchObject({ code: 'STALE_TEST' });
    expect((await getWorkflow(id)).enabled).toBe(false);
  });
  it('discards stale analysis after an edit and never treats provider failure as ready', async () => {
    const saved = await handleTextWorkflowCommand(ctx, 'workflow.text.save', {
        name: 'Race',
        text: 'Question ERP > kayıt oluştur',
      }),
      id = String(saved.data?.id);
    let resolve!: (v: unknown) => void;
    fake.generate.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const analysis = analyzeWorkflowQuestions(ctx, id);
    for (let i = 0; i < 100 && !resolve; i++) await new Promise((r) => setTimeout(r, 5));
    await handleTextWorkflowCommand(ctx, 'workflow.text.save', {
      id,
      name: 'Race updated',
      text: 'Question ERP > kaydı güncelle',
    });
    resolve({ questions: [] });
    await analysis;
    expect((await getWorkflow(id)).clarification?.status).toBe('not_analyzed');
    fake.generate.mockRejectedValueOnce(new Error('Private provider failure'));
    await analyzeWorkflowQuestions(ctx, id);
    const w = await getWorkflow(id);
    expect(w.clarification?.status).toBe('needs_attention');
    expect(w.clarification?.error).not.toContain('Private');
  });
});
