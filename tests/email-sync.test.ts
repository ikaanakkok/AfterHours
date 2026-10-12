import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertLocalDemoDatabase } from '../packages/core/src/env.js';
import { closeDb, tenantDb } from '../packages/core/src/db.js';
import * as s from '../packages/core/src/schema.js';
import {
  emailMessages,
  emailSyncStates,
  emailDraftSources,
} from '../packages/core/src/email-schema.js';
import {
  tickEmail,
  getEmailSyncViews,
  getEmailDraftReplyContext,
} from '../packages/core/src/email-sync.js';
import { readEmailMessagePage } from '../packages/core/src/integrations/email.js';
import { encryptSecret, readConnectionSecret } from '../packages/core/src/security.js';
import { defaultConfig } from '../packages/core/src/policy.js';
import { getPendingWork, processConversation } from '../packages/core/src/runtime.js';
import type { TenantContext } from '../packages/core/src/types.js';

const tenantId = randomUUID(),
  otherTenantId = randomUUID();
const now = new Date('2026-10-12T09:00:00Z');
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let owner: Pool, ctx: TenantContext;
beforeAll(async () => {
  assertLocalDemoDatabase();
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const admin = (
    await owner.query(
      "SELECT user_id FROM memberships WHERE tenant_id=$1 AND role='admin' LIMIT 1",
      ['11111111-1111-4111-8111-111111111111'],
    )
  ).rows[0];
  for (const id of [tenantId, otherTenantId]) {
    await owner.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [id, 'Email sync test']);
    await owner.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      id,
      admin.user_id,
      'admin',
    ]);
    await tenantDb(id, (db) =>
      db
        .insert(s.configurations)
        .values({ tenantId: id, version: 1, value: defaultConfig('Email test') }),
    );
  }
  ctx = { tenantId, actor: { type: 'admin', id: admin.user_id }, role: 'admin' };
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const id of [tenantId, otherTenantId]) {
    for (const table of [
      'email_draft_sources',
      'email_messages',
      'email_sync_states',
      'drafts',
      'messages',
      'conversations',
      'secrets',
      'audit',
      'connections',
    ])
      await owner.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [id]);
  }
});
afterAll(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await owner.query('DELETE FROM configurations WHERE tenant_id=$1', [id]);
    await owner.query('DELETE FROM memberships WHERE tenant_id=$1', [id]);
    await owner.query('DELETE FROM tenants WHERE id=$1', [id]);
  }
  await closeDb();
  await owner.end();
});
async function channel(kind = 'gmail', config = {}, tenant = tenantId) {
  const id = randomUUID();
  await tenantDb(tenant, async (db) => {
    await db.insert(s.connections).values({
      tenantId: tenant,
      id,
      name: 'Email',
      kind,
      purpose: 'Reply drafts',
      status: 'ready',
      realAccountVerified: true,
      config: {
        accountEmail: 'business@example.test',
        emailSync: { enabled: true, draftEnabled: true },
        ...config,
      },
      permissions: ['email.read', 'email.draft'],
      agents: ['admin', 'customer'],
    });
    await db.insert(s.secrets).values({
      tenantId: tenant,
      connectionId: id,
      ciphertext: await encryptSecret(tenant, id, { accessToken: 'fake-email-access' }),
    });
  });
  return id;
}
async function ai() {
  const id = randomUUID();
  await tenantDb(tenantId, async (db) => {
    await db.insert(s.connections).values({
      tenantId,
      id,
      name: 'Selected test provider',
      kind: 'ai_provider',
      purpose: 'Controlled AI',
      status: 'ready',
      realAccountVerified: true,
      config: { enabled: true, provider: 'openai', model: 'gpt-4.1-mini' },
    });
    await db.insert(s.secrets).values({
      tenantId,
      connectionId: id,
      ciphertext: await encryptSecret(tenantId, id, { apiKey: 'fake-ai-access' }),
    });
  });
}
function gmail(id: string, threadId = 'thread-one', body = 'Merhaba 👋 yardım istiyorum') {
  return {
    id,
    threadId,
    internalDate: String(now.getTime() - 1000),
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Ayşe <ayse@example.test>' },
        { name: 'Subject', value: `Talep ${threadId}` },
        { name: 'Message-ID', value: `<${id}@example.test>` },
      ],
      body: { data: Buffer.from(body).toString('base64url') },
    },
  };
}
function provider(body = 'Merhaba, talebiniz için ayrıntıları paylaşır mısınız?') {
  return json({
    choices: [{ message: { content: JSON.stringify({ subject: 'Re: Talep', body }) } }],
  });
}
const run = (at = now, maxPagesPerConnection = 2) =>
  tickEmail({ now: at, tenantIds: [tenantId], maxPagesPerConnection });

