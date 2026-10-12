import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z, ZodError } from 'zod';
import { tenantDb, enqueue, type TenantDb } from './db.js';
import * as s from './schema.js';
import { emailMessages, emailDraftSources } from './email-schema.js';
import { assertMembership } from './context.js';
import { requireAdmin, HttpError } from './errors.js';
import { currentConfig, log, connectionView } from './store.js';
import {
  authorizeConnection,
  canonicalCapability,
  configPatchSchema,
  financialTerms,
  validateWorkflowInputs,
  workflowSchema,
} from './policy.js';
import { assertPublicConfig, stableHash, writeConnectionSecret } from './security.js';
import { nextRunAt, validateCron } from './scheduling.js';
import { isDemo } from './env.js';
import { handleManagementMessage, applyManagementPlan } from './management.js';
import { calendarConnectionRevision, handleCalendarMutation } from './calendar-commands.js';
import { receiveMessage } from './runtime.js';
import { handleContextCommand } from './context-materials.js';
import { handleProviderCommand } from './ai-providers.js';
import { handleBackofficeCommand } from './backoffice.js';
import { handleTextWorkflowCommand } from './text-workflows.js';
import { handleChannelSetupCommand } from './channel-setup.js';
import { assessPhoneLink } from './phone-link.js';
import {
  analyzeWorkflowQuestions,
  handleWorkflowClarificationCommand,
} from './workflow-clarifications.js';
import type {
  Actor,
  CommandResult,
  JsonObject,
  TenantContext,
  WorkflowDefinition,
} from './types.js';

const id = z.string().uuid(),
  str = z.string().trim().min(1).max(8000),
  json = z.record(z.string(), z.unknown());
const kind = z.enum([
  'browser',
  'whatsapp',
  'gmail',
  'outlook',
  'google_calendar',
  'microsoft_calendar',
  'mcp',
  'voice_whatsapp',
  'voice_phone',
  'sms',
  'ivr',
]);
const actor = z.enum(['admin', 'staff', 'customer', 'cron']);
const connectionInput = z
  .object({
    name: str,
    purpose: str,
    kind,
    config: json.default({}),
    permissions: z.array(z.string().max(120)).max(100).default([]),
    agents: z.array(actor).max(4).default(['admin']),
  })
  .strict();
const result = (message: string, data?: JsonObject): CommandResult => ({
  message,
  ...(data ? { data } : {}),
});
function assertGenericConnectionConfig(config: JsonObject, existing: JsonObject = {}) {
  if (
    [
      'mcpSetup',
      'setupRevision',
      'readOnlyTools',
      'discoveredTools',
      'lastDiscovery',
      'backoffice',
      'guidedSetup',
      'provider',
    ].some((key) => {
      const incoming = Object.hasOwn(config, key),
        saved = Object.hasOwn(existing, key);
      return (
        incoming !== saved || (incoming && stableHash(config[key]) !== stableHash(existing[key]))
      );
    })
  )
    throw new HttpError(
      409,
      'DEDICATED_SETUP_REQUIRED',
      'Bu sistemin kurulumunu ilgili Backoffice Systems veya Front Desk Channels ekranından yapın.',
    );
  noCredentialsInConfig(config);
}
export async function one<T>(rows: Promise<T[]>, label = 'Kayıt'): Promise<T> {
  const row = (await rows)[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', `${label} bu işletmede bulunamadı.`);
  return row;
}

export async function createOperation(
  db: TenantDb,
  ctx: TenantContext,
  args: {
    capability: string;
    connectionId?: string;
    workflowId?: string;
    conversationId?: string;
    cronId?: string;
    inputs: JsonObject;
    idempotencyKey: string;
    actor?: Actor;
    requiresApproval?: boolean;
  },
) {
  if (args.capability.startsWith('payment.'))
    throw new HttpError(
      410,
      'PAYMENTS_REMOVED',
      'Ödeme modülü kaldırıldı. Müşteriyi işletmenin e-ticaret sayfasına yönlendirin.',
    );
  const config = await currentConfig(db),
    operationActor = args.actor ?? ctx.actor;
  let connectionApproval = false;
  if (args.connectionId) {
    const conn = await one(
      db.select().from(s.connections).where(eq(s.connections.id, args.connectionId)),
      'Bağlantı',
    );
    if (args.capability !== 'connection.test')
      authorizeConnection(
        connectionView(conn),
        operationActor,
        canonicalCapability(args.capability),
        { testing: args.capability.startsWith('teaching.') || args.capability === 'browser.trial' },
      );
    args = {
      ...args,
      inputs: { ...args.inputs, connectionRevision: calendarConnectionRevision(conn) },
    };
    if (args.capability === 'connection.test') {
      const secret = (
        await db.select().from(s.secrets).where(eq(s.secrets.connectionId, conn.id))
      )[0];
      args = {
        ...args,
        inputs: { ...args.inputs, credentialRevision: stableHash(secret?.ciphertext ?? null) },
      };
    }
    connectionApproval =
      Array.isArray(conn.config.requireApproval) &&
      conn.config.requireApproval.includes(canonicalCapability(args.capability));
  }
  const hash = stableHash({
    capability: args.capability,
    inputs: args.inputs,
    actor: operationActor,
    connectionId: args.connectionId,
    configVersion: config.version,
  });
  const existing = (
    await db.select().from(s.operations).where(eq(s.operations.idempotencyKey, args.idempotencyKey))
  )[0];
  if (existing) {
    if (existing.payloadHash !== hash)
      throw new HttpError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Aynı işlem anahtarı farklı girdilerle kullanılamaz.',
      );
    return existing;
  }
  const needsApproval =
    args.capability === 'calendar.cancel' ||
    !!args.requiresApproval ||
    connectionApproval ||
    (!(args.capability.startsWith('workflow.text.') && !args.connectionId) &&
      config.requireApproval.includes(canonicalCapability(args.capability)));
  const op = await one(
    db
      .insert(s.operations)
      .values({
        tenantId: ctx.tenantId,
        capability: args.capability,
        actor: operationActor,
        connectionId: args.connectionId,
        workflowId: args.workflowId,
        conversationId: args.conversationId,
        cronId: args.cronId,
        inputs: args.inputs,
        idempotencyKey: args.idempotencyKey,
        payloadHash: hash,
        configVersion: config.version,
        requiresApproval: needsApproval,
        status: needsApproval ? 'awaiting_approval' : 'queued',
      })
      .returning(),
  );
  if (needsApproval)
    await db.insert(s.approvals).values({
      tenantId: ctx.tenantId,
      kind: 'operation',
      title: `${args.capability} için onay`,
      summary: `İşlem: ${args.capability}. Girdiler: ${JSON.stringify(args.inputs)}. Onay bu girdiler ve ayar sürümü ${config.version} için geçerli.`,
      operationId: op.id,
      payload: { capability: args.capability, inputs: args.inputs },
      payloadHash: hash,
      configVersion: config.version,
    });
  await log(db, ctx.tenantId, operationActor, 'operation.created', op.id, {
    capability: op.capability,
    status: op.status,
    connectionId: args.connectionId ?? null,
    configVersion: config.version,
  });
  return op;
}

