import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  extractMessageContent,
  fetchLatestWaWebVersion,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type WASocket,
  type WAVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { WHATSAPP_QR_TTL_MS } from '@afterhours/core';
import type { ConnectionView, CoreApi, JsonObject, SetupState } from '@afterhours/core/types';

export type WorkerConnection = ConnectionView & { tenantId: string };
export interface WhatsAppDependencies {
  api: CoreApi;
  // Pairing-only setup can suspend ingestion while the shared worker is paused for tests.
  receiveMessages?: boolean;
  protocolVersion?(): Promise<WAVersion>;
  connections(): Promise<WorkerConnection[]>;
  readSecret(tenantId: string, connectionId: string): Promise<JsonObject>;
  writeSecret(tenantId: string, connectionId: string, value: JsonObject): Promise<void>;
  deleteSecret?(tenantId: string, connectionId: string): Promise<void>;
  updateStatus(
    tenantId: string,
    connectionId: string,
    status: SetupState,
    error?: string,
    realAccountVerified?: boolean,
    expectedAttempt?: number,
  ): Promise<void>;
  setQr(
    tenantId: string,
    connectionId: string,
    qr: string | null,
    expectedAttempt?: number,
  ): Promise<void>;
  receipt?(
    tenantId: string,
    connectionId: string,
    externalId: string,
    status: 'delivered' | 'read',
  ): Promise<void>;
}

export class WhatsAppSendError extends Error {
  readonly safeToRetry: boolean;
  constructor(
    public readonly uncertain: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'WhatsAppSendError';
    this.safeToRetry = !uncertain;
  }
}

interface StoredAuth {
  creds: AuthenticationCreds;
  keys: Record<string, unknown>;
}
interface ActiveConnection {
  connection: WorkerConnection;
  socket: WASocket;
  connected: boolean;
  startingAt: number;
  retries: number;
  reconnect?: ReturnType<typeof setTimeout>;
  intentionallyClosed: boolean;
  stopAuth(): void;
  flushAuth(): Promise<void>;
}

async function encryptedAuth(
  connection: WorkerConnection,
  dependencies: WhatsAppDependencies,
): Promise<{
  state: AuthenticationState;
  save: () => Promise<void>;
  stop: () => void;
  flush: () => Promise<void>;
}> {
  const secrets = await dependencies.readSecret(connection.tenantId, connection.id);
  const attempt = connection.config.linkAttempt;
  if (
    typeof attempt === 'number' &&
    attempt > 0 &&
    Number.isSafeInteger(attempt) &&
    secrets.baileysLinkAttempt !== attempt
  ) {
    delete secrets.baileysState;
    secrets.baileysLinkAttempt = attempt;
    await dependencies.writeSecret(connection.tenantId, connection.id, secrets);
  }
  let stored: StoredAuth;
  if (typeof secrets.baileysState === 'string') {
    const parsed: unknown = JSON.parse(secrets.baileysState, BufferJSON.reviver);
    if (!parsed || typeof parsed !== 'object' || !('creds' in parsed) || !('keys' in parsed))
      throw new Error('Stored WhatsApp session is invalid');
    stored = parsed as StoredAuth;
  } else stored = { creds: initAuthCreds(), keys: {} };
  let saveQueue: Promise<void> = Promise.resolve();
  let acceptingWrites = true;
  const save = () => {
    if (!acceptingWrites) return Promise.resolve();
    const payload = { ...secrets, baileysState: JSON.stringify(stored, BufferJSON.replacer) };
    const next = saveQueue.then(() =>
      dependencies.writeSecret(connection.tenantId, connection.id, payload),
    );
    saveQueue = next;
    return next;
  };
  const keys: SignalKeyStore = {
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      const result: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const id of ids) {
        let value = stored.keys[`${type}:${id}`];
        if (type === 'app-state-sync-key' && value && typeof value === 'object')
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        if (value !== undefined && value !== null) result[id] = value as SignalDataTypeMap[T];
      }
      return result;
    },
    set: async (data) => {
      for (const [category, entries] of Object.entries(data)) {
        if (!entries) continue;
        for (const [id, value] of Object.entries(entries)) {
          const key = `${category}:${id}`;
          if (value === null || value === undefined) delete stored.keys[key];
          else stored.keys[key] = value;
        }
      }
      await save();
    },
  };
  return {
    state: { creds: stored.creds, keys },
    save,
    stop: () => {
      acceptingWrites = false;
    },
    flush: () => saveQueue,
  };
}

function disconnectCode(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('output' in error)) return null;
  const output = error.output;
  if (!output || typeof output !== 'object' || !('statusCode' in output)) return null;
  return typeof output.statusCode === 'number' ? output.statusCode : null;
}