describe('account-scoped email pagination', () => {
  it('uses the seven-day bound and resumes a Gmail page without automatic writes', async () => {
    const mock = vi.fn(async (url: string | URL) =>
      String(url).includes('/messages?')
        ? json({ messages: [{ id: 'g1' }], nextPageToken: 'next' })
        : json(gmail('g1')),
    );
    vi.stubGlobal('fetch', mock);
    const result = await readEmailMessagePage(
      'gmail',
      {},
      { accessToken: 'fake' },
      { since: '2026-10-05T09:00:00Z', until: now.toISOString(), limit: 25, cursor: 'previous' },
    );
    const query = new URL(String(mock.mock.calls[0]![0]));
    expect(query.searchParams.get('q')).toContain(
      `after:${Math.floor(Date.parse('2026-10-05T09:00:00Z') / 1000)}`,
    );
    expect(query.searchParams.get('pageToken')).toBe('previous');
    expect(result.nextCursor).toBe('next');
    expect(result.messages[0]).toMatchObject({
      threadId: 'thread-one',
      internetMessageId: '<g1@example.test>',
      address: 'ayse@example.test',
    });
    expect(mock.mock.calls.every(([url]) => !String(url).endsWith('/send'))).toBe(true);
  });
  it('follows Outlook pages only for the trusted inbox origin and includes conversation identity', async () => {
    const next = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=next';
    const mock = vi.fn(async () =>
      json({
        value: [
          {
            id: 'o1',
            conversationId: 'outlook-thread',
            internetMessageId: '<o1@example.test>',
            subject: 'Soru',
            from: { emailAddress: { address: 'a@example.test', name: 'A' } },
            body: { contentType: 'Text', content: 'Soru' },
            receivedDateTime: new Date(now.getTime() - 1000).toISOString(),
          },
        ],
        '@odata.nextLink': next,
      }),
    );
    vi.stubGlobal('fetch', mock);
    const result = await readEmailMessagePage(
      'outlook',
      {},
      { accessToken: 'fake' },
      { since: '2026-10-05T09:00:00Z', until: now.toISOString() },
    );
    expect(result.nextCursor).toBe(next);
    expect(result.messages[0]?.threadId).toBe('outlook-thread');
    await expect(
      readEmailMessagePage(
        'outlook',
        {},
        { accessToken: 'fake' },
        { cursor: 'https://evil.example.test/inbox' },
      ),
    ).rejects.toThrow();
    await expect(
      readEmailMessagePage(
        'outlook',
        {},
        { accessToken: 'fake' },
        { cursor: 'https://graph.microsoft.com/v1.0/me/drive/root' },
      ),
    ).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('persisted ingestion and reply drafts', () => {
  it('keeps two participants in one provider thread and addresses each draft to its source sender', async () => {
    await channel();
    await ai();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('/chat/completions')) return provider();
        if (String(url).includes('/messages?'))
          return json({ messages: [{ id: 'g1' }, { id: 'g2' }] });
        const second = String(url).includes('/g2?');
        const record = gmail(second ? 'g2' : 'g1');
        if (second) record.payload.headers[0]!.value = 'Bob <bob@example.test>';
        return json(record);
      }),
    );
    await run();
    expect(await tenantDb(tenantId, (db) => db.select().from(s.conversations))).toHaveLength(1);
    const records = await tenantDb(tenantId, (db) => db.select().from(emailMessages));
    expect(records.map((m) => m.sourceAddress).sort()).toEqual([
      'ayse@example.test',
      'bob@example.test',
    ]);
    const drafts = await tenantDb(tenantId, (db) => db.select().from(s.drafts));
    expect(drafts.map((d) => d.to).sort()).toEqual(['ayse@example.test', 'bob@example.test']);
    for (const draft of drafts)
      expect((await getEmailDraftReplyContext(tenantId, draft.id)).threadId).toBe('thread-one');
    const conversation = (await tenantDb(tenantId, (db) => db.select().from(s.conversations)))[0]!;
    await tenantDb(tenantId, async (db) => {
      await db
        .update(s.conversations)
        .set({ lastProcessedId: null })
        .where(eq(s.conversations.id, conversation.id));
      const value = {
        ...defaultConfig('Email test'),
        version: 2,
        automationEnabled: true,
        activeHours: Array.from({ length: 7 }, (_, day) => ({ day, start: '00:00', end: '24:00' })),
      };
      await db.insert(s.configurations).values({ tenantId, version: 2, value });
    });
    expect(
      (await getPendingWork()).conversations.some(
        (c) => c.tenantId === tenantId && c.conversationId === conversation.id,
      ),
    ).toBe(false);
    await processConversation(tenantId, conversation.id);
    expect(
      (await tenantDb(tenantId, (db) => db.select().from(s.messages))).some(
        (m) => m.direction === 'outbound',
      ),
    ).toBe(false);
  });
  it('commits each page, resumes after interruption, and keeps same sender threads separate', async () => {
    const id = await channel();
    await ai();
    let failSecondPage = true;
    const mock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/chat/completions')) return provider();
      if (String(url).includes('/messages?')) {
        const query = new URL(String(url));
        expect(query.searchParams.get('q')).toContain(
          `after:${Math.floor((now.getTime() - 7 * 86400_000) / 1000)}`,
        );
        if (query.searchParams.get('pageToken') === 'second') {
          if (failSecondPage) return json({ error: 'temporary' }, 503);
          return json({ messages: [{ id: 'g2' }] });
        }
        return json({ messages: [{ id: 'g1' }], nextPageToken: 'second' });
      }
      return json(
        gmail(
          String(url).includes('/g2?') ? 'g2' : 'g1',
          String(url).includes('/g2?') ? 'thread-two' : 'thread-one',
        ),
      );
    });
    vi.stubGlobal('fetch', mock);
    await run();
    let state = (await tenantDb(tenantId, (db) => db.select().from(emailSyncStates)))[0]!;
    expect(state.cursor).toBe('second');
    expect(await tenantDb(tenantId, (db) => db.select().from(s.messages))).toHaveLength(1);
    failSecondPage = false;
    await run(new Date(now.getTime() + 61_000));
    state = (await tenantDb(tenantId, (db) => db.select().from(emailSyncStates)))[0]!;
    expect(state.cursor).toBeNull();
    const convos = await tenantDb(tenantId, (db) => db.select().from(s.conversations));
    expect(convos).toHaveLength(2);
    expect(new Set(convos.map((c) => c.threadKey)).size).toBe(2);
    const metadata = await tenantDb(tenantId, (db) => db.select().from(emailMessages));
    expect(metadata.map((m) => m.threadId).sort()).toEqual(['thread-one', 'thread-two']);
    expect(
      metadata.every((m) => m.sourceDate instanceof Date && m.subject.startsWith('Talep')),
    ).toBe(true);
    expect(await tenantDb(tenantId, (db) => db.select().from(s.drafts))).toHaveLength(2);
    expect(await tenantDb(tenantId, (db) => db.select().from(emailDraftSources))).toHaveLength(2);
    await run(new Date(now.getTime() + 122_000));
    expect(await tenantDb(tenantId, (db) => db.select().from(s.drafts))).toHaveLength(2);
    expect(mock.mock.calls.some(([url]) => String(url).endsWith('/send'))).toBe(false);
    expect(
      (await tenantDb(tenantId, (db) => db.select().from(s.messages))).every(
        (m) => m.direction === 'inbound',
      ),
    ).toBe(true);
    expect(
      (await getEmailSyncViews(ctx)).find((v) => v.connectionId === id)?.pendingDraftCount,
    ).toBe(0);
  });
  it('polls once per sixty seconds and never drafts until the selected AI is ready', async () => {
    await channel();
    const mock = vi.fn(async (url: string | URL) =>
      String(url).includes('/chat/completions')
        ? provider()
        : String(url).includes('/messages?')
          ? json({ messages: [{ id: 'g1' }] })
          : json(gmail('g1')),
    );
    vi.stubGlobal('fetch', mock);
    await run();
    expect(await tenantDb(tenantId, (db) => db.select().from(s.drafts))).toHaveLength(0);
    expect(
      (await tenantDb(tenantId, (db) => db.select().from(emailMessages)))[0]?.draftStatus,
    ).toBe('pending');
    const before = mock.mock.calls.length;
    await run(new Date(now.getTime() + 30_000));
    expect(mock).toHaveBeenCalledTimes(before);
    await ai();
    await run(new Date(now.getTime() + 61_000));
    expect(await tenantDb(tenantId, (db) => db.select().from(s.drafts))).toHaveLength(1);
    expect(mock.mock.calls.some(([url]) => String(url).endsWith('/send'))).toBe(false);
  });
  it('does not ingest without explicit opt-in and rechecks revoked permissions before page commit', async () => {
    const id = await channel('gmail', { emailSync: { enabled: false, draftEnabled: true } });
    const mock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/messages?')) return json({ messages: [{ id: 'g1' }] });
      await tenantDb(tenantId, (db) =>
        db.update(s.connections).set({ permissions: [] }).where(eq(s.connections.id, id)),
      );
      return json(gmail('g1'));
    });
    vi.stubGlobal('fetch', mock);
    await run();
    expect(mock).not.toHaveBeenCalled();
    await tenantDb(tenantId, (db) =>
      db
        .update(s.connections)
        .set({
          config: {
            accountEmail: 'business@example.test',
            emailSync: { enabled: true, draftEnabled: true },
          },
        })
        .where(eq(s.connections.id, id)),
    );
    await run(new Date(now.getTime() + 61_000));
    expect(await tenantDb(tenantId, (db) => db.select().from(s.messages))).toHaveLength(0);
    expect(await tenantDb(tenantId, (db) => db.select().from(s.drafts))).toHaveLength(0);
  });
  it('keeps read-only ingestion independent from draft grant and prevents cross-tenant reads', async () => {
    const id = await channel();
    await ai();
    await tenantDb(tenantId, (db) =>
      db
        .update(s.connections)
        .set({ permissions: ['email.read'] })
        .where(eq(s.connections.id, id)),
    );
    const mock = vi.fn(async (url: string | URL) =>
      String(url).includes('/messages?') ? json({ messages: [{ id: 'g1' }] }) : json(gmail('g1')),
    );
    vi.stubGlobal('fetch', mock);
    await run();
    expect(await tenantDb(tenantId, (db) => db.select().from(s.messages))).toHaveLength(1);
    expect(await tenantDb(tenantId, (db) => db.select().from(s.drafts))).toHaveLength(0);
    expect(await tenantDb(otherTenantId, (db) => db.select().from(emailMessages))).toEqual([]);
    expect(await tenantDb(otherTenantId, (db) => db.select().from(emailSyncStates))).toEqual([]);
    expect(mock.mock.calls.some(([url]) => String(url).includes('/chat/completions'))).toBe(false);
  });
  it('claims one worker per connection and preserves refreshed encrypted tokens after provider failure', async () => {
    const id = await channel('outlook');
    await tenantDb(tenantId, (db) =>
      db.update(s.secrets).set({ ciphertext: '' }).where(eq(s.secrets.connectionId, id)),
    );
    const ciphertext = await encryptSecret(tenantId, id, {
      clientId: 'fake',
      accessToken: 'expired',
      refreshToken: 'old-refresh',
      expiresAt: '2020-01-01T00:00:00Z',
    });
    await tenantDb(tenantId, (db) =>
      db.update(s.secrets).set({ ciphertext }).where(eq(s.secrets.connectionId, id)),
    );
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/token')) {
        await blocked;
        return json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
      }
      return json({ error: 'provider private error' }, 503);
    });
    vi.stubGlobal('fetch', mock);
    const first = run();
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    await run();
    expect(mock).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(await readConnectionSecret(tenantId, id)).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    expect((await getEmailSyncViews(ctx))[0]?.lastError).not.toContain('private');
  });
  it('binds a reply draft to its source account and recipient before explicit sending', async () => {
    const id = await channel();
    await ai();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('/chat/completions')
          ? provider()
          : String(url).includes('/messages?')
            ? json({ messages: [{ id: 'g1' }] })
            : json(gmail('g1')),
      ),
    );
    await run();
    const draft = (await tenantDb(tenantId, (db) => db.select().from(s.drafts)))[0]!;
    expect(await getEmailDraftReplyContext(tenantId, draft.id)).toEqual({
      threadId: 'thread-one',
      inReplyTo: '<g1@example.test>',
      sourceMessageId: 'g1',
    });
    expect(await getEmailDraftReplyContext(otherTenantId, draft.id)).toEqual({});
    await tenantDb(tenantId, (db) =>
      db
        .update(s.drafts)
        .set({ subject: 'Different conversation' })
        .where(eq(s.drafts.id, draft.id)),
    );
    await expect(getEmailDraftReplyContext(tenantId, draft.id)).rejects.toMatchObject({
      code: 'EMAIL_SOURCE_CHANGED',
    });
    await tenantDb(tenantId, (db) =>
      db.update(s.drafts).set({ subject: draft.subject }).where(eq(s.drafts.id, draft.id)),
    );
    await tenantDb(tenantId, (db) =>
      db.update(s.drafts).set({ to: 'different@example.test' }).where(eq(s.drafts.id, draft.id)),
    );
    await expect(getEmailDraftReplyContext(tenantId, draft.id)).rejects.toMatchObject({
      code: 'EMAIL_SOURCE_CHANGED',
    });
    await tenantDb(tenantId, (db) =>
      db.update(s.drafts).set({ to: draft.to }).where(eq(s.drafts.id, draft.id)),
    );
    await tenantDb(tenantId, (db) =>
      db
        .update(s.connections)
        .set({
          config: {
            accountEmail: 'new-account@example.test',
            emailSync: { enabled: true, draftEnabled: true },
          },
        })
        .where(eq(s.connections.id, id)),
    );
    await expect(getEmailDraftReplyContext(tenantId, draft.id)).rejects.toMatchObject({
      code: 'EMAIL_SOURCE_CHANGED',
    });
  });
  it('does not overwrite newer credentials when a concurrent reconnect rotates the vault', async () => {
    const id = await channel('outlook');
    const original = await encryptSecret(tenantId, id, {
      clientId: 'fake',
      refreshToken: 'old-refresh',
    });
    const newer = await encryptSecret(tenantId, id, {
      accessToken: 'newer-account-access',
      refreshToken: 'newer-refresh',
    });
    await tenantDb(tenantId, (db) =>
      db.update(s.secrets).set({ ciphertext: original }).where(eq(s.secrets.connectionId, id)),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('/token')) {
          await tenantDb(tenantId, (db) =>
            db.update(s.secrets).set({ ciphertext: newer }).where(eq(s.secrets.connectionId, id)),
          );
          return json({ access_token: 'stale-rotation', refresh_token: 'stale-refresh' });
        }
        return json({ error: 'unavailable' }, 503);
      }),
    );
    await run();
    expect(await readConnectionSecret(tenantId, id)).toEqual({
      accessToken: 'newer-account-access',
      refreshToken: 'newer-refresh',
    });
  });
  it('discards a generated draft if its permission is revoked while the AI responds', async () => {
    const id = await channel();
    await ai();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('/chat/completions')) {
          await tenantDb(tenantId, (db) =>
            db
              .update(s.connections)
              .set({ permissions: ['email.read'] })
              .where(eq(s.connections.id, id)),
          );
          return provider();
        }
        return String(url).includes('/messages?')
          ? json({ messages: [{ id: 'g1' }] })
          : json(gmail('g1'));
      }),
    );
    await run();
    expect(await tenantDb(tenantId, (db) => db.select().from(s.drafts))).toHaveLength(0);
    expect(await tenantDb(tenantId, (db) => db.select().from(s.messages))).toHaveLength(1);
  });
});

