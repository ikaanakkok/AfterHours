import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { tenantDb, getAuthDb, getPool, enqueue, type TenantDb } from './db.js';
import * as s from './schema.js';
import { one, createOperation } from './commands.js';
import { currentConfig, connectionView, log, updateConnectionStatus } from './store.js';
import {
  authorizeConnection,
  canonicalCapability,
  financialTerms,
  isActive,
  requestsHuman,
  validateWorkflowInputs,
} from './policy.js';
import { HttpError, OutcomeUnknown } from './errors.js';
import {
  decryptSecret,
  readConnectionSecret,
  redact,
  stableHash,
  writeConnectionSecret,
  rotateConnectionSecret,
} from './security.js';
import { projectRoot, isDemo } from './env.js';
import {
  executeBrowserWorkflow,
  startTeachingSession,
  stopTeachingSession,
  testBrowserConnection,
} from './browser.js';
import { decideSchedule } from './scheduling.js';
import * as providers from './integrations/index.js';
import { executeBackofficeLogin } from './backoffice.js';
import { executeTextWorkflowOperation, assertTextWorkflowExecution } from './text-workflows.js';
import {
  assertUnifiedWorkflowStepExecution,
  executeUnifiedBrowserStep,
} from './unified-workflows.js';
import { workflowRuns } from './unified-workflow-schema.js';
import { getEmailDraftReplyContext } from './email-sync.js';
import { calendarConnectionRevision } from './calendar-commands.js';
import { getContextKnowledge } from './context-materials.js';
import type {
  Actor,
  ConnectionKind,
  CoreApi,
  InboundMessage,
  JsonObject,
  TenantContext,
  WorkflowDefinition,
} from './types.js';

