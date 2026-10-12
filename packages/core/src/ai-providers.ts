import { and, eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { tenantDb } from './db.js';
import { connections, secrets } from './schema.js';
import { assertMembership } from './context.js';
import { requireAdmin, HttpError } from './errors.js';
import { encryptSecret, readConnectionSecret, stableHash } from './security.js';
import { log } from './store.js';
import type { TenantContext, JsonObject, CommandResult } from './types.js';
import type { AIProviderKind, AIProviderView } from './context-types.js';

/** Vendor endpoints are application authority; callers cannot supply a destination for credentials. */
export const aiProviderCatalog = [
  {
    provider: 'opencode_go' as const,
    name: 'OpenCode Go',
    defaultModel: 'glm-5.3-flash',
    endpoint: 'https://opencode.ai/zen/go/v1/chat/completions',
    documentation: 'https://opencode.ai/docs/go/',
    models: [
      'glm-5.3-flash',
      'glm-5.3',
      'glm-5.2',
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.6',
      'deepseek-v4-flash-vision-exp',
      'deepseek-v4.1-flash',
      'deepseek-v4-flash',
      'mimo-v2.6-flash',
    ],
    note: 'Go kodlama ajanları için tasarlanmıştır. AfterHours kullanımının sağlayıcı koşullarıyla uyumu ve görsel destek gerçek hesapla doğrulanmalıdır.',
  },
  {
    provider: 'openai' as const,
    name: 'OpenAI',
    defaultModel: 'gpt-4.1-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    documentation:
      'https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create',
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'],
  },
];
const saveSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120),
    provider: z.enum(['opencode_go', 'openai']),
    model: z.string().trim().min(1).max(100),
    apiKey: z.string().trim().min(8).max(500).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export async function getAIProviders(ctx: TenantContext): Promise<AIProviderView[]> {
  await assertMembership(ctx);
  requireAdmin(ctx.role);
  return tenantDb(ctx.tenantId, async (db) => {
    const rows = await db
      .select()
      .from(connections)
      .where(eq(connections.kind, 'ai_provider'))
      .orderBy(desc(connections.createdAt));
    const keys = await db.select({ id: secrets.connectionId }).from(secrets);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.config.provider as AIProviderKind,
      model: String(row.config.model ?? ''),
      enabled: row.config.enabled === true,
      status: row.status,
      hasCredentials: keys.some((k) => k.id === row.id),
      lastError: row.lastError,
      lastTestAt: row.lastTestAt?.toISOString() ?? null,
    }));
  });
}
export async function handleProviderCommand(
  ctx: TenantContext,
  action: string,
  payload: unknown,
): Promise<CommandResult> {
  await assertMembership(ctx);
  requireAdmin(ctx.role);
  if (action === 'provider.save') {
    const parsed = saveSchema.safeParse(payload);
    if (!parsed.success)
      throw new HttpError(400, 'VALIDATION_ERROR', 'Sağlayıcı bilgilerini kontrol edin.');
    const data = parsed.data;
    const catalog = aiProviderCatalog.find((p) => p.provider === data.provider)!;
    if (!catalog.models.includes(data.model))
      throw new HttpError(
        400,
        'MODEL_UNSUPPORTED',
        'Bu sağlayıcı için desteklenen model listesinden seçim yapın.',
      );
    const id = data.id ?? crypto.randomUUID();
    const ciphertext = data.apiKey
      ? await encryptSecret(ctx.tenantId, id, { apiKey: data.apiKey })
      : null;
    await tenantDb(ctx.tenantId, async (db) => {
      await db.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':ai-providers'},0))`,
      );
      const existing = (await db.select().from(connections).where(eq(connections.id, id)))[0];
      if (data.id && (!existing || existing.kind !== 'ai_provider'))
        throw new HttpError(404, 'NOT_FOUND', 'Sağlayıcı bulunamadı.');
      const hasSecret = !!(await db.select().from(secrets).where(eq(secrets.connectionId, id)))[0];
      if (existing && existing.config.provider !== data.provider && !ciphertext)
        throw new HttpError(400, 'KEY_REQUIRED', 'Sağlayıcı değişirken yeni API anahtarı girin.');
      const changed =
        !existing ||
        ciphertext ||
        existing.config.model !== data.model ||
        existing.config.provider !== data.provider;
      const enabled = data.enabled ?? existing?.config.enabled === true;
      if (enabled)
        for (const other of await db
          .select()
          .from(connections)
          .where(eq(connections.kind, 'ai_provider')))
          if (other.id !== id && other.config.enabled === true)
            await db
              .update(connections)
              .set({ config: { ...other.config, enabled: false } })
              .where(eq(connections.id, other.id));
      const values = {
        name: data.name,
        kind: 'ai_provider',
        purpose: 'Context ve workflow metin analizi',
        status:
          !ciphertext && !hasSecret ? 'missing_info' : changed ? 'awaiting_test' : existing!.status,
        config: { provider: data.provider, model: data.model, enabled },
        permissions: [] as string[],
        agents: ['admin'],
        realAccountVerified: changed ? false : existing!.realAccountVerified,
      };
      if (existing)
        await db
          .update(connections)
          .set({ ...values, lastError: null })
          .where(eq(connections.id, id));
      else await db.insert(connections).values({ tenantId: ctx.tenantId, id, ...values });
      if (ciphertext)
        await db
          .insert(secrets)
          .values({ tenantId: ctx.tenantId, connectionId: id, ciphertext })
          .onConflictDoUpdate({
            target: [secrets.tenantId, secrets.connectionId],
            set: { ciphertext },
          });
      await log(db, ctx.tenantId, ctx.actor, 'provider.saved', id, {
        provider: data.provider,
        model: data.model,
        enabled,
        credentialsChanged: !!ciphertext,
      });
    });
    return {
      message: 'Sağlayıcı kaydedildi. Kullanım öncesinde bağlantıyı test edin.',
      data: { id },
    };
  }
  if (action === 'provider.test') {
    const { id } = z.object({ id: z.string().uuid() }).parse(payload);
    const fingerprint = await providerFingerprint(ctx.tenantId, id);
    try {
      const result = await callProvider(
        ctx.tenantId,
        id,
        'provider-test',
        'Return only the JSON object {"ok":true}. No tools.',
        'Connection verification.',
      );
      if (
        !result ||
        typeof result !== 'object' ||
        Array.isArray(result) ||
        (result as JsonObject).ok !== true ||
        Object.keys(result).length !== 1
      )
        throw new Error('Connection test response invalid');
      await tenantDb(ctx.tenantId, async (db) => {
        await db.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':ai-providers'},0))`,
        );
        if ((await providerFingerprint(ctx.tenantId, id, db)) !== fingerprint)
          throw new HttpError(
            409,
            'PROVIDER_CHANGED',
            'Sağlayıcı test sırasında değişti. Yeniden test edin.',
          );
        await db
          .update(connections)
          .set({
            status: 'ready',
            lastError: null,
            lastTestAt: new Date(),
            realAccountVerified: true,
          })
          .where(eq(connections.id, id));
        await log(db, ctx.tenantId, ctx.actor, 'provider.tested', id, { verified: true });
      });
      return { message: 'Sağlayıcı bağlantısı doğrulandı.', data: { id, verified: true } };
    } catch (error) {
      if (error instanceof HttpError && error.code === 'PROVIDER_CHANGED') throw error;
      const message =
        'API bağlantısı doğrulanamadı. Anahtar, abonelik ve model erişimini kontrol edin.';
      await tenantDb(ctx.tenantId, async (db) => {
        await db.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':ai-providers'},0))`,
        );
        if ((await providerFingerprint(ctx.tenantId, id, db)) !== fingerprint)
          throw new HttpError(
            409,
            'PROVIDER_CHANGED',
            'Sağlayıcı test sırasında değişti. Yeniden test edin.',
          );
        await db
          .update(connections)
          .set({
            status: 'needs_attention',
            lastError: message,
            lastTestAt: new Date(),
            realAccountVerified: false,
          })
          .where(and(eq(connections.id, id), eq(connections.kind, 'ai_provider')));
        await log(db, ctx.tenantId, ctx.actor, 'provider.tested', id, { verified: false });
      });
      return { message, data: { id, verified: false } };
    }
  }
  throw new HttpError(400, 'UNKNOWN_COMMAND', 'Bilinmeyen sağlayıcı işlemi.');
}
export async function generateProviderJson(
  ctx: TenantContext,
  task: string,
  system: string,
  input: unknown,
  images?: Array<{ mime: string; base64: string }>,
): Promise<unknown> {
  await assertMembership(ctx);
  requireAdmin(ctx.role);
  return generateTenantProviderJson(ctx.tenantId, task, system, input, images);
}
/** Internal executor entry point. HTTP callers must use the authenticated wrapper. */
export async function generateTenantProviderJson(
  tenantId: string,
  task: string,
  system: string,
  input: unknown,
  images?: Array<{ mime: string; base64: string }>,
): Promise<unknown> {
  const rows = await tenantDb(tenantId, (db) =>
    db
      .select()
      .from(connections)
      .where(eq(connections.kind, 'ai_provider'))
      .orderBy(desc(connections.createdAt)),
  );
  const provider = rows.find((row) => row.config.enabled === true && row.status === 'ready');
  if (!provider)
    throw new HttpError(
      409,
      'AI_PROVIDER_REQUIRED',
      'AI Providers altında API anahtarı ekleyip bağlantıyı test edin.',
    );
  return callProvider(tenantId, provider.id, task, system, JSON.stringify(input), images);
}
async function providerFingerprint(
  tenantId: string,
  id: string,
  db?: import('./db.js').TenantDb,
): Promise<string> {
  const read = async (tx: import('./db.js').TenantDb) => {
    const row = (
      await tx
        .select()
        .from(connections)
        .where(and(eq(connections.id, id), eq(connections.kind, 'ai_provider')))
    )[0];
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Sağlayıcı bulunamadı.');
    const key = (await tx.select().from(secrets).where(eq(secrets.connectionId, id)))[0];
    return stableHash({ config: row.config, key: key?.ciphertext ?? null });
  };
  return db ? read(db) : tenantDb(tenantId, read);
}
async function callProvider(
  tenantId: string,
  id: string,
  task: string,
  system: string,
  input: string,
  images?: Array<{ mime: string; base64: string }>,
): Promise<unknown> {
  const row = await tenantDb(
    tenantId,
    async (db) =>
      (
        await db
          .select()
          .from(connections)
          .where(and(eq(connections.id, id), eq(connections.kind, 'ai_provider')))
      )[0],
  );
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Sağlayıcı bulunamadı.');
  const catalog = aiProviderCatalog.find((p) => p.provider === row.config.provider);
  if (!catalog || !catalog.models.includes(String(row.config.model)))
    throw new HttpError(400, 'MODEL_UNSUPPORTED', 'Model desteklenmiyor.');
  if (input.length > 300_000)
    throw new HttpError(
      413,
      'CONTEXT_TOO_LARGE',
      'Context bu analiz için fazla büyük. Belgeleri küçük bölümlere ayırın.',
    );
  if (
    images?.length &&
    row.config.provider === 'opencode_go' &&
    row.config.model !== 'deepseek-v4-flash-vision-exp'
  )
    throw new HttpError(
      409,
      'VISION_MODEL_REQUIRED',
      'Görselleri anlamak için görsel destekli model seçip test edin.',
    );
  const key = (await readConnectionSecret(tenantId, id)).apiKey;
  if (typeof key !== 'string' || !key)
    throw new HttpError(409, 'AI_PROVIDER_REQUIRED', 'API anahtarı eksik.');
  const content = images?.length
    ? [
        { type: 'text', text: input },
        ...images.map((image) => ({
          type: 'image_url',
          image_url: { url: `data:${image.mime};base64,${image.base64}` },
        })),
      ]
    : input;
  const response = await fetch(catalog.endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': 'AfterHours/0.1',
      'x-opencode-session': `${tenantId}:${task}`,
    },
    body: JSON.stringify({
      model: row.config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      response_format: { type: 'json_object' },
      ...(row.config.provider === 'openai'
        ? { max_completion_tokens: 5000, store: false }
        : { max_tokens: 5000 }),
      temperature: 0.1,
    }),
  });
  if (!response.ok)
    throw new HttpError(
      502,
      'PROVIDER_REJECTED',
      `AI sağlayıcısı analizi reddetti (${response.status}).`,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, 'PROVIDER_INVALID', 'AI yanıtı okunamadı.');
  let text = '';
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > 1_000_000) {
      await reader.cancel();
      throw new HttpError(502, 'PROVIDER_INVALID', 'AI yanıtı çok büyük.');
    }
  }
  const body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  const value = body.choices?.[0]?.message?.content;
  if (typeof value !== 'string')
    throw new HttpError(502, 'PROVIDER_INVALID', 'AI yanıt biçimi geçersiz.');
  try {
    return JSON.parse(value.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  } catch {
    throw new HttpError(502, 'PROVIDER_INVALID', 'AI geçerli JSON üretmedi.');
  }
}
