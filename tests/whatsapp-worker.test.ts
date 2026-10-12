import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConnection, WhatsAppDependencies } from '../apps/worker/src/whatsapp.js';

const mocks = vi.hoisted(() => ({
  sockets: [] as Array<{
    user: { id: string } | undefined;
    handlers: Map<string, (event: any) => void>;
    sendMessage: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock('../packages/core/src/index.js', () => ({ WHATSAPP_QR_TTL_MS: 30_000 }));
import { WhatsAppManager, whatsappAddress } from '../apps/worker/src/whatsapp.js';
type SocketFactory = NonNullable<ConstructorParameters<typeof WhatsAppManager>[1]>;

let current: WorkerConnection[];
let dependencies: WhatsAppDependencies;
let manager: WhatsAppManager;
const settle = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
};
beforeEach(() => {
  mocks.sockets.length = 0;
  current = [
    {
      tenantId: 'tenant',
      id: 'channel',
      kind: 'whatsapp',
      name: 'WhatsApp',
      purpose: 'Support',
      config: { mode: 'live', linkRequested: true, linkAttempt: 1 },
      status: 'awaiting_test',
      hasCredentials: false,
      realAccountVerified: false,
      agents: ['admin'],
      permissions: ['message.send'],
      lastError: null,
      lastTestAt: null,
    },
  ];
  dependencies = {
    api: {
      receiveMessage: vi.fn(async () => ({ conversationId: 'conversation', duplicate: false })),
    } as unknown as WhatsAppDependencies['api'],
    connections: async () => current,
    protocolVersion: vi.fn(async () => [2, 3000, 1050031415] as [number, number, number]),
    readSecret: vi.fn(async () => ({})),
    writeSecret: vi.fn(async () => {}),
    updateStatus: vi.fn(async () => {}),
    setQr: vi.fn(async () => {}),
  };
  const socketFactory: SocketFactory = () => {
    const socket = {
      user: { id: '90000@s.whatsapp.net' } as { id: string } | undefined,
      handlers: new Map<string, (event: any) => void>(),
      sendMessage: vi.fn(async () => ({ key: { id: 'accepted-message' } })),
      end: vi.fn(),
      ev: {
        on: (name: string, handler: (event: any) => void) => socket.handlers.set(name, handler),
      },
    };
    mocks.sockets.push(socket);
    return socket as unknown as ReturnType<SocketFactory>;
  };
  manager = new WhatsAppManager(dependencies, socketFactory);
});
async function connected() {
  await manager.refresh();
  const socket = mocks.sockets[0]!;
  socket.handlers.get('connection.update')!({ connection: 'open' });
  await settle();
  return socket;
}
function inbound(address: string, content: unknown = { conversation: 'Question' }) {
  return {
    type: 'notify',
    messages: [
      {
        key: { id: 'inbound-id', remoteJid: address },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: content,
      },
    ],
  };
}
describe('Baileys connection lifecycle', () => {
  it('fails closed before opening a socket when a protocol version is malformed', async () => {
    dependencies.protocolVersion = async () => [2, 3000, Number.NaN];
    await manager.refresh();
    expect(mocks.sockets).toHaveLength(0);
    expect(dependencies.updateStatus).toHaveBeenCalledWith(
      'tenant',
      'channel',
      'needs_attention',
      expect.any(String),
      undefined,
      1,
    );
    await manager.stop();
  });
  it('waits for encrypted credential writes before shutdown completes', async () => {
    const socket = await connected();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(dependencies.writeSecret).mockImplementationOnce(() => pending);
    socket.handlers.get('creds.update')!({});
    await settle();
    let stopped = false;
    const shutdown = manager.stop().then(() => {
      stopped = true;
    });
    await settle();
    expect(stopped).toBe(false);
    release();
    await shutdown;
    expect(stopped).toBe(true);
  });
  it('pairs without ingesting messages when the shared worker is paused', async () => {
    dependencies.receiveMessages = false;
    const socket = await connected();
    socket.handlers.get('messages.upsert')!(inbound('123@s.whatsapp.net'));
    await settle();
    expect(dependencies.api.receiveMessage).not.toHaveBeenCalled();
    expect(dependencies.updateStatus).toHaveBeenCalledWith(
      'tenant',
      'channel',
      'ready',
      undefined,
      true,
      1,
    );
    await manager.stop();
  });
  it('normalizes direct/LID identities and rejects group, status and malformed recipients', async () => {
    expect(whatsappAddress('123:4@lid')).toBe('123@lid');
    expect(whatsappAddress('123:4@s.whatsapp.net')).toBe('123@s.whatsapp.net');
    for (const value of ['123@g.us', 'status@broadcast', 'bad@lid', '123@newsletter'])
      expect(whatsappAddress(value)).toBeNull();
    const socket = await connected();
    socket.handlers.get('messages.upsert')!(inbound('123:4@lid'));
    await settle();
    expect(dependencies.api.receiveMessage).toHaveBeenCalledWith(
      'tenant',
      expect.objectContaining({ address: '123@lid' }),
    );
    await manager.deliver('tenant', 'channel', '123:4@lid', 'Reply');
    expect(socket.sendMessage).toHaveBeenCalledWith(
      '123@lid',
      expect.objectContaining({ text: 'Reply' }),
    );
    await manager.stop();
  });
  it('refuses sends and ignores messages immediately after disable or relink, before refresh', async () => {
    const socket = await connected();
    current = [{ ...current[0]!, config: { ...current[0]!.config, linkAttempt: 2 } }];
    await expect(
      manager.deliver('tenant', 'channel', '123@s.whatsapp.net', 'Reply'),
    ).rejects.toMatchObject({ safeToRetry: true });
    socket.handlers.get('messages.upsert')!(inbound('123@s.whatsapp.net'));
    await settle();
    expect(dependencies.api.receiveMessage).not.toHaveBeenCalled();
    expect(socket.sendMessage).not.toHaveBeenCalled();
    current = [{ ...current[0]!, status: 'disabled' }];
    await manager.refresh();
    expect(socket.end).toHaveBeenCalled();
    await manager.stop();
  });
  it('does not report ready without the authenticated account identity', async () => {
    await manager.refresh();
    const socket = mocks.sockets[0]!;
    socket.user = undefined;
    socket.handlers.get('connection.update')!({ connection: 'open' });
    await settle();
    expect(dependencies.updateStatus).not.toHaveBeenCalledWith(
      'tenant',
      'channel',
      'ready',
      undefined,
      true,
      1,
    );
    expect(socket.end).toHaveBeenCalled();
    await manager.stop();
  });
  it('retains unknown-outcome protection and skips excluded voice messages', async () => {
    const socket = await connected();
    socket.sendMessage.mockRejectedValueOnce(new Error('provider timeout'));
    await expect(
      manager.deliver('tenant', 'channel', '123@s.whatsapp.net', 'Reply'),
    ).rejects.toMatchObject({ uncertain: true, safeToRetry: false });
    socket.handlers.get('messages.upsert')!(inbound('123@s.whatsapp.net', { audioMessage: {} }));
    await settle();
    expect(dependencies.api.receiveMessage).not.toHaveBeenCalled();
    await manager.stop();
  });
});