const system = { type: 'system', id: 'worker' } as const;
const workerContext = (tenantId: string, actor: Actor = system): TenantContext => ({
  tenantId,
  actor,
  role: null,
});
export async function allTenants() {
  return getAuthDb().select({ id: s.tenants.id, name: s.tenants.name }).from(s.tenants);
}
export async function getWorkerConnections(kind: string) {
  const all = [];
  for (const tenant of await allTenants())
    all.push(
      ...(await tenantDb(tenant.id, async (db) =>
        (await db.select().from(s.connections).where(eq(s.connections.kind, kind))).map((c) => ({
          ...connectionView(c),
          tenantId: tenant.id,
        })),
      )),
    );
  return all;
}
async function addReply(
  db: TenantDb,
  tenantId: string,
  c: typeof s.conversations.$inferSelect,
  body: string,
  key: string,
) {
  await db
    .insert(s.messages)
    .values({
      tenantId,
      conversationId: c.id,
      connectionId: c.connectionId,
      externalId: key,
      direction: 'outbound',
      body,
      status: 'pending',
    })
    .onConflictDoNothing();
}
export async function receiveMessage(
  tenantId: string,
  event: InboundMessage,
): Promise<{ conversationId: string; duplicate: boolean }> {
  const response = await tenantDb(tenantId, async (db) => {
    const c = await one(
      db.select().from(s.connections).where(eq(s.connections.id, event.connectionId)),
      'Kanal',
    );
    if (c.kind !== 'whatsapp' && !['gmail', 'outlook'].includes(c.kind))
      throw new HttpError(
        400,
        'INVALID_CHANNEL',
        'Gelen mesaj kayıtlı iletişim kanalına ait olmalı.',
      );
    if (event.channel === 'demo' && (!isDemo() || c.config.mode !== 'demo'))
      throw new HttpError(403, 'CHANNEL_MISMATCH', 'Bu bağlantı test kanalı değil.');
    if (event.channel === 'whatsapp' && c.config.mode === 'demo')
      throw new HttpError(403, 'CHANNEL_MISMATCH', 'Gerçek mesajlar test bağlantısına yazılamaz.');
    if (!event.externalId || event.body.length > 16000 || !event.address)
      throw new HttpError(400, 'INVALID_MESSAGE', 'Mesaj geçerli bir sağlayıcı kimliği taşımalı.');
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${tenantId + ':inbound:' + event.connectionId + ':' + event.address},0))`,
    );
    const existing = (
      await db
        .select()
        .from(s.messages)
        .where(and(eq(s.messages.connectionId, c.id), eq(s.messages.externalId, event.externalId)))
    )[0];
    if (existing) return { conversationId: existing.conversationId, duplicate: true };
    let convo = (
      await db
        .select()
        .from(s.conversations)
        .where(
          and(
            eq(s.conversations.connectionId, c.id),
            eq(s.conversations.customerAddress, event.address),
            eq(s.conversations.threadKey, ''),
          ),
        )
    )[0];
    if (!convo)
      convo = await one(
        db
          .insert(s.conversations)
          .values({
            tenantId,
            connectionId: c.id,
            channel: event.channel,
            customerName: event.name.slice(0, 100),
            customerAddress: event.address,
          })
          .returning(),
      );
    await db.insert(s.messages).values({
      tenantId,
      conversationId: convo.id,
      connectionId: c.id,
      externalId: event.externalId,
      direction: 'inbound',
      body: event.body,
      status: 'received',
    });
    await db
      .update(s.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(s.conversations.id, convo.id));
    await log(db, tenantId, { type: 'customer', id: convo.id }, 'message.received', convo.id, {
      channel: event.channel,
      providerEventId: event.externalId,
    });
    return { conversationId: convo.id, duplicate: false };
  });
  if (!response.duplicate)
    await enqueue('afterhours.conversation', { tenantId, conversationId: response.conversationId });
  return response;
}

export async function processConversation(tenantId: string, conversationId: string) {
  const contextKnowledge = await getContextKnowledge(tenantId);
  let operationId: string | undefined;
  try {
    await tenantDb(tenantId, async (db) => {
      const locked = await db.execute(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${tenantId + ':conversation:' + conversationId},0)) as locked`,
      );
      if (!locked.rows[0]?.locked) return;
      const c = await one(
        db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)),
      );
      if (['email', 'gmail', 'outlook'].includes(c.channel)) return;
      const savedConfig = await currentConfig(db);
      const config = { ...savedConfig, knowledge: [...savedConfig.knowledge, ...contextKnowledge] };
      if (c.mode === 'human' || !isActive(config)) return;
      const channel = await one(
        db.select().from(s.connections).where(eq(s.connections.id, c.connectionId)),
      );
      if (channel.status !== 'ready' || !channel.agents.includes('customer')) return;
      const ms = await db
        .select()
        .from(s.messages)
        .where(eq(s.messages.conversationId, c.id))
        .orderBy(asc(s.messages.createdAt), asc(s.messages.id));
      const last = ms.filter((m) => m.direction === 'inbound').at(-1);
      if (!last || last.id === c.lastProcessedId) return;
      const unprocessed = ms
        .slice(c.lastProcessedId ? ms.findIndex((m) => m.id === c.lastProcessedId) + 1 : 0)
        .filter((m) => m.direction === 'inbound');
      const active = (
        await db
          .select()
          .from(s.operations)
          .where(
            and(
              eq(s.operations.conversationId, c.id),
              inArray(s.operations.status, [
                'queued',
                'running',
                'verifying',
                'awaiting_approval',
                'needs_attention',
              ]),
            ),
          )
      )[0];
      if (unprocessed.some((message) => requestsHuman(message.body))) {
        await handoff(db, tenantId, c, 'Müşteri insanla görüşmek istedi.');
        await db
          .update(s.conversations)
          .set({ lastProcessedId: last.id })
          .where(eq(s.conversations.id, c.id));
        await addReply(
          db,
          tenantId,
          c,
          'Talebinizi ekibe ilettim. Konuşmayı personelin devam etmesi için bırakıyorum.',
          `handoff:${last.id}`,
        );
        return;
      }
      if (active) return;
      const w = (
        await db
          .select()
          .from(s.workflows)
          .where(and(eq(s.workflows.status, 'ready'), eq(s.workflows.mode, 'legacy')))
          .orderBy(asc(s.workflows.createdAt))
      )[0];
      if (!w?.publishedDefinition || !w.connectionId) {
        await handoff(db, tenantId, c, 'Bu talep için yayımlanmış ve doğrulanmış bir işlem yok.');
        await addReply(
          db,
          tenantId,
          c,
          'Talebinizi ekibe ilettim. Uygun işlemi henüz yapamıyorum.',
          `handoff:${last.id}`,
        );
        return;
      }
      const completed = (
        await db
          .select()
          .from(s.operations)
          .where(and(eq(s.operations.conversationId, c.id), eq(s.operations.status, 'succeeded')))
          .orderBy(desc(s.operations.updatedAt))
          .limit(1)
      )[0];
      const requestState = c.requestState === 'idle' && completed ? 'completed' : c.requestState;
      const currentMessages =
        requestState === 'completed'
          ? [last]
          : completed
            ? ms.filter((m) => m.createdAt > completed.updatedAt)
            : ms;
      const knownInputs = requestState === 'completed' ? {} : c.inputs;
      const planned = await providers.planCustomerReply({
        tenantId,
        config,
        messages: (currentMessages.length ? currentMessages : [last]).slice(-20).map((m) => ({
          role: m.direction === 'inbound' ? ('customer' as const) : ('assistant' as const),
          body: m.body,
        })),
        availableInputs: w.publishedDefinition.inputs,
        inputs: {
          ...knownInputs,
          customerName: c.customerName,
          customerAddress: c.customerAddress,
        },
        requestState,
        completedRecordId: completed?.result?.externalRecordId as string | undefined,
        mode: c.channel === 'demo' && channel.config.mode === 'demo' ? 'demo' : 'live',
      });
      const inputs: JsonObject = {
        ...knownInputs,
        ...planned.inputs,
        customerAddress: c.customerAddress,
      };
      // The provider channel address binds the reply destination; model text never chooses ownership or actor.
      for (const key of Object.keys(inputs))
        if (!w.publishedDefinition.inputs.some((spec) => spec.key === key)) delete inputs[key];
      if (
        requestState === 'completed' &&
        !planned.newRequest &&
        ['collect', 'execute'].includes(planned.action)
      ) {
        await db
          .update(s.conversations)
          .set({ requestState, inputs: {}, lastProcessedId: last.id })
          .where(eq(s.conversations.id, c.id));
        await addReply(
          db,
          tenantId,
          c,
          'Önceki talebiniz kaydedildi. Yeni bir talep mi oluşturmak istiyorsunuz?',
          `reply:${last.id}`,
        );
        return;
      }
      const continuing = planned.action === 'collect' || planned.action === 'execute';
      await db
        .update(s.conversations)
        .set({
          inputs: continuing ? inputs : knownInputs,
          requestState: continuing ? 'collecting' : requestState,
          lastProcessedId: last.id,
        })
        .where(eq(s.conversations.id, c.id));
      if (planned.action === 'handoff') {
        await handoff(
          db,
          tenantId,
          c,
          'Müşteri insanla görüşmek istiyor veya talep güvenli biçimde tamamlanamıyor.',
        );
        await addReply(db, tenantId, c, planned.reply, `handoff:${last.id}`);
        return;
      }
      if (planned.action === 'execute') {
        try {
          const values = validateWorkflowInputs(w.publishedDefinition, inputs);
          const op = await createOperation(
            db,
            workerContext(tenantId, { type: 'customer', id: c.id }),
            {
              capability: 'browser.execute',
              connectionId: w.connectionId,
              workflowId: w.id,
              conversationId: c.id,
              inputs: {
                definition: w.publishedDefinition,
                workflowVersion: w.publishedVersion,
                values,
              },
              idempotencyKey: `customer:${c.id}:${last.id}`,
              requiresApproval: w.publishedDefinition.requiresApproval,
            },
          );
          operationId = op.id;
          if (op.status === 'awaiting_approval')
            await addReply(
              db,
              tenantId,
              c,
              'Talebiniz hazır. İşletme onayını bekliyorum; işlem henüz tamamlanmadı.',
              `approval:${op.id}`,
            );
        } catch (error) {
          await handoff(
            db,
            tenantId,
            c,
            error instanceof HttpError
              ? error.message
              : 'İşlem için gerekli izin veya bilgi tamamlanamadı.',
          );
          await addReply(
            db,
            tenantId,
            c,
            'Bu işlemi tamamlamak için ekibin yardımına ihtiyacım var. Talebinizi panele ilettim.',
            `failure:${last.id}`,
          );
        }
      } else await addReply(db, tenantId, c, planned.reply, `reply:${last.id}`);
    });
  } catch (error) {
    await tenantDb(tenantId, async (db) => {
      const c = (
        await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId))
      )[0];
      if (!c) return;
      await handoff(
        db,
        tenantId,
        c,
        'Müşteri asistanı yanıt üretemedi. Model veya bağlantı ayarlarını inceleyin.',
      );
      if (isActive(await currentConfig(db)))
        await addReply(
          db,
          tenantId,
          c,
          'Talebinizi şu anda güvenli biçimde işleyemiyorum. Durumu ekibe ilettim.',
          `handoff:error:${c.id}:${c.lastProcessedId ?? 'new'}`,
        );
    });
  }
  if (operationId) await enqueue('afterhours.operation', { tenantId, operationId });
}

async function handoff(
  db: TenantDb,
  tenantId: string,
  c: typeof s.conversations.$inferSelect,
  reason: string,
  operationId?: string,
) {
  await db
    .update(s.conversations)
    .set({ mode: 'human', updatedAt: new Date() })
    .where(eq(s.conversations.id, c.id));
  await db
    .update(s.messages)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(s.messages.conversationId, c.id),
        eq(s.messages.direction, 'outbound'),
        inArray(s.messages.status, ['pending', 'retry']),
        sql`${s.messages.externalId} not like 'staff:%'`,
      ),
    );
  await db.insert(s.handoffs).values({ tenantId, conversationId: c.id, operationId, reason });
  await log(db, tenantId, system, 'conversation.handoff', c.id, {
    reason,
    operationId: operationId ?? null,
  });
}