describe('email adapter boundaries', () => {
  it('accepts empty pages and rejects invalid bounds before sending credentials', async () => {
    const mock = vi.fn(async () => json({ messages: [] }));
    vi.stubGlobal('fetch', mock);
    expect(await readEmailMessagePage('gmail', {}, { accessToken: 'fake' })).toEqual({
      messages: [],
      nextCursor: null,
    });
    for (const options of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { since: 'bad' },
      { until: 'bad' },
      { since: now.toISOString(), until: now.toISOString() },
    ])
      await expect(
        readEmailMessagePage('gmail', {}, { accessToken: 'fake' }, options),
      ).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('does not silently truncate a malformed pagination response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ messages: [], nextPageToken: 10 })),
    );
    await expect(readEmailMessagePage('gmail', {}, { accessToken: 'fake' })).rejects.toThrow(
      'sayfa kimliği',
    );
  });
  it('rejects a provider page larger than the configured bound without reading ten thousand messages', async () => {
    const mock = vi.fn(async () =>
      json({ messages: Array.from({ length: 10_001 }, (_, i) => ({ id: `g${i}` })) }),
    );
    vi.stubGlobal('fetch', mock);
    await expect(readEmailMessagePage('gmail', {}, { accessToken: 'fake' })).rejects.toThrow(
      'sınırını',
    );
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
