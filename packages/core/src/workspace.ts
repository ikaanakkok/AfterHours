import { desc, eq, isNull } from 'drizzle-orm';
import { auth } from './auth.js';
import { tenantDb } from './db.js';
import { getContext, getMemberships } from './context.js';
import * as s from './schema.js';
import { emailMessages } from './email-schema.js';
import { currentConfig, connectionView } from './store.js';
import { stableHash } from './security.js';
import { isDemo } from './env.js';
import { getManagementPlans } from './management.js';
import { getEmailSyncViews } from './email-sync.js';
import { getContextMaterials } from './context-materials.js';
import type { Role, WorkspaceView, OperationStatus } from './types.js';

export async function getWorkspace(headers: Headers, tenantId?: string): Promise<WorkspaceView> {
  const ctx = await getContext(headers, tenantId),
    session = await auth.api.getSession({ headers });
  if (!session) throw new Error('Missing session');
  const ms = await getMemberships(ctx.actor.id),
    member = ms.find((m) => m.tenantId === ctx.tenantId)!;
  const context = await getContextMaterials(ctx);
  const managementPlans = ctx.role === 'admin' ? await getManagementPlans(ctx) : [];
  const emailSync = ctx.role === 'admin' ? await getEmailSyncViews(ctx) : [];
  return tenantDb(ctx.tenantId, async (db) => {
    const [
      config,
      conn,
      workflow,
      trial,
      cron,
      conversation,
      message,
      emailMetadata,
      operation,
      approval,
      handoff,
      audit,
      draft,
      event,
      proposal,
      adminMsg,
      secretRows,
      runtime,
    ] = await Promise.all([
      currentConfig(db),
      db.select().from(s.connections),
      db.select().from(s.workflows),
      db.select().from(s.trials),
      db.select().from(s.cronJobs).where(isNull(s.cronJobs.deletedAt)),
      db.select().from(s.conversations).orderBy(desc(s.conversations.updatedAt)).limit(100),
      db.select().from(s.messages).orderBy(desc(s.messages.createdAt)).limit(1000),
      db.select().from(emailMessages).orderBy(desc(emailMessages.sourceDate)).limit(1000),
      db.select().from(s.operations).orderBy(desc(s.operations.createdAt)).limit(100),
      db.select().from(s.approvals).orderBy(desc(s.approvals.createdAt)).limit(100),
      db.select().from(s.handoffs).orderBy(desc(s.handoffs.createdAt)).limit(100),
      db.select().from(s.audit).orderBy(desc(s.audit.createdAt)).limit(200),
      db.select().from(s.drafts).orderBy(desc(s.drafts.createdAt)).limit(100),
      db.select().from(s.calendarEvents).orderBy(desc(s.calendarEvents.start)).limit(100),
      ctx.role === 'admin'
        ? db.select().from(s.proposals).orderBy(desc(s.proposals.createdAt)).limit(50)
        : Promise.resolve([]),
      ctx.role === 'admin'
        ? db.select().from(s.adminMessages).orderBy(desc(s.adminMessages.createdAt)).limit(50)
        : Promise.resolve([]),
      db.select({ connectionId: s.secrets.connectionId }).from(s.secrets),
      db.select().from(s.runtime),
    ]);
    const heartbeat = runtime.find((r) => r.key === 'worker.heartbeat')?.updatedAt ?? null;
    return {
      tenant: { id: ctx.tenantId, name: member.name },
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: ctx.role!,
      },
      memberships: ms.map((m) => ({ ...m, role: m.role as Role })),
      config,
      context,
      managementPlans,
      emailSync,
      connections: conn.filter((c) => !c.deletedAt).map((c) =>
        connectionView(
          c,
          secretRows.some((secret) => secret.connectionId === c.id),
        ),
      ),
      workflows: workflow.map((w) => ({
        ...w,
        mode: w.mode as 'legacy' | 'text',
        latestTestOperationId:
          operation.find(
            (o) =>
              o.workflowId === w.id &&
              o.capability === 'workflow.text.test' &&
              o.inputs.workflowVersion === w.version &&
              o.inputs.clarificationHash === stableHash(w.clarification),
          )?.id ?? null,
        status: w.status as WorkspaceView['workflows'][number]['status'],
        trials: trial.filter((t) => t.workflowId === w.id && t.version === w.version).length,
        successfulTrials: trial.filter(
          (t) => t.workflowId === w.id && t.version === w.version && t.verified,
        ).length,
      })),
      cronJobs: cron.map((c) => ({
        ...c,
        nextRunAt: c.nextRunAt?.toISOString() ?? null,
        lastRunAt: c.lastRunAt?.toISOString() ?? null,
      })),
      conversations: conversation.map((c) => {
        const messages = message
          .filter((m) => m.conversationId === c.id)
          .map((m) => {
            const metadata = emailMetadata.find((e) => e.messageId === m.id);
            return {
              ...m,
              direction: m.direction as 'inbound' | 'outbound',
              createdAt: (metadata?.sourceDate ?? m.createdAt).toISOString(),
              ...(metadata
                ? {
                    emailSubject: metadata.subject,
                    sourceDate: metadata.sourceDate.toISOString(),
                    sourceAddress: metadata.sourceAddress,
                  }
                : {}),
            };
          })
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        const lastEmail = emailMetadata.find((e) =>
          message.some((m) => m.id === e.messageId && m.conversationId === c.id),
        );
        return {
          ...c,
          ...(lastEmail ? { emailSubject: lastEmail.subject, threadId: lastEmail.threadId } : {}),
          mode: c.mode as 'ai' | 'human',
          updatedAt: c.updatedAt.toISOString(),
          lastMessage: messages.at(-1)?.body ?? '',
          messages,
        };
      }),
      operations: operation.map((o) => ({
        ...o,
        status: o.status as OperationStatus,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      })),
      approvals:
        ctx.role === 'admin'
          ? approval.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))
          : [],
      handoffs: handoff.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
      audit: audit.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      drafts: draft,
      calendarEvents: event.map((e) => ({
        ...e,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
      })),
      proposals: proposal.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
      adminMessages: adminMsg
        .reverse()
        .map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      runtime: {
        mode: isDemo() ? 'demo' : 'live',
        workerLastSeen: heartbeat?.toISOString() ?? null,
        workerOnline: !!heartbeat && Date.now() - heartbeat.getTime() < 30000,
        voiceStatus: 'iPhone–Mac cihaz kontrolü ve otomatik görüşme sesi doğrulaması bekleniyor',
        paymentsEnabled: config.paymentsEnabled,
      },
    };
  });
}