// Keep LID identities in their own namespace; a LID is not a phone number.
export function whatsappAddress(value: string): string | null {
  const match = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid)$/.exec(value);
  return match ? `${match[1]}@${match[2]}` : null;
}

export class WhatsAppManager {
  private active = new Map<string, ActiveConnection>();
  private connecting = new Set<string>();
  private refreshing = false;
  private stopping = false;
  private version: { value: WAVersion; fetchedAt: number } | undefined;
  // Baileys debug payloads can include session/customer data; never emit them to application logs.
  private logger = pino({ level: 'silent' });
  constructor(
    private dependencies: WhatsAppDependencies,
    private socketFactory: typeof makeWASocket = makeWASocket,
  ) {}

  private async protocolVersion(): Promise<WAVersion> {
    if (this.version && Date.now() - this.version.fetchedAt < 60 * 60 * 1000)
      return this.version.value;
    const result = this.dependencies.protocolVersion
      ? { version: await this.dependencies.protocolVersion(), isLatest: true }
      : await fetchLatestWaWebVersion({ timeout: 5000 });
    if (
      !result.isLatest ||
      result.version.length !== 3 ||
      result.version.some((part) => !Number.isSafeInteger(part) || part < 0)
    )
      throw new Error('Current WhatsApp protocol version unavailable');
    this.version = { value: result.version, fetchedAt: Date.now() };
    return result.version;
  }

  private async isCurrent(entry: ActiveConnection): Promise<boolean> {
    const key = `${entry.connection.tenantId}:${entry.connection.id}`;
    if (this.stopping || entry.intentionallyClosed || this.active.get(key) !== entry) return false;
    const latest = (await this.dependencies.connections()).find(
      (candidate) =>
        candidate.tenantId === entry.connection.tenantId && candidate.id === entry.connection.id,
    );
    return (
      !!latest &&
      latest.status !== 'disabled' &&
      latest.config.enabled !== false &&
      latest.config.mode !== 'demo' &&
      latest.config.linkAttempt === entry.connection.config.linkAttempt &&
      !this.stopping &&
      !entry.intentionallyClosed &&
      this.active.get(key) === entry
    );
  }

  private updateStatus(
    connection: WorkerConnection,
    status: SetupState,
    error?: string,
    verified?: boolean,
  ) {
    return this.dependencies.updateStatus(
      connection.tenantId,
      connection.id,
      status,
      error,
      verified,
      Number(connection.config.linkAttempt ?? 0),
    );
  }

  async refresh(): Promise<void> {
    if (this.refreshing || this.stopping) return;
    this.refreshing = true;
    try {
      const connections = await this.dependencies.connections();
      const candidates = connections.filter(
        (connection) =>
          connection.kind === 'whatsapp' &&
          connection.status !== 'disabled' &&
          connection.config.mode !== 'demo' &&
          connection.config.enabled !== false &&
          (connection.config.linkRequested === true || connection.hasCredentials),
      );
      const available = new Set(
        candidates.map((connection) => `${connection.tenantId}:${connection.id}`),
      );
      for (const [key, entry] of this.active) {
        if (!available.has(key)) {
          const removed = connections.some(
            (connection) =>
              connection.tenantId === entry.connection.tenantId &&
              connection.id === entry.connection.id &&
              !!connection.deletedAt,
          );
          this.close(entry);
          await entry.flushAuth().catch(() => undefined);
          if (removed && this.dependencies.deleteSecret)
            await this.dependencies
              .deleteSecret(entry.connection.tenantId, entry.connection.id)
              .catch(() => undefined);
          await this.dependencies.setQr(entry.connection.tenantId, entry.connection.id, null);
          this.active.delete(key);
        }
      }
      for (const connection of connections) {
        if (
          connection.deletedAt &&
          !this.active.has(`${connection.tenantId}:${connection.id}`) &&
          this.dependencies.deleteSecret
        )
          await this.dependencies
            .deleteSecret(connection.tenantId, connection.id)
            .catch(() => undefined);
      }
      for (const connection of candidates) {
        const key = `${connection.tenantId}:${connection.id}`;
        const existing = this.active.get(key);
        if (existing && existing.connection.config.linkAttempt === connection.config.linkAttempt) {
          existing.connection = connection;
          continue;
        }
        if (existing) {
          this.close(existing);
          await existing.flushAuth().catch(() => undefined);
          this.active.delete(key);
        }
        try {
          await this.connect(connection);
        } catch {
          await this.updateStatus(
            connection,
            'needs_attention',
            'WhatsApp oturumu başlatılamadı. Bağlantı ve şifreli kimlik bilgilerini kontrol edin.',
          );
        }
      }
    } finally {
      this.refreshing = false;
    }
  }