async function assertExecution(db: TenantDb, op: typeof s.operations.$inferSelect) {
  if (op.capability.startsWith('payment.'))
    throw new HttpError(410, 'PAYMENTS_REMOVED', 'Ödeme modülü kaldırıldı.');
  const config = await currentConfig(db);
  if (config.version !== op.configVersion)
    throw new HttpError(
      409,
      'STALE_OPERATION',
      'İşlem hazırlandıktan sonra ayarlar değişti. Güncel ayarlarla yeniden hazırlayın.',
    );
  const hash = stableHash({
    capability: op.capability,
    inputs: op.inputs,
    actor: op.actor,
    connectionId: op.connectionId ?? undefined,
    configVersion: op.configVersion,
  });
  if (hash !== op.payloadHash)
    throw new HttpError(409, 'PAYLOAD_CHANGED', 'İşlem girdileri değişmiş.');
  const conn = op.connectionId
    ? await one(
        db.select().from(s.connections).where(eq(s.connections.id, op.connectionId)).for('update'),
      )
    : undefined;
  if (
    conn?.config.backoffice === true &&
    op.capability === 'connection.test' &&
    conn.config.loginRevision !== op.inputs.loginRevision
  )
    throw new HttpError(
      409,
      'LOGIN_CHANGED',
      'Giriş bilgileri test başladıktan sonra değişti. Yeni test yapın.',
    );
  if (conn && op.inputs.connectionRevision !== calendarConnectionRevision(conn))
    throw new HttpError(
      409,
      'CONNECTION_CHANGED',
      'Onaylanan bağlantı, hesap veya yetkiler değişti. İşlemi yeniden hazırlayın.',
    );
  if (op.capability.startsWith('workflow.text.')) await assertTextWorkflowExecution(db, op, config);
  if (op.inputs.unifiedRunId) await assertUnifiedWorkflowStepExecution(db, op, config);
  const connectionApprovals = Array.isArray(conn?.config.requireApproval)
    ? conn.config.requireApproval
        .filter((value): value is string => typeof value === 'string')
        .map(canonicalCapability)
    : [];
  if (
    (!(op.capability.startsWith('workflow.text.') && !op.connectionId) &&
      config.requireApproval
        .map(canonicalCapability)
        .includes(canonicalCapability(op.capability))) ||
    connectionApprovals.includes(canonicalCapability(op.capability)) ||
    op.requiresApproval ||
    op.capability === 'calendar.cancel' ||
    op.capability === 'payment.link'
  ) {
    const approval = (
      await db
        .select()
        .from(s.approvals)
        .where(
          and(
            eq(s.approvals.operationId, op.id),
            eq(s.approvals.status, 'approved'),
            eq(s.approvals.payloadHash, op.payloadHash),
            eq(s.approvals.configVersion, config.version),
          ),
        )
    )[0];
    if (
      !approval ||
      approval.payloadHash !== op.payloadHash ||
      approval.configVersion !== config.version
    )
      throw new HttpError(
        403,
        'APPROVAL_REQUIRED',
        'İşlemin güncel girdileri için admin onayı gerekiyor.',
      );
  }
  // An explicit workflow approval stays mandatory even if global defaults omit it.
  if (
    ['browser.execute', 'browser.trial'].includes(op.capability) &&
    op.inputs.definition &&
    (op.inputs.definition as WorkflowDefinition).requiresApproval
  ) {
    const approval = (
      await db
        .select()
        .from(s.approvals)
        .where(
          and(
            eq(s.approvals.operationId, op.id),
            eq(s.approvals.status, 'approved'),
            eq(s.approvals.payloadHash, op.payloadHash),
            eq(s.approvals.configVersion, config.version),
          ),
        )
    )[0];
    if (
      !approval ||
      approval.payloadHash !== op.payloadHash ||
      approval.configVersion !== config.version
    )
      throw new HttpError(403, 'APPROVAL_REQUIRED', 'Bu iş için onay gerekli.');
  }
  if (op.actor.type === 'admin' || op.actor.type === 'staff') {
    const m = (
      await getAuthDb()
        .select()
        .from(s.memberships)
        .where(and(eq(s.memberships.userId, op.actor.id), eq(s.memberships.tenantId, op.tenantId)))
    )[0];
    if (!m || m.role !== op.actor.type)
      throw new HttpError(
        403,
        'ACTOR_ACCESS_REVOKED',
        'İşlemi başlatan kişinin erişimi kaldırılmış.',
      );
  }
  if (op.conversationId) {
    const c = await one(
      db.select().from(s.conversations).where(eq(s.conversations.id, op.conversationId)),
    );
    if (c.mode !== 'ai' || !isActive(config))
      throw new HttpError(
        409,
        'AUTOMATION_PAUSED',
        'Konuşma personele devredilmiş veya AI aktif değil.',
      );
  }
  if (conn && op.capability !== 'connection.test')
    authorizeConnection(connectionView(conn), op.actor, canonicalCapability(op.capability), {
      testing: op.capability.startsWith('teaching.') || op.capability === 'browser.trial',
    });
  if (op.workflowId) {
    const w = await one(db.select().from(s.workflows).where(eq(s.workflows.id, op.workflowId)));
    const published =
      op.capability === 'browser.execute' || op.capability === 'workflow.text.execute';
    const expected = published ? w.publishedVersion : w.version;
    if (expected !== op.inputs.workflowVersion)
      throw new HttpError(409, 'WORKFLOW_CHANGED', 'İşin sürümü değişmiş.');
    if (published && (w.status !== 'ready' || (w.mode === 'text' && !w.enabled)))
      throw new HttpError(409, 'NOT_PUBLISHED', 'İş doğrulanmış ve etkin değil.');
  }
  if (op.cronId) {
    const cron = await one(db.select().from(s.cronJobs).where(eq(s.cronJobs.id, op.cronId)));
    if (cron.deletedAt) throw new HttpError(410, 'CRON_DELETED', 'Görev silinmiş.');
    if (op.inputs.cronVersion !== undefined && op.inputs.cronVersion !== cron.version)
      throw new HttpError(
        409,
        'CRON_CHANGED',
        'Görev ayarları değişmiş. Yeni sürümle tekrar deneyin.',
      );
    if (
      (op.inputs.trigger === 'scheduled' || op.idempotencyKey.startsWith('cron:')) &&
      !cron.enabled
    )
      throw new HttpError(
        409,
        'CRON_PAUSED',
        'Görev duraklatıldığı için bekleyen zamanlanmış işlem çalıştırılmadı.',
      );
  }
  return { config, conn };
}

