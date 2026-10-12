import {
  getCoreApi,
  tickEmail,
  drainUnifiedWorkflowRuns,
  processPendingManagementPlans,
  getPendingWork,
  getWorkerConnections,
  readConnectionSecret,
  writeConnectionSecret,
  deleteConnectionSecret,
  updateConnectionStatus,
  setWhatsAppQr,
  updateWhatsAppDelivery,
} from '@afterhours/core';
import { closeDb, getQueue } from '@afterhours/core/db';
import { closeTeachingSessions } from '@afterhours/core/browser';
import { WhatsAppManager, WhatsAppSendError } from './whatsapp.js';

interface OperationJob {
  tenantId: string;
  operationId: string;
}
interface ConversationJob {
  tenantId: string;
  conversationId: string;
}

const api = getCoreApi();
const whatsapp = new WhatsAppManager({
  api,
  connections: () => getWorkerConnections('whatsapp'),
  readSecret: readConnectionSecret,
  writeSecret: writeConnectionSecret,
  deleteSecret: deleteConnectionSecret,
  updateStatus: updateConnectionStatus,
  setQr: setWhatsAppQr,
  receipt: updateWhatsAppDelivery,
});

let stopping = false;
let ticking = false;
let lastRefresh = 0;
let heartbeatRunning = false;

async function heartbeat() {
  if (stopping || heartbeatRunning) return;
  heartbeatRunning = true;
  try {
    await api.heartbeat();
  } catch {
    console.error('AfterHours worker: durum kaydı güncellenemedi. Veritabanını kontrol edin.');
  } finally {
    heartbeatRunning = false;
  }
}

async function tick() {
  if (ticking || stopping) return;
  ticking = true;
  try {
    const now = Date.now();
    if (now - lastRefresh > 10_000) {
      await whatsapp.refresh();
      lastRefresh = now;
    }
    await tickEmail();
    await api.tickSchedules();
    const work = await getPendingWork();
    for (const operation of work.operations)
      await api.executeOperation(operation.tenantId, operation.operationId);
    for (const tenant of await api.tenants()) {
      await drainUnifiedWorkflowRuns(tenant.id);
      await processPendingManagementPlans(tenant.id);
    }
    for (const conversation of work.conversations)
      await api.processConversation(conversation.tenantId, conversation.conversationId);
    await api.tickOutbox(
      async (tenantId: string, connectionId: string, address: string, body: string) => {
        try {
          return await whatsapp.deliver(tenantId, connectionId, address, body);
        } catch (error) {
          if (error instanceof WhatsAppSendError && error.uncertain) {
            // Core checks this discriminator to prevent blind re-delivery after a possible send.
            throw Object.assign(new Error(error.message), {
              name: 'OutcomeUnknown',
              uncertain: true,
              safeToRetry: false,
            });
          }
          throw error;
        }
      },
    );
  } catch {
    // Persisted work and per-operation errors are visible through the panel; no customer/secret payload logs.
    console.error(
      'AfterHours worker: çalışma döngüsü tamamlanamadı. Veritabanını ve paneldeki işlem kayıtlarını kontrol edin.',
    );
  } finally {
    ticking = false;
  }
}

async function start() {
  const queue = await getQueue();
  await queue.work<OperationJob>(
    'afterhours.operation',
    { batchSize: 1, localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) await api.executeOperation(job.data.tenantId, job.data.operationId);
    },
  );
  await queue.work<ConversationJob>(
    'afterhours.conversation',
    { batchSize: 1, localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs)
        await api.processConversation(job.data.tenantId, job.data.conversationId);
    },
  );
  await heartbeat();
  // A long browser execution must not make a healthy worker appear offline.
  const heartbeatInterval = setInterval(() => {
    void heartbeat();
  }, 10_000);
  console.log('AfterHours worker çalışıyor: tarayıcı işleri, öğret modu, cron ve mesaj kuyruğu.');
  const interval = setInterval(() => {
    void tick();
  }, 2000);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      stopping = true;
      clearInterval(interval);
      clearInterval(heartbeatInterval);
      void (async () => {
        await whatsapp.stop();
        await closeTeachingSessions();
        await closeDb();
      })().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  void tick();
}

void start().catch(() => {
  console.error(
    'AfterHours worker başlatılamadı. Önce veritabanını hazırlayın ve DATABASE_URL ayarını kontrol edin.',
  );
  process.exitCode = 1;
});