  private async connect(connection: WorkerConnection, retries = 0): Promise<void> {
    if (this.stopping) return;
    const key = `${connection.tenantId}:${connection.id}`;
    if (this.connecting.has(key)) return;
    this.connecting.add(key);
    try {
      const version = await this.protocolVersion();
      const auth = await encryptedAuth(connection, this.dependencies);
      const socket = this.socketFactory({
        version,
        auth: auth.state,
        logger: this.logger,
        browser: ['AfterHours', 'Chrome', '1.0'],
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        shouldIgnoreJid: (jid) =>
          jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter'),
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 25_000,
        defaultQueryTimeoutMs: 20_000,
        qrTimeout: WHATSAPP_QR_TTL_MS,
      });
      const entry: ActiveConnection = {
        connection,
        socket,
        connected: false,
        startingAt: Date.now(),
        retries,
        intentionallyClosed: false,
        stopAuth: auth.stop,
        flushAuth: auth.flush,
      };
      this.active.set(key, entry);
      socket.ev.on('creds.update', () => {
        if (entry.intentionallyClosed || this.stopping) return;
        void auth
          .save()
          .catch(async () => {
            this.close(entry);
            await this.updateStatus(
              connection,
              'needs_attention',
              'WhatsApp oturum bilgileri güvenli depoya kaydedilemedi.',
            );
          })
          .catch(() => undefined);
      });
      let updateQueue: Promise<void> = Promise.resolve();
      socket.ev.on('connection.update', (update) => {
        updateQueue = updateQueue
          .then(async () => {
            if (entry.intentionallyClosed || this.stopping) return;
            if (update.qr) {
              const image = await QRCode.toDataURL(update.qr, { width: 288, margin: 2 });
              await this.dependencies.setQr(
                connection.tenantId,
                connection.id,
                image,
                Number(connection.config.linkAttempt ?? 0),
              );
              await this.updateStatus(
                connection,
                'awaiting_test',
                'Telefondaki bağlı cihazlar ekranından QR kodunu tarayın.',
              );
            }
            if (update.connection === 'open') {
              if (!(await this.isCurrent(entry))) return;
              if (!socket.user?.id) throw new Error('WhatsApp account identity unavailable');
              await auth.save();
              entry.connected = true;
              entry.retries = 0;
              await this.dependencies.setQr(
                connection.tenantId,
                connection.id,
                null,
                Number(connection.config.linkAttempt ?? 0),
              );
              await this.updateStatus(connection, 'ready', undefined, true);
            }
            if (update.connection !== 'close') return;
            entry.connected = false;
            if (entry.intentionallyClosed || this.stopping) return;
            await this.dependencies.setQr(
              connection.tenantId,
              connection.id,
              null,
              Number(connection.config.linkAttempt ?? 0),
            );
            const code = disconnectCode(update.lastDisconnect?.error);
            if (code === 405) this.version = undefined;
            const requiresRelink =
              code === DisconnectReason.loggedOut ||
              code === DisconnectReason.badSession ||
              code === DisconnectReason.connectionReplaced;
            if (requiresRelink || entry.retries >= 5) {
              entry.intentionallyClosed = true;
              await this.updateStatus(
                connection,
                'needs_attention',
                requiresRelink
                  ? 'WhatsApp oturumu kapandı. Hesabı yeniden bağlayın.'
                  : 'WhatsApp yeniden bağlantı sınırına ulaştı. Bağlantıyı kontrol edip yeniden başlatın.',
              );
              return;
            }
            await this.updateStatus(
              connection,
              'needs_attention',
              `WhatsApp bağlantısı kesildi (kod: ${code ?? 'bilinmiyor'}); yeniden bağlantı bekleniyor.`,
            );
            entry.retries += 1;
            entry.reconnect = setTimeout(
              () => {
                if (this.stopping || entry.intentionallyClosed) return;
                void (async () => {
                  const latest = (await this.dependencies.connections()).find(
                    (candidate) =>
                      candidate.tenantId === connection.tenantId && candidate.id === connection.id,
                  );
                  if (!latest || !(await this.isCurrent(entry))) return;
                  this.close(entry);
                  await entry.flushAuth().catch(() => undefined);
                  if (this.active.get(key) === entry) await this.connect(latest, entry.retries);
                })().catch(() =>
                  this.updateStatus(
                    connection,
                    'needs_attention',
                    'WhatsApp yeniden bağlanamadı; personel kontrolü gerekli.',
                  ).catch(() => undefined),
                );
              },
              Math.min(30_000, 1000 * 2 ** entry.retries),
            );
          })
          .catch(() => {
            this.close(entry);
            void this.updateStatus(
              connection,
              'needs_attention',
              'WhatsApp bağlantı durumu kaydedilemedi. Bağlantıyı ve veritabanını kontrol edin.',
            ).catch(() => undefined);
          });
      });
      socket.ev.on('messages.upsert', (event) => {
        if (
          this.dependencies.receiveMessages === false ||
          event.type !== 'notify' ||
          entry.intentionallyClosed ||
          this.stopping
        )
          return;
        void (async () => {
          for (const message of event.messages) {
            if (!(await this.isCurrent(entry))) return;
            const address = message.key.remoteJid ? whatsappAddress(message.key.remoteJid) : null;
            const externalId = message.key.id;
            if (!address || !externalId || message.key.fromMe) continue;
            const timestamp =
              typeof message.messageTimestamp === 'number'
                ? message.messageTimestamp
                : message.messageTimestamp?.toNumber();
            if (!timestamp || timestamp * 1000 < entry.startingAt - 10_000) continue;
            const content = extractMessageContent(message.message);
            if (
              !content ||
              content.audioMessage ||
              content.videoMessage ||
              content.imageMessage ||
              content.documentMessage
            )
              continue;
            const body = content.conversation ?? content.extendedTextMessage?.text;
            if (!body || body.length > 16_000) continue;
            await this.dependencies.api.receiveMessage(connection.tenantId, {
              connectionId: connection.id,
              externalId,
              address,
              name: message.pushName ?? address.split('@')[0]!,
              body,
              channel: 'whatsapp',
              timestamp: new Date(timestamp * 1000).toISOString(),
            });
          }
        })().catch(() =>
          this.updateStatus(
            connection,
            'needs_attention',
            'Gelen mesaj kalıcı olarak kaydedilemedi. Bağlantıyı ve veritabanını kontrol edin.',
          ).catch(() => undefined),
        );
      });
      socket.ev.on('messages.update', (events) => {
        if (!this.dependencies.receipt) return;
        for (const event of events) {
          if (!event.key.fromMe || !event.key.id) continue;
          const status = event.update.status;
          if (
            status !== proto.WebMessageInfo.Status.DELIVERY_ACK &&
            status !== proto.WebMessageInfo.Status.READ
          )
            continue;
          void this.dependencies
            .receipt(
              connection.tenantId,
              connection.id,
              event.key.id,
              status === proto.WebMessageInfo.Status.READ ? 'read' : 'delivered',
            )
            .catch(() =>
              this.updateStatus(
                connection,
                'needs_attention',
                'Mesaj teslimat bildirimi kaydedilemedi. Denetim kaydını ve veritabanını kontrol edin.',
              ).catch(() => undefined),
            );
        }
      });
    } finally {
      this.connecting.delete(key);
    }
  }