export async function executeOperation(tenantId: string, operationId: string): Promise<void> {
  const lockClient = await getPool().connect();
  let locked = false;
  try {
    const snapshot = await tenantDb(tenantId, (db) =>
      one(db.select().from(s.operations).where(eq(s.operations.id, operationId))),
    );
    if (['succeeded', 'failed', 'needs_attention', 'awaiting_approval'].includes(snapshot.status))
      return;
    const lockKey = `${tenantId}:${snapshot.connectionId ?? snapshot.id}`;
    locked =
      (
        await lockClient.query<{ locked: boolean }>(
          'select pg_try_advisory_lock(hashtextextended($1,0)) as locked',
          [lockKey],
        )
      ).rows[0]?.locked === true;
    if (!locked) return;
    if (snapshot.status === 'verifying' && snapshot.result?.pendingSteps === true) {
      const active = await tenantDb(
        tenantId,
        async (db) =>
          (
            await db
              .select({ id: workflowRuns.id })
              .from(workflowRuns)
              .where(
                and(
                  eq(workflowRuns.parentOperationId, snapshot.id),
                  inArray(workflowRuns.status, ['running', 'awaiting_approval']),
                ),
              )
          )[0],
      );
      if (active) return;
    }
    if (snapshot.status === 'running' || snapshot.status === 'verifying') {
      if (Date.now() - snapshot.updatedAt.getTime() > 90000)
        await failOperation(
          tenantId,
          snapshot,
          new OutcomeUnknown(
            'Worker kesintisi sonrası işlem sonucu incelenmeli. Kör yeniden deneme yapılmadı.',
          ),
        );
      return;
    }
    const claimed = await tenantDb(tenantId, async (db) => {
      const op = await one(db.select().from(s.operations).where(eq(s.operations.id, operationId)));
      if (op.status !== 'queued') return null;
      const details = await assertExecution(db, op);
      await db
        .update(s.operations)
        .set({
          status: 'running',
          attempts: op.attempts + 1,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(s.operations.id, op.id), eq(s.operations.status, 'queued')));
      await log(db, tenantId, op.actor, 'operation.started', op.id, {
        capability: op.capability,
        attempt: op.attempts + 1,
      });
      const secret = details.conn
        ? (
            await db
              .select()
              .from(s.secrets)
              .where(eq(s.secrets.connectionId, details.conn.id))
              .for('share')
          )[0]
        : undefined;
      if (
        op.capability === 'connection.test' &&
        op.inputs.credentialRevision !== stableHash(secret?.ciphertext ?? null)
      )
        throw new HttpError(409, 'CONNECTION_CHANGED', 'Hesap erişimi değişti. Yeni test yapın.');
      return { op, ...details, ciphertext: secret?.ciphertext };
    });
    if (!claimed) return;
    const { op, config, conn } = claimed;
    let output: JsonObject;
    const credential =
        conn && claimed.ciphertext
          ? await decryptSecret(tenantId, conn.id, claimed.ciphertext)
          : {},
      oldCredential = stableHash(credential);
    const profileDir = `${projectRoot}.data/profiles/${tenantId}/${conn?.id}`;
    const origins = Array.isArray(conn?.config.allowedOrigins)
      ? conn.config.allowedOrigins.filter((v): v is string => typeof v === 'string')
      : [];
    let providerFailed = false;
    try {
      if (op.capability.startsWith('workflow.text.')) {
        const executed = await executeTextWorkflowOperation(tenantId, op);
        output = {
          ...executed.evidence,
          verified: executed.verified,
          externalRecordId: executed.externalRecordId ?? null,
        };
      } else if (
        op.capability === 'workflow.step.read' ||
        op.capability === 'workflow.step.write'
      ) {
        output = await executeUnifiedBrowserStep(tenantId, op);
      } else if (op.capability === 'browser.execute' || op.capability === 'browser.trial') {
        if (!conn || conn.kind !== 'browser')
          throw new HttpError(400, 'BROWSER_REQUIRED', 'Tarayıcı bağlantısı gerekli.');
        const def = op.inputs.definition as WorkflowDefinition,
          values = op.inputs.values as JsonObject;
        validateWorkflowInputs(def, values);
        const executed = await executeBrowserWorkflow({
          profileDir,
          allowedOrigins: origins,
          definition: def,
          inputs: values,
          reference: op.id,
          headless: true,
        });
        if (!executed.verified || !executed.externalRecordId) throw new OutcomeUnknown();
        output = executed as unknown as JsonObject;
      } else if (op.capability === 'teaching.start') {
        if (!conn) throw new Error('Missing connection');
        const def = op.inputs.definition as WorkflowDefinition;
        const started = await startTeachingSession({
          tenantId,
          connectionId: conn.id,
          workflowId: op.workflowId ?? undefined,
          profileDir,
          allowedOrigins: origins,
          startUrl: String(
            conn.config.startUrl ?? def.steps.find((step) => step.action === 'goto')?.url ?? '',
          ),
        });
        output = { verified: true, status: started.status, startedAt: started.startedAt };
      } else if (op.capability === 'teaching.stop') {
        if (!conn || !op.workflowId) throw new Error('Missing teaching workflow');
        const stopped = await stopTeachingSession(tenantId, conn.id, op.workflowId);
        if (!stopped.steps.length)
          throw new HttpError(
            409,
            'NO_RECORDED_STEPS',
            'Kaydedilen işlem yok. Tarayıcıda örnek işi gerçekleştirin.',
          );
        await tenantDb(tenantId, async (db) => {
          const w = await one(
            db.select().from(s.workflows).where(eq(s.workflows.id, op.workflowId!)),
          );
          await db
            .update(s.workflows)
            .set({
              definition: { ...w.definition, steps: stopped.steps },
              version: w.version + 1,
              publishedDefinition: null,
              publishedVersion: null,
              status: 'awaiting_test',
            })
            .where(eq(s.workflows.id, w.id));
        });
        output = {
          verified: true,
          steps: stopped.steps,
          warnings: stopped.warnings,
          requiresReview: true,
        };
      } else if (op.capability === 'connection.test') {
        if (!conn) throw new Error('Missing connection');
        if (!conn.purpose.trim())
          throw new HttpError(
            409,
            'PURPOSE_REQUIRED',
            'Bağlantının işletmedeki amacını tanımlayın.',
          );
        if (conn.kind === 'browser') {
          if (conn.config.backoffice === true) {
            output = await executeBackofficeLogin(tenantId, conn);
            const promoted = await tenantDb(tenantId, (db) =>
              db
                .update(s.connections)
                .set({
                  status: 'ready',
                  lastError: null,
                  lastTestAt: new Date(),
                  realAccountVerified: true,
                })
                .where(
                  and(
                    eq(s.connections.id, conn.id),
                    sql`${s.connections.config}->>'loginRevision' = ${String(op.inputs.loginRevision)}`,
                    sql`${s.connections.status} <> 'disabled'`,
                  ),
                )
                .returning({ id: s.connections.id }),
            );
            if (!promoted.length)
              throw new HttpError(
                409,
                'LOGIN_CHANGED',
                'Sistem veya giriş bilgileri test sırasında değişti. Yeniden test edin.',
              );
          } else {
            const start = new URL(String(conn.config.startUrl));
            if (!origins.includes(start.origin))
              throw new HttpError(
                400,
                'ORIGIN_NOT_ALLOWED',
                'Giriş sitesi izinli adreslerde olmalı.',
              );
            const probe = await testBrowserConnection({
              profileDir,
              allowedOrigins: origins,
              startUrl: start.toString(),
              headless: true,
            });
            if (!probe.verified)
              throw new HttpError(
                409,
                'BROWSER_PROBE_FAILED',
                probe.error ?? 'Web sistemi erişilebilir değil.',
              );
            output = { verified: true, evidence: probe.evidence, liveAccount: false };
          }
        } else if (conn.kind === 'whatsapp') {
          if (conn.config.mode === 'demo' && isDemo())
            output = { verified: true, mode: 'demo', liveAccount: false };
          else
            throw new HttpError(
              409,
              'LINK_WHATSAPP',
              'Gerçek WhatsApp bağlantısını telefonunuzdan QR ile eşleştirin.',
            );
        } else if (conn.kind === 'gmail' || conn.kind === 'outlook')
          output = (await providers.testEmailConnection(
            conn.kind,
            conn.config,
            credential,
          )) as unknown as JsonObject;
        else if (conn.kind === 'google_calendar' || conn.kind === 'microsoft_calendar')
          output = (await providers.testCalendarConnection(
            conn.kind,
            conn.config,
            credential,
          )) as unknown as JsonObject;
        else if (conn.kind === 'mcp')
          output = (await providers.inspectMcpConnection(
            conn.config,
            credential,
          )) as unknown as JsonObject;
        else
          throw new HttpError(
            409,
            'PROVIDER_NOT_VERIFIED',
            'Bu sağlayıcı gerçek hesap veya cihaz doğrulaması bekliyor.',
          );
        if (output.verified !== true) throw new Error('Bağlantı doğrulanamadı.');
        if (conn.config.backoffice !== true)
          await tenantDb(tenantId, async (db) => {
            const current = await one(
              db.select().from(s.connections).where(eq(s.connections.id, conn.id)).for('update'),
            );
            const currentSecret = (
              await db
                .select()
                .from(s.secrets)
                .where(eq(s.secrets.connectionId, conn.id))
                .for('share')
            )[0];
            if (
              calendarConnectionRevision(current) !== op.inputs.connectionRevision ||
              currentSecret?.ciphertext !== claimed.ciphertext
            )
              throw new HttpError(
                409,
                'CONNECTION_CHANGED',
                'Sistem veya hesap test sırasında değişti. Yeniden test edin.',
              );
            await db
              .update(s.connections)
              .set({
                status: 'ready',
                lastError: null,
                lastTestAt: new Date(),
                realAccountVerified: conn.kind !== 'browser' && conn.config.mode !== 'demo',
                ...((conn.kind === 'gmail' || conn.kind === 'outlook') &&
                typeof output.account === 'string'
                  ? { config: { ...current.config, accountEmail: output.account } }
                  : {}),
              })
              .where(eq(s.connections.id, conn.id));
          });
      } else if (op.capability === 'email.send') {
        if (!conn || !['gmail', 'outlook'].includes(conn.kind))
          throw new Error('Email connection required');
        if (typeof conn.config.accountEmail !== 'string' || !conn.config.accountEmail)
          throw new HttpError(
            409,
            'EMAIL_ACCOUNT_REQUIRED',
            'Gönderici hesabını yeniden doğrulayın.',
          );
        const replyContext = await getEmailDraftReplyContext(tenantId, String(op.inputs.draftId));
        if (
          stableHash(replyContext) !==
          stableHash({
            ...(typeof op.inputs.threadId === 'string' ? { threadId: op.inputs.threadId } : {}),
            ...(typeof op.inputs.inReplyTo === 'string' ? { inReplyTo: op.inputs.inReplyTo } : {}),
            ...(typeof op.inputs.sourceMessageId === 'string'
              ? { sourceMessageId: op.inputs.sourceMessageId }
              : {}),
          })
        )
          throw new HttpError(409, 'EMAIL_SOURCE_CHANGED', 'Onaylanan e-posta zinciri değişti.');
        output = (await providers.sendEmail(
          conn.kind as 'gmail' | 'outlook',
          conn.config,
          credential,
          {
            to: String(op.inputs.to),
            subject: String(op.inputs.subject),
            body: String(op.inputs.body),
            reference: op.id,
            ...(typeof op.inputs.threadId === 'string' ? { threadId: op.inputs.threadId } : {}),
            ...(typeof op.inputs.inReplyTo === 'string' ? { inReplyTo: op.inputs.inReplyTo } : {}),
            ...(typeof op.inputs.sourceMessageId === 'string'
              ? { sourceMessageId: op.inputs.sourceMessageId }
              : {}),
          },
        )) as unknown as JsonObject;
      } else if (op.capability === 'calendar.read' || op.capability === 'calendar.create') {
        if (!conn || !['google_calendar', 'microsoft_calendar'].includes(conn.kind))
          throw new Error('Calendar connection required');
        const args = {
          start: String(op.inputs.start),
          end: String(op.inputs.end),
          timezone: config.timezone,
          duration: config.appointmentDuration,
          buffer: config.appointmentBuffer,
          hours: config.calendarHours,
        };
        output =
          op.capability === 'calendar.read'
            ? {
                verified: true,
                ...(await providers.getCalendarAvailability(
                  conn.kind as 'google_calendar' | 'microsoft_calendar',
                  conn.config,
                  credential,
                  args,
                )),
              }
            : ((await providers.createCalendarEvent(
                conn.kind as 'google_calendar' | 'microsoft_calendar',
                conn.config,
                credential,
                {
                  ...args,
                  title: String(op.inputs.title),
                  description: String(op.inputs.description ?? 'AfterHours tarafından yapıldı'),
                  reference: op.id,
                },
              )) as unknown as JsonObject);
      } else if (op.capability === 'calendar.update' || op.capability === 'calendar.cancel') {
        if (!conn || (conn.kind !== 'google_calendar' && conn.kind !== 'microsoft_calendar'))
          throw new HttpError(400, 'CALENDAR_REQUIRED', 'Takvim bağlantısı gerekli.');
        if (op.inputs.connectionRevision !== calendarConnectionRevision(conn))
          throw new HttpError(409, 'CONNECTION_CHANGED', 'Onaylanan takvim bağlantısı değişti.');
        const expected = op.inputs.expected as unknown as providers.CalendarEventSnapshot;
        output = (op.capability === 'calendar.cancel'
          ? await providers.cancelCalendarEvent(conn.kind, conn.config, credential, {
              eventId: String(op.inputs.eventId),
              expected,
              reference: op.id,
            })
          : await providers.updateCalendarEvent(conn.kind, conn.config, credential, {
              eventId: String(op.inputs.eventId),
              expected,
              reference: op.id,
              title: String(op.inputs.title),
              description: String(op.inputs.description ?? ''),
              start: String(op.inputs.start),
              end: String(op.inputs.end),
              timezone: config.timezone,
              duration: config.appointmentDuration,
              buffer: config.appointmentBuffer,
              hours: config.calendarHours,
            })) as unknown as JsonObject;
      } else if (op.capability.startsWith('mcp:')) {
        if (!conn || conn.kind !== 'mcp') throw new Error('MCP connection required');
        output = (await providers.executeMcpTool(conn.config, credential, {
          tool: String(op.inputs.tool),
          arguments: op.inputs.arguments as JsonObject,
          allowedTools: conn.permissions.filter((p) => p.startsWith('mcp:')).map((p) => p.slice(4)),
          reference: op.id,
        })) as unknown as JsonObject;
      } else if (op.capability === 'payment.link') {
        if (!config.paymentsEnabled || !conn || conn.kind !== 'stripe')
          throw new HttpError(403, 'PAYMENTS_DISABLED', 'Ödeme modülü kapalı.');
        const record = await tenantDb(tenantId, (db) =>
          one(
            db
              .select()
              .from(s.paymentRecords)
              .where(eq(s.paymentRecords.id, String(op.inputs.recordId))),
          ),
        );
        const terms = financialTerms(record, { recordId: op.inputs.recordId });
        const connectedAccount = String(conn.config.connectedAccount ?? '');
        if (!/^acct_[A-Za-z0-9]+$/.test(connectedAccount))
          throw new HttpError(
            409,
            'STRIPE_ACCOUNT_REQUIRED',
            'Onaylanmış işletme Stripe hesabı gerekli.',
          );
        const financial = {
          ...terms,
          connectedAccount: conn.config.connectedAccount,
          environment: conn.config.environment,
          externalRecordId: record.externalRecordId,
        };
        if (stableHash(financial) !== stableHash(op.inputs.financial))
          throw new HttpError(
            409,
            'PAYMENT_TERMS_CHANGED',
            'Onaydan sonra ödeme hesabı, tutarı veya para birimi değişmiş. Yeni bir onay özeti gerekiyor.',
          );
        output = (await providers.createPaymentLink(conn.config, credential, {
          connectedAccount,
          recordId: record.id,
          ...terms,
          reference: op.id,
        })) as unknown as JsonObject;
      } else throw new HttpError(400, 'UNKNOWN_CAPABILITY', 'İşlem yeteneği tanımlanmamış.');
    } catch (error) {
      providerFailed = true;
      throw error;
    } finally {
      if (conn && stableHash(credential) !== oldCredential) {
        try {
          if (!(await rotateConnectionSecret(tenantId, conn.id, oldCredential, credential)))
            throw new HttpError(
              409,
              'CREDENTIAL_CHANGED',
              'Hesap erişimi işlem sırasında değişti.',
            );
        } catch {
          await updateConnectionStatus(
            tenantId,
            conn.id,
            'needs_attention',
            'Yenilenen hesap erişimi güvenli depoya kaydedilemedi.',
            false,
          );
          await tenantDb(tenantId, (db) =>
            log(db, tenantId, system, 'credential.persistence_failed', conn.id, {
              operationId: op.id,
            }),
          );
          if (!providerFailed)
            throw new OutcomeUnknown(
              'Dış işlemden sonra hesap erişimi kaydedilemedi. Yeniden işlem yapmadan bağlantıyı inceleyin.',
            );
        }
      }
    }
    if (output.approvalRequired === true || output.pendingSteps === true) return;
    if (output.verified !== true) {
      await tenantDb(tenantId, async (db) => {
        await db
          .update(s.operations)
          .set({ result: redact(output) as JsonObject, updatedAt: new Date() })
          .where(eq(s.operations.id, op.id));
      });
      throw new OutcomeUnknown();
    }
    await tenantDb(tenantId, async (db) => {
      await db
        .update(s.operations)
        .set({
          status: 'succeeded',
          result: redact(output) as JsonObject,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(s.operations.id, op.id));
      if (op.capability === 'browser.trial')
        await db.update(s.trials).set({ verified: true }).where(eq(s.trials.operationId, op.id));
      if (op.cronId)
        await db
          .update(s.cronJobs)
          .set({ lastResult: 'succeeded', lastRunAt: new Date() })
          .where(
            and(
              eq(s.cronJobs.id, op.cronId),
              eq(s.cronJobs.version, Number(op.inputs.cronVersion ?? 1)),
            ),
          );
      if (op.capability === 'email.send')
        await db
          .update(s.drafts)
          .set({ status: 'sent', providerId: String(output.externalRecordId) })
          .where(eq(s.drafts.id, String(op.inputs.draftId)));
      if (op.capability === 'calendar.create' && conn)
        await db.insert(s.calendarEvents).values({
          tenantId,
          connectionId: conn.id,
          title: String(op.inputs.title),
          start: new Date(String(op.inputs.start)),
          end: new Date(String(op.inputs.end)),
          status: 'verified',
          providerId: String(output.externalRecordId),
        });
      if ((op.capability === 'calendar.update' || op.capability === 'calendar.cancel') && conn)
        await db
          .update(s.calendarEvents)
          .set(
            op.capability === 'calendar.cancel'
              ? { status: 'cancelled' }
              : {
                  title: String(op.inputs.title),
                  start: new Date(String(op.inputs.start)),
                  end: new Date(String(op.inputs.end)),
                  status: 'verified',
                },
          )
          .where(
            and(
              eq(s.calendarEvents.connectionId, conn.id),
              eq(s.calendarEvents.providerId, String(op.inputs.eventId)),
            ),
          );
      if (op.capability === 'payment.link')
        await db
          .update(s.paymentRecords)
          .set({
            status: 'link_created',
            paymentLink: String((output.evidence as JsonObject | undefined)?.url ?? ''),
            providerId: String(output.externalRecordId),
          })
          .where(eq(s.paymentRecords.id, String(op.inputs.recordId)));
      await log(db, tenantId, op.actor, 'operation.verified', op.id, {
        capability: op.capability,
        result: output,
        durationMs: Date.now() - (op.startedAt ?? new Date()).getTime(),
      });
      if (op.conversationId) {
        const c = await one(
          db.select().from(s.conversations).where(eq(s.conversations.id, op.conversationId)),
        );
        await db
          .update(s.conversations)
          .set({ requestState: 'completed', inputs: {} })
          .where(eq(s.conversations.id, c.id));
        if (c.mode === 'ai')
          await addReply(
            db,
            tenantId,
            c,
            `Talebinizi kaydettim ve oluşan kaydı doğruladım. Kayıt numaranız: ${String(output.externalRecordId)}.`,
            `success:${op.id}`,
          );
      }
    });
  } catch (error) {
    const op = await tenantDb(
      tenantId,
      async (db) =>
        (await db.select().from(s.operations).where(eq(s.operations.id, operationId)))[0],
    );
    if (
      op &&
      op.status === 'queued' &&
      error instanceof HttpError &&
      error.code === 'APPROVAL_REQUIRED'
    ) {
      await tenantDb(tenantId, async (db) => {
        await db
          .update(s.operations)
          .set({ status: 'awaiting_approval', requiresApproval: true, updatedAt: new Date() })
          .where(eq(s.operations.id, op.id));
        const pending = (
          await db
            .select()
            .from(s.approvals)
            .where(and(eq(s.approvals.operationId, op.id), eq(s.approvals.status, 'pending')))
        )[0];
        if (!pending)
          await db.insert(s.approvals).values({
            tenantId,
            kind: 'operation',
            operationId: op.id,
            title: 'İşlem güncel kurallara göre onay bekliyor',
            summary: JSON.stringify(
              redact({ capability: op.capability, inputs: op.inputs.values ?? op.inputs }),
            ),
            payload: { operationId: op.id },
            payloadHash: op.payloadHash,
            configVersion: op.configVersion,
          });
        await log(db, tenantId, system, 'operation.approval_required', op.id, {
          reason: 'Güncel bağlantı veya işletme kuralları admin onayı gerektiriyor.',
        });
      });
    } else if (op && op.status !== 'succeeded') await failOperation(tenantId, op, error);
  } finally {
    if (locked) await lockClient.query('select pg_advisory_unlock_all()');
    lockClient.release();
  }
}
async function failOperation(
  tenantId: string,
  op: typeof s.operations.$inferSelect,
  error: unknown,
) {
  const unknown =
    error instanceof OutcomeUnknown ||
    error instanceof providers.ExternalOutcomeUnknown ||
    (error instanceof Error &&
      /unknown|uncertain|verification|missing_element|profile_busy/.test(
        (error as Error & { code?: string }).code ?? error.name,
      ));
  const safeMessage =
    error instanceof HttpError ||
    error instanceof OutcomeUnknown ||
    error instanceof providers.ProviderError ||
    error instanceof providers.ExternalOutcomeUnknown
      ? error.message
      : 'İşlem tamamlanamadı. Dış sonuç ve bağlantı durumu panelden incelenmeli.';
  const status = unknown ? 'needs_attention' : 'failed';
  await tenantDb(tenantId, async (db) => {
    await db
      .update(s.operations)
      .set({ status, error: safeMessage, updatedAt: new Date() })
      .where(eq(s.operations.id, op.id));
    if (op.capability === 'connection.test' && op.connectionId) {
      const current = (
        await db
          .select()
          .from(s.connections)
          .where(eq(s.connections.id, op.connectionId))
          .for('update')
      )[0];
      const credential = (
        await db
          .select()
          .from(s.secrets)
          .where(eq(s.secrets.connectionId, op.connectionId))
          .for('share')
      )[0];
      const conditions = [eq(s.connections.id, op.connectionId)];
      if (op.inputs.backoffice === true)
        conditions.push(
          sql`${s.connections.config}->>'loginRevision' = ${String(op.inputs.loginRevision)}`,
          sql`${s.connections.status} <> 'disabled'`,
        );
      if (
        current &&
        current.status !== 'disabled' &&
        calendarConnectionRevision(current) === op.inputs.connectionRevision &&
        stableHash(credential?.ciphertext ?? null) === op.inputs.credentialRevision
      )
        await db
          .update(s.connections)
          .set({
            status: op.inputs.backoffice === true ? 'login_failed' : 'needs_attention',
            lastError: safeMessage,
            realAccountVerified: false,
          })
          .where(and(...conditions));
    }
    if (op.capability === 'workflow.text.test' && op.workflowId)
      await db
        .update(s.workflows)
        .set({ status: 'awaiting_test', enabled: false, planningError: safeMessage })
        .where(
          and(
            eq(s.workflows.id, op.workflowId),
            eq(s.workflows.version, Number(op.inputs.workflowVersion)),
          ),
        );
    if (op.cronId)
      await db
        .update(s.cronJobs)
        .set({ lastResult: status, lastRunAt: new Date() })
        .where(
          and(
            eq(s.cronJobs.id, op.cronId),
            eq(s.cronJobs.version, Number(op.inputs.cronVersion ?? 1)),
          ),
        );
    if (op.capability === 'email.send')
      await db
        .update(s.drafts)
        .set({ status })
        .where(eq(s.drafts.id, String(op.inputs.draftId)));
    if (op.conversationId) {
      const c = await one(
        db.select().from(s.conversations).where(eq(s.conversations.id, op.conversationId)),
      );
      await handoff(db, tenantId, c, safeMessage, op.id);
      await addReply(
        db,
        tenantId,
        c,
        'İşleminizi tamamlandığına dair doğrulayamıyorum. Durumu ekibe ilettim; mevcut kayıt kontrol edilmeden tekrar işlem yapılmayacak.',
        `failure:${op.id}`,
      );
    } else
      await db.insert(s.handoffs).values({ tenantId, operationId: op.id, reason: safeMessage });
    await log(db, tenantId, op.actor, 'operation.failed', op.id, {
      capability: op.capability,
      status,
      error: safeMessage,
      ...(op.result ? { result: op.result } : {}),
    });
  });
}

export async function tickSchedules() {
  for (const tenant of await allTenants()) {
    const queued: string[] = [];
    await tenantDb(tenant.id, async (db) => {
      if (
        !(
          await db.execute(
            sql`select pg_try_advisory_xact_lock(hashtextextended(${tenant.id + ':schedules'},0)) as locked`,
          )
        ).rows[0]?.locked
      )
        return;
      for (const cron of await db
        .select()
        .from(s.cronJobs)
        .where(and(eq(s.cronJobs.enabled, true), isNull(s.cronJobs.deletedAt)))) {
        const active =
          (
            await db
              .select()
              .from(s.operations)
              .where(
                and(
                  eq(s.operations.cronId, cron.id),
                  inArray(s.operations.status, [
                    'queued',
                    'running',
                    'verifying',
                    'awaiting_approval',
                    'needs_attention',
                  ]),
                ),
              )
          ).length > 0;
        const decision = decideSchedule({
          expression: cron.expression,
          timezone: cron.timezone,
          scheduledAt: cron.nextRunAt,
          running: active,
        });
        if (!cron.nextRunAt || cron.nextRunAt <= new Date())
          await db
            .update(s.cronJobs)
            .set({
              nextRunAt: decision.nextRunAt,
              ...(decision.missed ? { lastResult: 'missed' } : {}),
            })
            .where(eq(s.cronJobs.id, cron.id));
        if (decision.missed)
          await log(db, tenant.id, system, 'cron.missed', cron.id, {
            scheduledAt: cron.nextRunAt?.toISOString(),
            catchUp: false,
          });
        if (!decision.due || !decision.runAt) continue;
        try {
          const w = await one(
            db.select().from(s.workflows).where(eq(s.workflows.id, cron.workflowId)),
          );
          if (
            w.status !== 'ready' ||
            (w.mode === 'text' ? !w.enabled || !w.compiledPlan : !w.publishedDefinition)
          )
            throw new HttpError(
              409,
              'WORKFLOW_NOT_READY',
              'Görevin kullandığı iş doğrulanmış ve etkin değil.',
            );
          const text = w.mode === 'text';
          const inputs: JsonObject = {
            workflowVersion: w.publishedVersion,
            cronVersion: cron.version,
            trigger: 'scheduled',
            ...(text
              ? { textSnapshot: w.sourceText, systemIds: w.systemIds, compiledPlan: w.compiledPlan }
              : { definition: w.publishedDefinition, values: cron.inputs }),
          };
          const planWrites =
            text &&
            Array.isArray(w.compiledPlan?.systems) &&
            w.compiledPlan.systems.some(
              (step: unknown) =>
                !!step &&
                typeof step === 'object' &&
                'plan' in step &&
                !!step.plan &&
                typeof step.plan === 'object' &&
                'kind' in step.plan &&
                step.plan.kind === 'write',
            );
          const op = await createOperation(
            db,
            workerContext(tenant.id, { type: 'cron', id: cron.id }),
            {
              capability: text ? 'workflow.text.execute' : 'browser.execute',
              connectionId:
                text && w.compiledPlan?.version === 2 ? undefined : (w.connectionId ?? undefined),
              workflowId: w.id,
              cronId: cron.id,
              inputs,
              idempotencyKey: `cron:${cron.id}:${decision.runAt.toISOString()}`,
              requiresApproval:
                text && w.compiledPlan?.version === 2
                  ? false
                  : planWrites || w.publishedDefinition?.requiresApproval || false,
            },
          );
          queued.push(op.id);
        } catch (error) {
          const reason = error instanceof HttpError ? error.message : 'Görev başlatılamadı.';
          await db
            .update(s.cronJobs)
            .set({ lastResult: 'blocked' })
            .where(eq(s.cronJobs.id, cron.id));
          await db.insert(s.handoffs).values({ tenantId: tenant.id, reason });
          await log(db, tenant.id, system, 'cron.blocked', cron.id, { reason });
        }
      }
    });
    for (const operationId of queued)
      await enqueue('afterhours.operation', { tenantId: tenant.id, operationId });
  }
}

export async function tickOutbox(
  deliver: (
    tenantId: string,
    connectionId: string,
    address: string,
    body: string,
  ) => Promise<string>,
) {
  for (const tenant of await allTenants()) {
    const pending = await tenantDb(tenant.id, (db) =>
      db
        .select()
        .from(s.messages)
        .where(
          and(
            eq(s.messages.direction, 'outbound'),
            inArray(s.messages.status, ['pending', 'retry']),
            lt(s.messages.availableAt, new Date()),
          ),
        )
        .orderBy(asc(s.messages.createdAt))
        .limit(20),
    );
    for (const m of pending) {
      const client = await getPool().connect();
      let locked = false;
      try {
        locked =
          (
            await client.query<{ locked: boolean }>(
              'select pg_try_advisory_lock(hashtextextended($1,0)) as locked',
              [`outbox:${tenant.id}:${m.id}`],
            )
          ).rows[0]?.locked === true;
        if (!locked) continue;
        const claimed = await tenantDb(tenant.id, async (db) => {
          const row = await one(db.select().from(s.messages).where(eq(s.messages.id, m.id)));
          if (!['pending', 'retry'].includes(row.status)) return null;
          const c = await one(
            db.select().from(s.conversations).where(eq(s.conversations.id, row.conversationId)),
          );
          const isStaff = row.externalId.startsWith('staff:');
          const isHandoff =
            row.externalId.startsWith('failure:') || row.externalId.startsWith('handoff:');
          if (
            !isStaff &&
            ((c.mode === 'human' && !isHandoff) || !isActive(await currentConfig(db)))
          ) {
            await db
              .update(s.messages)
              .set({ status: 'cancelled' })
              .where(eq(s.messages.id, row.id));
            return null;
          }
          const conn = await one(
            db.select().from(s.connections).where(eq(s.connections.id, row.connectionId)),
          );
          if (conn.status === 'disabled') {
            await db
              .update(s.messages)
              .set({ status: 'cancelled' })
              .where(eq(s.messages.id, row.id));
            return null;
          }
          let sendingActor: Actor = { type: 'customer', id: c.id };
          if (isStaff) {
            const member = (
              await getAuthDb()
                .select()
                .from(s.memberships)
                .where(
                  and(
                    eq(s.memberships.tenantId, tenant.id),
                    eq(s.memberships.userId, row.externalId.split(':')[1] ?? ''),
                  ),
                )
            )[0];
            if (!member || !['admin', 'staff'].includes(member.role))
              throw new HttpError(403, 'MEMBERSHIP_REVOKED', 'Personelin erişimi kaldırılmış.');
            sendingActor = { type: member.role as 'admin' | 'staff', id: member.userId };
          }
          authorizeConnection(connectionView(conn), sendingActor, 'message.send');
          await db
            .update(s.messages)
            .set({ status: 'sending', attempts: row.attempts + 1, availableAt: new Date() })
            .where(eq(s.messages.id, row.id));
          return { row, c, conn };
        });
        if (!claimed) continue;
        const providerId =
          claimed.c.channel === 'demo'
            ? `demo:${m.id}`
            : await deliver(tenant.id, m.connectionId, claimed.c.customerAddress, m.body);
        await tenantDb(tenant.id, async (db) => {
          await db
            .update(s.messages)
            .set({
              status: claimed.c.channel === 'demo' ? 'demo_delivered' : 'provider_accepted',
              providerId,
              error: null,
            })
            .where(eq(s.messages.id, m.id));
          await log(db, tenant.id, system, 'message.provider_accepted', m.id, {
            providerId,
            demo: claimed.c.channel === 'demo',
          });
        });
      } catch (error) {
        const safeRetry = !!(
            error &&
            typeof error === 'object' &&
            'safeToRetry' in error &&
            error.safeToRetry === true
          ),
          retry = safeRetry && m.attempts + 1 < 4;
        await tenantDb(tenant.id, async (db) => {
          await db
            .update(s.messages)
            .set({
              status: retry ? 'retry' : 'needs_attention',
              error: retry
                ? 'Kanal bağlı değil. Tekrar denenecek.'
                : 'Gönderim sonucu belirsiz veya başarısız. Personel kontrolü gerekli.',
              availableAt: new Date(Date.now() + Math.min(300000, 5000 * 2 ** m.attempts)),
            })
            .where(eq(s.messages.id, m.id));
          await log(db, tenant.id, system, 'message.delivery_failed', m.id, {
            retry,
            attempt: m.attempts + 1,
          });
          if (!retry) {
            const c = await one(
              db.select().from(s.conversations).where(eq(s.conversations.id, m.conversationId)),
            );
            await handoff(db, tenant.id, c, 'Müşteri mesajının gönderimi doğrulanamadı.');
          }
        });
      } finally {
        if (locked) await client.query('select pg_advisory_unlock_all()');
        client.release();
      }
    }
  }
}
export async function updateWhatsAppDelivery(
  tenantId: string,
  connectionId: string,
  providerId: string,
  status: 'delivered' | 'read',
) {
  await tenantDb(tenantId, async (db) => {
    const m = (
      await db
        .select()
        .from(s.messages)
        .where(
          and(eq(s.messages.connectionId, connectionId), eq(s.messages.providerId, providerId)),
        )
    )[0];
    if (!m || m.status === 'read') return;
    await db.update(s.messages).set({ status }).where(eq(s.messages.id, m.id));
    await log(db, tenantId, system, 'message.receipt', m.id, { status });
  });
}
export async function heartbeat() {
  for (const tenant of await allTenants())
    await tenantDb(tenant.id, (db) =>
      db
        .insert(s.runtime)
        .values({ tenantId: tenant.id, key: 'worker.heartbeat', value: { pid: process.pid } })
        .onConflictDoUpdate({
          target: [s.runtime.tenantId, s.runtime.key],
          set: { updatedAt: new Date(), value: { pid: process.pid } },
        }),
    );
}
export async function getPendingWork() {
  const operations: Array<{ tenantId: string; operationId: string }> = [],
    conversations: Array<{ tenantId: string; conversationId: string }> = [];
  for (const tenant of await allTenants())
    await tenantDb(tenant.id, async (db) => {
      for (const op of await db
        .select()
        .from(s.operations)
        .where(inArray(s.operations.status, ['queued', 'running', 'verifying']))
        .limit(50))
        operations.push({ tenantId: tenant.id, operationId: op.id });
      for (const c of await db
        .select()
        .from(s.conversations)
        .where(
          and(
            eq(s.conversations.mode, 'ai'),
            sql`${s.conversations.channel} NOT IN ('email','gmail','outlook')`,
            sql`(select m.id from ${s.messages} m where m.tenant_id = ${s.conversations.tenantId} and m.conversation_id = ${s.conversations.id} and m.direction = 'inbound' order by m.created_at desc, m.id desc limit 1) is distinct from ${s.conversations.lastProcessedId}`,
          ),
        )
        .orderBy(asc(s.conversations.updatedAt))
        .limit(50))
        conversations.push({ tenantId: tenant.id, conversationId: c.id });
      const lost = await db
        .select()
        .from(s.messages)
        .where(
          and(
            eq(s.messages.status, 'sending'),
            lt(s.messages.availableAt, new Date(Date.now() - 90000)),
          ),
        );
      for (const m of lost) {
        if (
          !(
            await db.execute(
              sql`select pg_try_advisory_xact_lock(hashtextextended(${'outbox:' + tenant.id + ':' + m.id},0)) as locked`,
            )
          ).rows[0]?.locked
        )
          continue;
        const recovered = await db
          .update(s.messages)
          .set({
            status: 'needs_attention',
            error: 'Worker kesintisinde gönderim sonucu belirsiz kaldı. Yeniden gönderilmedi.',
          })
          .where(and(eq(s.messages.id, m.id), eq(s.messages.status, 'sending')))
          .returning({ id: s.messages.id });
        if (!recovered.length) continue;
        const c = await one(
          db.select().from(s.conversations).where(eq(s.conversations.id, m.conversationId)),
        );
        await handoff(db, tenant.id, c, 'Gönderim sonucu worker kesintisi nedeniyle incelenmeli.');
      }
    });
  return { operations, conversations };
}
export function getCoreApi(): CoreApi {
  return {
    receiveMessage,
    executeOperation,
    processConversation,
    tickSchedules,
    tickOutbox,
    heartbeat,
    tenants: allTenants,
  };
}