async function saveConfig(
  db: TenantDb,
  ctx: TenantContext,
  baseVersion: number,
  patch: JsonObject,
  approved = false,
) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':config'},0))`,
  );
  const current = await currentConfig(db);
  if (baseVersion !== current.version)
    throw new HttpError(
      409,
      'STALE_CONFIGURATION',
      'Ayarlar değişmiş. Güncel ayarları inceleyip tekrar deneyin.',
    );
  const clean = configPatchSchema.parse(patch);
  if (clean.paymentsEnabled === true)
    throw new HttpError(410, 'PAYMENTS_REMOVED', 'Ödeme modülü kaldırıldı.');
  const next = { ...current, ...clean, version: current.version + 1 };
  if (next.automationEnabled && !next.activeHours.length)
    throw new HttpError(
      409,
      'ACTIVE_HOURS_REQUIRED',
      'Otomatik iletişimi açmadan önce aktif saatleri tanımlayın.',
    );
  const risky = clean.requireApproval !== undefined;
  if (risky && !approved) {
    const proposal = await one(
      db
        .insert(s.proposals)
        .values({
          tenantId: ctx.tenantId,
          summary: `Ayar değişikliği: ${JSON.stringify(clean)}`,
          baseVersion: current.version,
          patch: clean,
          risk: 'admin_approval',
        })
        .returning(),
    );
    const approval = await one(
      db
        .insert(s.approvals)
        .values({
          tenantId: ctx.tenantId,
          kind: 'configuration',
          title: 'Yetki veya finansal ayar değişikliği',
          summary: proposal.summary,
          payload: { proposalId: proposal.id, patch: clean },
          payloadHash: stableHash(clean),
          configVersion: current.version,
        })
        .returning(),
    );
    await db
      .update(s.proposals)
      .set({ approvalId: approval.id })
      .where(eq(s.proposals.id, proposal.id));
    await log(db, ctx.tenantId, ctx.actor, 'configuration.proposed', proposal.id, {
      baseVersion,
      patch: clean,
    });
    return result('Değişiklik özeti onaylar alanına eklendi.', { proposalId: proposal.id });
  }
  await db
    .insert(s.configurations)
    .values({ tenantId: ctx.tenantId, version: next.version, value: next });
  await log(db, ctx.tenantId, ctx.actor, 'configuration.updated', null, {
    baseVersion,
    version: next.version,
    patch: clean,
  });
  return result('İşletme ayarları kaydedildi. Sonraki işlemler güncel ayarları kullanacak.', {
    version: next.version,
  });
}
function noCredentialsInConfig(config: JsonObject) {
  try {
    assertPublicConfig(config);
  } catch {
    throw new HttpError(
      400,
      'SECRET_IN_CONFIG',
      'Anahtarları bağlantının güvenli kimlik bilgileri alanına girin. Bağlantı adreslerine kimlik bilgisi eklenemez.',
    );
  }
}

export async function runCommand(
  ctx: TenantContext,
  action: string,
  payload: unknown,
  beforeMutation?: (db: import('./db.js').TenantDb) => Promise<void>,
): Promise<CommandResult> {
  await assertMembership(ctx);
  try {
    if (action.startsWith('payment.'))
      throw new HttpError(
        410,
        'PAYMENTS_REMOVED',
        'Ödeme modülü kaldırıldı. Müşteriyi işletmenin e-ticaret sayfasına yönlendirin.',
      );
    if (action === 'management.message') return await handleManagementMessage(ctx, payload);
    if (action === 'proposal.apply') {
      const p = z.object({ id }).strict().parse(payload);
      const managed = await applyManagementPlan(ctx, p.id);
      if (managed) return managed;
    }
    if (action === 'calendar.update' || action === 'calendar.cancel') {
      const response = await handleCalendarMutation(ctx, action, payload, beforeMutation);
      if (typeof response.data?.operationId === 'string')
        await enqueue('afterhours.operation', {
          tenantId: ctx.tenantId,
          operationId: response.data.operationId,
        });
      return response;
    }
    if (action.startsWith('context.'))
      return await handleContextCommand(ctx, action, payload, beforeMutation);
    if (action.startsWith('provider.')) return await handleProviderCommand(ctx, action, payload);
    if (action.startsWith('channel.setup.') || action === 'channel.oauth.start')
      return await handleChannelSetupCommand(ctx, action, payload, beforeMutation);
    if (action === 'voice.assess') {
      requireAdmin(ctx.role);
      z.object({}).strict().parse(payload);
      const assessment = await assessPhoneLink();
      await assertMembership(ctx);
      await tenantDb(ctx.tenantId, async (db) => {
        await log(db, ctx.tenantId, ctx.actor, 'voice.readiness_requested', null, {
          verified: false,
          usb: assessment.usb.state,
          bluetooth: assessment.bluetooth.state,
          connectedIphoneCount: assessment.bluetooth.connectedIphoneCount,
          callAudioAvailable: false,
        });
      });
      return result(
        'Mac cihaz kontrolü tamamlandı. Bluetooth/USB tespiti arama sesine erişimi doğrulamaz; otomatik görüşme henüz hazır değil.',
        { ...assessment },
      );
    }
    if (action.startsWith('workflow.questions.'))
      return await handleWorkflowClarificationCommand(ctx, action, payload, beforeMutation);
    if (action.startsWith('backoffice.') || action.startsWith('workflow.text.')) {
      const response = action.startsWith('backoffice.')
        ? await handleBackofficeCommand(ctx, action, payload, beforeMutation)
        : await handleTextWorkflowCommand(ctx, action, payload, beforeMutation);
      if (action === 'workflow.text.save' && typeof response.data?.id === 'string')
        await analyzeWorkflowQuestions(ctx, response.data.id);
      if (typeof response.data?.operationId === 'string')
        await enqueue('afterhours.operation', {
          tenantId: ctx.tenantId,
          operationId: response.data.operationId,
        });
      return response;
    }
    if (action === 'demo.incoming') {
      requireAdmin(ctx.role);
      if (!isDemo())
        throw new HttpError(
          403,
          'DEMO_DISABLED',
          'Test kanalı yalnızca demo ortamında kullanılabilir.',
        );
      const p = z
        .object({
          body: str,
          address: z.string().max(100).default('demo-customer'),
          name: z.string().max(100).default('Deniz Kaya'),
          externalId: z.string().max(100).optional(),
        })
        .strict()
        .parse(payload);
      const conn = await tenantDb(ctx.tenantId, (db) =>
        one(
          db
            .select()
            .from(s.connections)
            .where(
              and(
                eq(s.connections.kind, 'whatsapp'),
                sql`${s.connections.config}->>'mode' = 'demo'`,
              ),
            ),
        ),
      );
      const received = await receiveMessage(ctx.tenantId, {
        connectionId: conn.id,
        body: p.body,
        address: p.address,
        name: p.name,
        externalId: p.externalId ?? randomUUID(),
        channel: 'demo',
      });
      return result(
        received.duplicate
          ? 'Bu mesaj daha önce alındı.'
          : 'Test mesajı gelen kutusuna kaydedildi.',
        received,
      );
    }
    if (action === 'connection.secret') {
      requireAdmin(ctx.role);
      const p = z.object({ id, secrets: json }).strict().parse(payload);
      const target = await tenantDb(ctx.tenantId, (db) =>
        one(db.select().from(s.connections).where(eq(s.connections.id, p.id))),
      );
      if (
        target.config.backoffice === true ||
        target.config.mcpSetup === true ||
        target.kind === 'ai_provider'
      )
        throw new HttpError(
          409,
          'DEDICATED_SETUP_REQUIRED',
          'Giriş bilgilerini ilgili Backoffice Systems veya AI Providers ekranından güncelleyin.',
        );
      await writeConnectionSecret(ctx.tenantId, p.id, p.secrets);
      await tenantDb(ctx.tenantId, async (db) => {
        await db
          .update(s.connections)
          .set({ status: 'awaiting_test', realAccountVerified: false })
          .where(eq(s.connections.id, p.id));
        await log(db, ctx.tenantId, ctx.actor, 'connection.credentials_updated', p.id, {
          stored: true,
        });
      });
      return result('Kimlik bilgileri şifreli kaydedildi. Bağlantıyı test edin.');
    }
    const response = await tenantDb(ctx.tenantId, async (db) => {
      if (action.startsWith('cron.'))
        await db.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':schedules'},0))`,
        );
      if (beforeMutation) await beforeMutation(db);
      const config = await currentConfig(db);
      if (action === 'conversation.handoff' || action === 'conversation.resume') {
        const p = z
          .object({ id, reason: z.string().max(1000).optional() })
          .strict()
          .parse(payload);
        await one(db.select().from(s.conversations).where(eq(s.conversations.id, p.id)));
        await db
          .update(s.conversations)
          .set({ mode: action === 'conversation.resume' ? 'ai' : 'human', updatedAt: new Date() })
          .where(eq(s.conversations.id, p.id));
        if (action === 'conversation.handoff')
          await db.insert(s.handoffs).values({
            tenantId: ctx.tenantId,
            conversationId: p.id,
            reason: p.reason ?? 'Personel konuşmayı devraldı.',
          });
        else
          await db
            .update(s.handoffs)
            .set({ status: 'resolved' })
            .where(eq(s.handoffs.conversationId, p.id));
        await log(db, ctx.tenantId, ctx.actor, action, p.id, { reason: p.reason ?? null });
        return result(
          action === 'conversation.resume'
            ? 'Kontrol AI’a geri verildi. Yeni müşteri mesajında devam edecek.'
            : 'Konuşma personele devredildi. Otomatik yanıtlar durdu.',
        );
      }
      if (action === 'conversation.reply') {
        const p = z.object({ id, body: str }).strict().parse(payload),
          c = await one(db.select().from(s.conversations).where(eq(s.conversations.id, p.id)));
        if (['email', 'gmail', 'outlook'].includes(c.channel))
          throw new HttpError(
            409,
            'EMAIL_DRAFT_REQUIRED',
            'E-posta yanıtını Email ekranında taslak olarak hazırlayın.',
          );
        if (c.mode !== 'human')
          throw new HttpError(409, 'TAKE_OVER_FIRST', 'Mesaj göndermeden önce konuşmayı devralın.');
        const channel = await one(
          db.select().from(s.connections).where(eq(s.connections.id, c.connectionId)),
        );
        authorizeConnection(connectionView(channel), ctx.actor, 'message.send');
        await db.insert(s.messages).values({
          tenantId: ctx.tenantId,
          conversationId: c.id,
          connectionId: c.connectionId,
          externalId: `staff:${ctx.actor.id}:${randomUUID()}`,
          direction: 'outbound',
          body: p.body,
          status: 'pending',
        });
        await log(db, ctx.tenantId, ctx.actor, 'message.prepared', c.id, { sender: 'staff' });
        return result('Personel mesajı gönderim kuyruğuna alındı.');
      }
      if (action === 'workflow.save') {
        const p = z
            .object({ id: id.optional(), definition: workflowSchema })
            .strict()
            .parse(payload),
          d = p.definition;
        const c = await one(
          db.select().from(s.connections).where(eq(s.connections.id, d.connectionId)),
        );
        if (c.kind !== 'browser')
          throw new HttpError(400, 'BROWSER_REQUIRED', 'Öğretim için tarayıcı bağlantısı gerekli.');
        authorizeConnection(connectionView(c), ctx.actor, 'teaching.record', { testing: true });
        let wid = p.id;
        if (wid) {
          const old = await one(db.select().from(s.workflows).where(eq(s.workflows.id, wid)));
          if (old.definition.requiresApproval && !d.requiresApproval) requireAdmin(ctx.role);
          await db
            .update(s.workflows)
            .set({
              name: d.name,
              purpose: d.purpose,
              connectionId: d.connectionId,
              definition: d,
              version: old.version + 1,
              status: 'awaiting_test',
              publishedVersion: null,
              publishedDefinition: null,
            })
            .where(eq(s.workflows.id, wid));
        } else
          wid = (
            await one(
              db
                .insert(s.workflows)
                .values({
                  tenantId: ctx.tenantId,
                  name: d.name,
                  purpose: d.purpose,
                  connectionId: d.connectionId,
                  definition: d,
                })
                .returning(),
            )
          ).id;
        await log(db, ctx.tenantId, ctx.actor, 'workflow.saved', wid, {
          name: d.name,
          permissionsGranted: false,
        });
        return result(
          'Taslak kaydedildi. Yayınlamak için bu sürümle üç farklı doğrulanmış deneme gerekiyor.',
          { id: wid },
        );
      }
      if (action === 'workflow.record' || action === 'workflow.trial') {
        const p =
          action === 'workflow.record'
            ? z
                .object({ id, command: z.enum(['start', 'stop']) })
                .strict()
                .parse(payload)
            : z.object({ id, inputs: json }).strict().parse(payload);
        const w = await one(db.select().from(s.workflows).where(eq(s.workflows.id, p.id)));
        if (w.mode === 'text' || !w.connectionId)
          throw new HttpError(
            409,
            'TEXT_WORKFLOW_REQUIRED',
            'Metin workflow için Workflows ekranındaki testi kullanın.',
          );
        const values = 'inputs' in p ? validateWorkflowInputs(w.definition, p.inputs) : {};
        const op = await createOperation(db, ctx, {
          capability:
            action === 'workflow.record'
              ? `teaching.${'command' in p ? p.command : 'start'}`
              : 'browser.trial',
          connectionId: w.connectionId,
          workflowId: w.id,
          inputs: {
            workflowId: w.id,
            definition: w.definition,
            workflowVersion: w.version,
            values,
          },
          idempotencyKey:
            action === 'workflow.trial'
              ? `trial:${w.id}:${w.version}:${stableHash(values)}`
              : `record:${randomUUID()}`,
          requiresApproval: w.definition.requiresApproval && action === 'workflow.trial',
        });
        if (action === 'workflow.trial')
          await db
            .insert(s.trials)
            .values({
              tenantId: ctx.tenantId,
              workflowId: w.id,
              version: w.version,
              inputHash: stableHash(values),
              operationId: op.id,
            })
            .onConflictDoNothing();
        return result('İşlem worker’a kaydedildi.', { operationId: op.id, status: op.status });
      }
      if (action === 'workflow.publish') {
        requireAdmin(ctx.role);
        const p = z.object({ id }).strict().parse(payload),
          w = await one(db.select().from(s.workflows).where(eq(s.workflows.id, p.id)));
        const ts = await db
          .select()
          .from(s.trials)
          .where(
            and(
              eq(s.trials.workflowId, w.id),
              eq(s.trials.version, w.version),
              eq(s.trials.verified, true),
            ),
          );
        if (new Set(ts.map((t) => t.inputHash)).size < 3)
          throw new HttpError(
            409,
            'THREE_TRIALS_REQUIRED',
            'Bu sürüm üç farklı veri setiyle doğrulanmalı.',
          );
        await db
          .update(s.workflows)
          .set({ publishedDefinition: w.definition, publishedVersion: w.version, status: 'ready' })
          .where(eq(s.workflows.id, w.id));
        await log(db, ctx.tenantId, ctx.actor, 'workflow.published', w.id, {
          version: w.version,
          verifiedTrials: ts.length,
          permissionsGranted: false,
        });
        return result('İş yayımlandı. Mevcut yetkilere sahip ajanlar ve görevler kullanabilir.');
      }
      requireAdmin(ctx.role);
      if (action === 'config.update') {
        const p = z
          .object({ baseVersion: z.number().int(), patch: configPatchSchema })
          .strict()
          .parse(payload);
        return saveConfig(db, ctx, p.baseVersion, p.patch);
      }
      if (action === 'connection.create') {
        const p = connectionInput.parse(payload);
        assertGenericConnectionConfig(p.config);
        const c = await one(
          db
            .insert(s.connections)
            .values({
              tenantId: ctx.tenantId,
              name: p.name,
              kind: p.kind,
              purpose: p.purpose,
              config: p.config,
              permissions: [],
              agents: ['admin'],
            })
            .returning(),
        );
        if (p.permissions.length)
          await db.insert(s.approvals).values({
            tenantId: ctx.tenantId,
            kind: 'connection',
            title: `${p.name} erişim izni`,
            summary: `Amaç: ${p.purpose}. İşlemler: ${p.permissions.join(', ')}. Kullanabilecekler: ${p.agents.join(', ')}.`,
            payload: { connectionId: c.id, permissions: p.permissions, agents: p.agents },
            payloadHash: stableHash({ permissions: p.permissions, agents: p.agents }),
            configVersion: config.version,
          });
        await log(db, ctx.tenantId, ctx.actor, 'connection.created', c.id, {
          kind: p.kind,
          purpose: p.purpose,
        });
        return result(
          'Bağlantı eklendi. Erişim onayları ve test tamamlanana kadar işler çalışmaz.',
          { id: c.id },
        );
      }
      if (action === 'connection.update') {
        const p = z
          .object({
            id,
            name: str.optional(),
            purpose: str.optional(),
            config: json.optional(),
            permissions: z.array(z.string()).max(100).optional(),
            agents: z.array(actor).optional(),
            enabled: z.boolean().optional(),
          })
          .strict()
          .parse(payload);
        const c = await one(db.select().from(s.connections).where(eq(s.connections.id, p.id)));
        if (p.config) assertGenericConnectionConfig(p.config, c.config);
        if (
          (p.config && (c.config.backoffice === true || c.kind === 'ai_provider')) ||
          (c.config.mcpSetup === true &&
            (p.config || p.permissions || p.agents || p.name || p.purpose))
        )
          throw new HttpError(
            409,
            'DEDICATED_SETUP_REQUIRED',
            'Sistem bilgilerini ilgili Backoffice Systems veya AI Providers ekranından güncelleyin.',
          );
        const { id: cid, enabled, ...update } = p;
        const expanded =
          (p.permissions ?? c.permissions).some(
            (permission) => !c.permissions.includes(permission),
          ) ||
          (p.agents ?? c.agents).some((a) => !c.agents.includes(a)) ||
          !!p.config;
        if (expanded) {
          const approval = await one(
            db
              .insert(s.approvals)
              .values({
                tenantId: ctx.tenantId,
                kind: 'connection',
                title: `${c.name} bağlantı değişikliği`,
                summary: `Güncellenecek ayarlar: ${JSON.stringify(update)}. Kullanım ve erişim kapsamını inceleyin.`,
                payload: { connectionId: cid, ...update },
                payloadHash: stableHash(update),
                configVersion: config.version,
              })
              .returning(),
          );
          await log(db, ctx.tenantId, ctx.actor, 'connection.change_proposed', cid, {
            approvalId: approval.id,
          });
          return result('Erişim veya sistem değişikliği onay bekliyor.', {
            approvalId: approval.id,
          });
        }
        await db
          .update(s.connections)
          .set({
            ...update,
            ...(enabled === undefined ? {} : { status: enabled ? 'awaiting_test' : 'disabled' }),
            ...(p.permissions || p.agents ? { realAccountVerified: false } : {}),
          })
          .where(eq(s.connections.id, cid));
        await log(db, ctx.tenantId, ctx.actor, 'connection.updated', cid, { ...update, enabled });
        return result('Bağlantı güncellendi.');
      }
      if (action === 'connection.test') {
        const p = z.object({ id }).strict().parse(payload);
        const target = await one(db.select().from(s.connections).where(eq(s.connections.id, p.id)));
        if (target.kind === 'ai_provider' || target.config.mcpSetup === true)
          throw new HttpError(
            409,
            'DEDICATED_SETUP_REQUIRED',
            'API bağlantısını AI Providers ekranından test edin.',
          );
        const inputs: JsonObject =
          target.config.backoffice === true
            ? { backoffice: true, loginRevision: target.config.loginRevision }
            : {};
        const op = await createOperation(db, ctx, {
          capability: 'connection.test',
          connectionId: p.id,
          inputs,
          idempotencyKey: `test:${randomUUID()}`,
        });
        return result('Bağlantı testi kuyruğa alındı.', { operationId: op.id });
      }
      if (action === 'whatsapp.connect') {
        const p = z.object({ id }).strict().parse(payload),
          c = await one(db.select().from(s.connections).where(eq(s.connections.id, p.id)));
        if (c.kind !== 'whatsapp' || c.config.mode === 'demo')
          throw new HttpError(400, 'LIVE_WHATSAPP_REQUIRED', 'Gerçek WhatsApp bağlantısı seçin.');
        await db
          .update(s.connections)
          .set({
            config: {
              ...c.config,
              linkRequested: true,
              linkAttempt: Number(c.config.linkAttempt ?? 0) + 1,
            },
            status: 'setup',
            realAccountVerified: false,
            lastTestAt: null,
            lastError: null,
          })
          .where(eq(s.connections.id, p.id));
        await db.delete(s.runtime).where(eq(s.runtime.key, `whatsapp.qr:${p.id}`));
        await log(db, ctx.tenantId, ctx.actor, 'whatsapp.link_requested', p.id);
        return result('Worker bağlantıyı başlatacak. QR kodunu yalnızca bu panelden alın.');
      }
      if (action === 'whatsapp.qr') {
        const p = z.object({ id }).strict().parse(payload);
        const connection = await one(
          db.select().from(s.connections).where(eq(s.connections.id, p.id)),
        );
        if (connection.kind !== 'whatsapp' || connection.config.mode === 'demo')
          throw new HttpError(400, 'LIVE_WHATSAPP_REQUIRED', 'Gerçek WhatsApp bağlantısı seçin.');
        const state = (
          await db
            .select()
            .from(s.runtime)
            .where(eq(s.runtime.key, `whatsapp.qr:${p.id}`))
        )[0]?.value;
        const valid =
          connection.status !== 'disabled' &&
          connection.status !== 'ready' &&
          state?.linkAttempt === Number(connection.config.linkAttempt ?? 0) &&
          typeof state.expiresAt === 'string' &&
          Date.parse(state.expiresAt) > Date.now() &&
          typeof state.qr === 'string' &&
          /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(state.qr);
        const qr = valid ? state!.qr : null;
        return result(
          qr ? 'Telefonunuzun bağlı cihazlar bölümünden QR’ı okutun.' : 'QR henüz hazır değil.',
          { qr: qr ?? null, expiresAt: valid ? state!.expiresAt : null, status: connection.status },
        );
      }
      if (action === 'cron.create') {
        const p = z
          .object({
            name: str,
            expression: z.string().max(150),
            timezone: z.string().default('Europe/Istanbul'),
            workflowId: id,
            inputs: json,
          })
          .strict()
          .parse(payload);
        validateCron(p.expression, p.timezone);
        const w = await one(db.select().from(s.workflows).where(eq(s.workflows.id, p.workflowId)));
        if (w.status !== 'ready' || !w.publishedDefinition || !w.connectionId)
          throw new HttpError(409, 'PUBLISH_FIRST', 'Görev için yayımlanmış bir iş seçin.');
        const values = validateWorkflowInputs(w.publishedDefinition, p.inputs);
        const c = await one(
          db.select().from(s.connections).where(eq(s.connections.id, w.connectionId)),
        );
        authorizeConnection(connectionView(c), { type: 'cron', id: 'schedule' }, 'browser.execute');
        const cron = await one(
          db
            .insert(s.cronJobs)
            .values({
              tenantId: ctx.tenantId,
              ...p,
              inputs: values,
              nextRunAt: nextRunAt(p.expression, p.timezone),
            })
            .returning(),
        );
        await log(db, ctx.tenantId, ctx.actor, 'cron.created', cron.id, {
          ...p,
          enabled: false,
          permissionsGranted: false,
        });
        return result('Görev duraklatılmış olarak eklendi. Önce deneme çalıştırın.', {
          id: cron.id,
        });
      }
      if (action === 'cron.update' || action === 'cron.delete') {
        const p = z
            .object({
              id,
              name: str.optional(),
              expression: z.string().max(150).optional(),
              timezone: z.string().optional(),
              workflowId: id.optional(),
              inputs: json.optional(),
            })
            .strict()
            .parse(payload),
          c = await one(db.select().from(s.cronJobs).where(eq(s.cronJobs.id, p.id)));
        if (c.deletedAt) throw new HttpError(410, 'CRON_DELETED', 'Görev silinmiş.');
        if (action === 'cron.delete') {
          await db
            .update(s.cronJobs)
            .set({ enabled: false, deletedAt: new Date(), version: c.version + 1 })
            .where(eq(s.cronJobs.id, c.id));
          await log(db, ctx.tenantId, ctx.actor, 'cron.deleted', c.id, { historyPreserved: true });
          return result('Görev silindi. Önceki çalıştırmalar denetim kaydında korunuyor.');
        }
        const definition = {
          name: p.name ?? c.name,
          expression: p.expression ?? c.expression,
          timezone: p.timezone ?? c.timezone,
          workflowId: p.workflowId ?? c.workflowId,
        };
        validateCron(definition.expression, definition.timezone);
        const w = await one(
          db.select().from(s.workflows).where(eq(s.workflows.id, definition.workflowId)),
        );
        if (w.status !== 'ready' || !w.publishedDefinition || !w.connectionId)
          throw new HttpError(409, 'PUBLISH_FIRST', 'Görev için yayımlanmış bir iş seçin.');
        const values = validateWorkflowInputs(w.publishedDefinition, p.inputs ?? c.inputs),
          connection = await one(
            db.select().from(s.connections).where(eq(s.connections.id, w.connectionId)),
          );
        authorizeConnection(
          connectionView(connection),
          { type: 'cron', id: c.id },
          'browser.execute',
        );
        await db
          .update(s.cronJobs)
          .set({
            ...definition,
            inputs: values,
            enabled: false,
            lastResult: null,
            version: c.version + 1,
            nextRunAt: nextRunAt(definition.expression, definition.timezone),
          })
          .where(eq(s.cronJobs.id, c.id));
        await log(db, ctx.tenantId, ctx.actor, 'cron.updated', c.id, {
          version: c.version + 1,
          enabled: false,
        });
        return result('Görev güncellendi ve duraklatıldı. Yeni ayarlarla deneme çalıştırın.');
      }
      if (action === 'cron.toggle') {
        const p = z.object({ id, enabled: z.boolean() }).strict().parse(payload);
        const c = await one(db.select().from(s.cronJobs).where(eq(s.cronJobs.id, p.id)));
        if (c.deletedAt) throw new HttpError(410, 'CRON_DELETED', 'Görev silinmiş.');
        if (p.enabled && c.lastResult !== 'succeeded')
          throw new HttpError(
            409,
            'DRY_RUN_REQUIRED',
            'Görevi açmadan önce başarılı bir deneme çalıştırın.',
          );
        await db
          .update(s.cronJobs)
          .set({ enabled: p.enabled, nextRunAt: nextRunAt(c.expression, c.timezone) })
          .where(eq(s.cronJobs.id, c.id));
        await log(db, ctx.tenantId, ctx.actor, 'cron.toggled', c.id, { enabled: p.enabled });
        return result(p.enabled ? 'Zamanlanmış görev açıldı.' : 'Görev duraklatıldı.');
      }
      if (action === 'cron.dryrun' || action === 'cron.run') {
        const p = z.object({ id }).strict().parse(payload),
          c = await one(db.select().from(s.cronJobs).where(eq(s.cronJobs.id, p.id)));
        if (c.deletedAt) throw new HttpError(410, 'CRON_DELETED', 'Görev silinmiş.');
        await db.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':cron:' + c.id},0))`,
        );
        if (
          (
            await db
              .select()
              .from(s.operations)
              .where(
                and(
                  eq(s.operations.cronId, c.id),
                  inArray(s.operations.status, [
                    'queued',
                    'running',
                    'verifying',
                    'awaiting_approval',
                    'needs_attention',
                  ]),
                ),
              )
          ).length
        )
          throw new HttpError(
            409,
            'CRON_OVERLAP',
            'Bu görev için süren veya incelenmesi gereken bir işlem var.',
          );
        const w = await one(db.select().from(s.workflows).where(eq(s.workflows.id, c.workflowId)));
        const text = w.mode === 'text';
        const unified = text && w.compiledPlan?.version === 2;
        if (w.status !== 'ready' || (text ? !w.enabled || !w.compiledPlan : !w.publishedDefinition))
          throw new HttpError(409, 'PUBLISH_FIRST', 'İşin güncel sürümü doğrulanmalı.');
        const inputs: JsonObject = {
          workflowVersion: w.publishedVersion,
          cronVersion: c.version,
          trigger: 'manual',
          dryRun: action === 'cron.dryrun',
          ...(text
            ? { textSnapshot: w.sourceText, systemIds: w.systemIds, compiledPlan: w.compiledPlan }
            : { definition: w.publishedDefinition, values: c.inputs }),
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
        const op = await createOperation(db, ctx, {
          capability: text ? 'workflow.text.execute' : 'browser.execute',
          connectionId: unified ? undefined : (w.connectionId ?? undefined),
          workflowId: w.id,
          cronId: c.id,
          actor: { type: 'cron', id: c.id },
          inputs,
          idempotencyKey: `cron-manual:${c.id}:${randomUUID()}`,
          requiresApproval: unified
            ? false
            : planWrites || w.publishedDefinition?.requiresApproval || false,
        });
        return result('Görev denemesi kaydedildi. Sonuç doğrulanacak.', { operationId: op.id });
      }
      if (action === 'email.draft') {
        const p = z
            .object({
              connectionId: id,
              to: z.string().email(),
              subject: z.string().min(1).max(300),
              body: str,
              sourceMessageId: id.optional(),
            })
            .strict()
            .parse(payload),
          c = await one(
            db.select().from(s.connections).where(eq(s.connections.id, p.connectionId)),
          );
        if (!['gmail', 'outlook'].includes(c.kind))
          throw new HttpError(400, 'EMAIL_REQUIRED', 'E-posta bağlantısı seçin.');
        authorizeConnection(connectionView(c), ctx.actor, 'email.draft', { testing: true });
        const { sourceMessageId, ...draftInput } = p;
        if (sourceMessageId) {
          const source = await one(
            db
              .select({
                connectionId: emailMessages.connectionId,
                accountEmail: emailMessages.accountEmail,
                subject: emailMessages.subject,
                address: emailMessages.sourceAddress,
              })
              .from(emailMessages)
              .innerJoin(
                s.messages,
                and(
                  eq(s.messages.id, emailMessages.messageId),
                  eq(s.messages.tenantId, emailMessages.tenantId),
                ),
              )
              .innerJoin(
                s.conversations,
                and(
                  eq(s.conversations.id, s.messages.conversationId),
                  eq(s.conversations.tenantId, s.messages.tenantId),
                ),
              )
              .where(eq(emailMessages.messageId, sourceMessageId)),
          );
          if (
            source.accountEmail !== String(c.config.accountEmail ?? '').toLowerCase() ||
            source.address.toLowerCase() !== p.to.toLowerCase()
          )
            throw new HttpError(409, 'EMAIL_SOURCE_CHANGED', 'Kaynak hesap veya alıcı uyuşmuyor.');
          if (p.subject !== source.subject)
            throw new HttpError(
              409,
              'EMAIL_SUBJECT_CHANGED',
              'Yanıt konusu kaynak e-postayla aynı olmalı.',
            );
          if (source.connectionId !== c.id)
            throw new HttpError(409, 'EMAIL_SOURCE_MISMATCH', 'Kaynak mesaj bu hesaba ait değil.');
          const existing = (
            await db
              .select()
              .from(emailDraftSources)
              .where(eq(emailDraftSources.sourceMessageId, sourceMessageId))
          )[0];
          if (existing)
            return result('Bu mesaj için bir taslak zaten var.', { id: existing.draftId });
        }
        const d = await one(
          db
            .insert(s.drafts)
            .values({ tenantId: ctx.tenantId, ...draftInput })
            .returning(),
        );
        if (sourceMessageId)
          await db
            .insert(emailDraftSources)
            .values({ tenantId: ctx.tenantId, draftId: d.id, sourceMessageId });
        await log(db, ctx.tenantId, ctx.actor, 'email.draft_prepared', d.id, {
          to: p.to,
          subject: p.subject,
          sent: false,
        });
        return result('Taslak kaydedildi. Henüz gönderilmedi.', { id: d.id });
      }
      if (action === 'email.send') {
        const p = z.object({ id }).strict().parse(payload),
          d = await one(db.select().from(s.drafts).where(eq(s.drafts.id, p.id)));
        if (d.status === 'sent') return result('Bu taslak zaten gönderildi.');
        const source = (
          await db
            .select({
              threadId: emailMessages.threadId,
              inReplyTo: emailMessages.internetMessageId,
              sourceMessageId: emailMessages.providerMessageId,
            })
            .from(emailDraftSources)
            .innerJoin(
              emailMessages,
              and(
                eq(emailMessages.messageId, emailDraftSources.sourceMessageId),
                eq(emailMessages.tenantId, emailDraftSources.tenantId),
              ),
            )
            .where(eq(emailDraftSources.draftId, d.id))
        )[0];
        const op = await createOperation(db, ctx, {
          capability: 'email.send',
          connectionId: d.connectionId,
          inputs: {
            draftId: d.id,
            to: d.to,
            subject: d.subject,
            body: d.body,
            ...(source
              ? {
                  threadId: source.threadId,
                  ...(source.inReplyTo &&
                  /^<[^<>\s\u0000-\u001f\u007f]+>$/.test(source.inReplyTo) &&
                  source.inReplyTo.length <= 998
                    ? { inReplyTo: source.inReplyTo }
                    : {}),
                  sourceMessageId: source.sourceMessageId,
                }
              : {}),
          },
          idempotencyKey: `email:${d.id}`,
        });
        await db.update(s.drafts).set({ status: op.status }).where(eq(s.drafts.id, d.id));
        return result('Gönderim izin ve onay kontrolüne kaydedildi.', {
          operationId: op.id,
          status: op.status,
        });
      }
      if (action === 'calendar.query' || action === 'calendar.create') {
        const p =
          action === 'calendar.query'
            ? z
                .object({
                  connectionId: id,
                  start: z.string().datetime(),
                  end: z.string().datetime(),
                })
                .strict()
                .parse(payload)
            : z
                .object({
                  connectionId: id,
                  title: str,
                  start: z.string().datetime(),
                  end: z.string().datetime(),
                  description: z.string().max(4000).optional(),
                })
                .strict()
                .parse(payload);
        if (new Date(p.end) <= new Date(p.start))
          throw new HttpError(400, 'INVALID_TIME_RANGE', 'Bitiş başlangıçtan sonra olmalı.');
        const op = await createOperation(db, ctx, {
          capability: action === 'calendar.query' ? 'calendar.read' : 'calendar.create',
          connectionId: p.connectionId,
          inputs: p,
          idempotencyKey: `calendar:${randomUUID()}`,
        });
        return result('Takvim işlemi kaydedildi.', { operationId: op.id, status: op.status });
      }
      if (action === 'mcp.execute') {
        const p = z
          .object({ connectionId: id, tool: z.string().min(1).max(120), arguments: json })
          .strict()
          .parse(payload);
        const op = await createOperation(db, ctx, {
          capability: `mcp:${p.tool}`,
          connectionId: p.connectionId,
          inputs: { tool: p.tool, arguments: p.arguments },
          idempotencyKey: `mcp:${randomUUID()}`,
        });
        return result('İzinli araç işlemi kaydedildi.', { operationId: op.id });
      }
      if (action === 'proposal.apply') {
        const p = z.object({ id }).strict().parse(payload),
          pr = await one(db.select().from(s.proposals).where(eq(s.proposals.id, p.id)));
        if (pr.status !== 'pending')
          throw new HttpError(409, 'PROPOSAL_ALREADY_RESOLVED', 'Bu öneri daha önce işlendi.');
        const res = await saveConfig(db, ctx, pr.baseVersion, pr.patch);
        await db
          .update(s.proposals)
          .set({ status: res.data?.proposalId ? 'awaiting_approval' : 'applied' })
          .where(eq(s.proposals.id, pr.id));
        return res;
      }
      if (action === 'approval.resolve') {
        const p = z
          .object({ id, decision: z.enum(['approve', 'reject']) })
          .strict()
          .parse(payload);
        await db.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':approval:' + p.id},0))`,
        );
        const a = await one(db.select().from(s.approvals).where(eq(s.approvals.id, p.id)));
        if (a.status !== 'pending')
          throw new HttpError(409, 'ALREADY_RESOLVED', 'Bu onay zaten işlendi.');
        if (p.decision === 'approve' && a.configVersion !== config.version)
          throw new HttpError(
            409,
            'STALE_APPROVAL',
            'Ayar sürümü değişti. İşlemi güncel ayarlarla yeniden hazırlayın.',
          );
        let operationId: string | null = null;
        if (a.kind === 'operation' && a.operationId) {
          const op = await one(
            db.select().from(s.operations).where(eq(s.operations.id, a.operationId)),
          );
          if (op.status !== 'awaiting_approval' || op.payloadHash !== a.payloadHash)
            throw new HttpError(409, 'APPROVAL_MISMATCH', 'Onay ile işlemin girdileri eşleşmiyor.');
          await db
            .update(s.operations)
            .set({
              status: p.decision === 'approve' ? 'queued' : 'failed',
              error: p.decision === 'reject' ? 'Admin işlemi reddetti.' : null,
              updatedAt: new Date(),
            })
            .where(eq(s.operations.id, op.id));
          operationId = p.decision === 'approve' ? op.id : null;
        }
        if (p.decision === 'approve' && a.kind === 'configuration') {
          const pr = await one(
            db
              .select()
              .from(s.proposals)
              .where(eq(s.proposals.id, String(a.payload.proposalId))),
          );
          if (stableHash(pr.patch) !== a.payloadHash)
            throw new HttpError(409, 'APPROVAL_MISMATCH', 'Öneri onaydan sonra değişmiş.');
          await saveConfig(db, ctx, pr.baseVersion, pr.patch, true);
          await db.update(s.proposals).set({ status: 'applied' }).where(eq(s.proposals.id, pr.id));
        }
        if (p.decision === 'approve' && a.kind === 'connection') {
          const { connectionId, ...patch } = a.payload;
          const parsed = z
            .object({
              permissions: z.array(z.string()).optional(),
              agents: z.array(actor).optional(),
              name: str.optional(),
              purpose: str.optional(),
              config: json.optional(),
            })
            .strict()
            .parse(patch);
          const target = await one(
            db
              .select()
              .from(s.connections)
              .where(eq(s.connections.id, String(connectionId))),
          );
          if (parsed.config) assertGenericConnectionConfig(parsed.config, target.config);
          if (
            target.config.mcpSetup === true ||
            (parsed.config && (target.config.backoffice === true || target.kind === 'ai_provider'))
          )
            throw new HttpError(
              409,
              'DEDICATED_SETUP_REQUIRED',
              'Sistem değişikliğini ilgili kurulum ekranından tekrar hazırlayın.',
            );
          await db
            .update(s.connections)
            .set({ ...parsed, status: 'awaiting_test', realAccountVerified: false })
            .where(eq(s.connections.id, String(connectionId)));
        }
        await db
          .update(s.approvals)
          .set({
            status: p.decision === 'approve' ? 'approved' : 'rejected',
            decidedBy: ctx.actor.id,
          })
          .where(eq(s.approvals.id, a.id));
        await log(db, ctx.tenantId, ctx.actor, 'approval.resolved', a.id, {
          decision: p.decision,
          operationId: a.operationId,
          hash: a.payloadHash,
        });
        return result(
          p.decision === 'approve' ? 'Onay kaydedildi.' : 'İşlem reddedildi.',
          operationId ? { operationId } : undefined,
        );
      }
      if (action === 'payment.pause') {
        await saveConfig(db, ctx, config.version, { paymentsEnabled: false }, true);
        await db
          .update(s.connections)
          .set({ status: 'disabled' })
          .where(eq(s.connections.kind, 'stripe'));
        return result('Ödeme işlemleri durduruldu.');
      }
      if (action === 'payment.link') {
        const p = z.object({ recordId: id, connectionId: id }).strict().parse(payload);
        if (!config.paymentsEnabled)
          throw new HttpError(403, 'PAYMENTS_DISABLED', 'Ödeme modülü kapalı.');
        const record = await one(
          db.select().from(s.paymentRecords).where(eq(s.paymentRecords.id, p.recordId)),
        );
        const conn = await one(
          db.select().from(s.connections).where(eq(s.connections.id, p.connectionId)),
        );
        if (
          conn.kind !== 'stripe' ||
          !/^acct_[A-Za-z0-9]+$/.test(String(conn.config.connectedAccount))
        )
          throw new HttpError(
            409,
            'STRIPE_ACCOUNT_REQUIRED',
            'Onaylanmış işletme Stripe hesabı gerekli.',
          );
        const financial = {
          ...financialTerms(record, {}),
          connectedAccount: conn.config.connectedAccount,
          environment: conn.config.environment,
          externalRecordId: record.externalRecordId,
        };
        const op = await createOperation(db, ctx, {
          capability: 'payment.link',
          connectionId: p.connectionId,
          inputs: { recordId: p.recordId, financial },
          idempotencyKey: `payment:${p.recordId}`,
          requiresApproval: true,
        });
        return result('Ödeme isteği hesap, tutar, para birimi ve kayıt özetiyle onay bekliyor.', {
          operationId: op.id,
        });
      }
      throw new HttpError(400, 'UNKNOWN_COMMAND', 'Desteklenmeyen işlem.');
    });
    if (typeof response.data?.operationId === 'string')
      await enqueue('afterhours.operation', {
        tenantId: ctx.tenantId,
        operationId: response.data.operationId,
      });
    return response;
  } catch (error) {
    if (error instanceof ZodError)
      throw new HttpError(
        400,
        'INVALID_INPUT',
        'Girilen bilgiler beklenen biçime uymuyor. Alanları kontrol edin.',
      );
    if (error instanceof HttpError && error.status === 403)
      await tenantDb(ctx.tenantId, (db) =>
        log(db, ctx.tenantId, ctx.actor, 'authorization.denied', null, {
          action,
          code: error.code,
        }),
      );
    throw error;
  }
}