  async deliver(
    tenantId: string,
    connectionId: string,
    address: string,
    body: string,
  ): Promise<string> {
    const entry = this.active.get(`${tenantId}:${connectionId}`);
    if (!entry?.connected || !(await this.isCurrent(entry)))
      throw new WhatsAppSendError(
        false,
        'WhatsApp bağlantısı açık değil. Mesaj gönderim kuyruğunda bekliyor.',
      );
    const recipient = whatsappAddress(address);
    if (!recipient) throw new WhatsAppSendError(false, 'WhatsApp alıcısı geçersiz.');
    if (!body.trim() || body.length > 16_000)
      throw new WhatsAppSendError(false, 'Mesaj metni geçersiz.');
    try {
      const result = await entry.socket.sendMessage(recipient, {
        text: body,
        linkPreview: undefined,
      });
      if (!result?.key.id)
        throw new WhatsAppSendError(
          true,
          'Mesaj gönderimi sağlayıcıdan doğrulanamadı. Yeniden göndermeden önce inceleyin.',
        );
      return result.key.id;
    } catch {
      // Once sendMessage is invoked, a timeout can mean it was sent; blind retry risks duplicates.
      throw new WhatsAppSendError(
        true,
        'Mesajın WhatsApp tarafından kabul edilip edilmediği bilinmiyor. Personel kontrolü gerekli.',
      );
    }
  }

  private close(entry: ActiveConnection) {
    entry.intentionallyClosed = true;
    entry.connected = false;
    entry.stopAuth();
    if (entry.reconnect) clearTimeout(entry.reconnect);
    entry.socket.end(undefined);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const entries = [...this.active.values()];
    for (const entry of entries) this.close(entry);
    this.active.clear();
    await Promise.all(entries.map((entry) => entry.flushAuth()));
  }
}
