import { randomUUID } from 'node:crypto';
import { handleMcpSetupCommand } from './mcp-setup.js';
import { join } from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Page } from 'playwright';
import * as s from './schema.js';
import { tenantDb } from './db.js';
import { requireAdmin, HttpError } from './errors.js';
import { assertMembership } from './context.js';
import { log } from './store.js';
import {
  assertPublicConfig,
  encryptSecret,
  readConnectionSnapshot,
  stableHash,
} from './security.js';
import { projectRoot } from './env.js';
import { withApprovedBrowserPage } from './browser.js';
import { createOperation, one } from './commands.js';
import type { CommandResult, JsonObject, TenantContext } from './types.js';

export function backofficeBrowserOptions(
  tenantId: string,
  conn: typeof s.connections.$inferSelect,
) {
  const startUrl = String(conn.config.startUrl ?? '');
  const allowedOrigins = Array.isArray(conn.config.allowedOrigins)
    ? conn.config.allowedOrigins.filter((v): v is string => typeof v === 'string')
    : [];
  return {
    profileDir: join(
      projectRoot,
      '.data',
      'profiles',
      tenantId,
      conn.id,
      `revision-${Number(conn.config.loginRevision ?? 0)}`,
    ),
    allowedOrigins,
    startUrl,
    headless: true,
  };
}

async function authenticatedProof(page: Page, username: string): Promise<boolean> {
  if (await page.locator('input[type="password"]:visible').count()) return false;
  // A logout affordance and an exact account marker jointly establish which session was opened.
  // URL changes, HTTP 200 and disappearing password fields alone are never success evidence.
  const logout = page
    .getByRole('button', { name: /^(?:log\s*out|sign\s*out|çıkış|çıkış yap|oturumu kapat)$/i })
    .or(
      page.getByRole('link', { name: /^(?:log\s*out|sign\s*out|çıkış|çıkış yap|oturumu kapat)$/i }),
    );
  const account = page.getByText(username, { exact: true });
  return (
    (await logout
      .first()
      .isVisible()
      .catch(() => false)) &&
    (await account
      .first()
      .isVisible()
      .catch(() => false))
  );
}

async function performLogin(
  tenantId: string,
  conn: typeof s.connections.$inferSelect,
  page: Page,
  requireCredentialSubmission = false,
): Promise<JsonObject> {
  const snapshot = await readConnectionSnapshot(tenantId, conn.id);
  if (
    snapshot.connection.status === 'disabled' ||
    stableHash(snapshot.connection.config) !== stableHash(conn.config)
  )
    throw new HttpError(
      409,
      'LOGIN_CHANGED',
      'Sistem veya giriş bilgileri değişti. Yeni test yapın.',
    );
  const secret = snapshot.credential;
  const username = typeof secret.username === 'string' ? secret.username : '';
  const password = typeof secret.password === 'string' ? secret.password : '';
  if (!username || !password)
    throw new HttpError(
      409,
      'LOGIN_FAILED',
      'Giriş bilgileri eksik. Sistem kaydedildi ancak aktif değil.',
    );
  if (!requireCredentialSubmission && (await authenticatedProof(page, username)))
    return {
      verified: true,
      method: 'existing_authenticated_account',
      checkedAt: new Date().toISOString(),
    };
  const passwordField = page.locator('input[type="password"]:visible');
  const userField = page.locator(
    'input[type="email"]:visible,input[autocomplete="username"]:visible,input[name="username"]:visible,input[name="email"]:visible,input[name="login"]:visible',
  );
  if ((await passwordField.count()) !== 1 || (await userField.count()) !== 1)
    throw new HttpError(
      409,
      'LOGIN_FAILED',
      'Giriş alanları güvenle belirlenemedi. Giriş ekranını veya çok aşamalı doğrulamayı kontrol edin.',
    );
  await userField.fill(username);
  await passwordField.fill(password);
  const submit = page
    .locator('form')
    .filter({ has: passwordField })
    .locator('button[type="submit"],input[type="submit"]');
  if ((await submit.count()) !== 1)
    throw new HttpError(409, 'LOGIN_FAILED', 'Giriş düğmesi tek anlamlı biçimde belirlenemedi.');
  await submit.click();
  await page.waitForTimeout(300);
  // Wait only for a meaningful account proof; no screenshots, credentials or input values leave the driver.
  for (let n = 0; n < 12; n++) {
    if (await authenticatedProof(page, username))
      return {
        verified: true,
        method: 'logout_and_account_marker',
        checkedAt: new Date().toISOString(),
      };
    await page.waitForTimeout(250);
  }
  throw new HttpError(
    409,
    'LOGIN_FAILED',
    'Giriş doğrulanamadı. Kullanıcı adı, parola veya ek doğrulama adımını kontrol edin. Sistem aktif değil.',
  );
}

export async function loginBackofficePage(
  tenantId: string,
  conn: typeof s.connections.$inferSelect,
  page: Page,
  requireCredentialSubmission = false,
): Promise<JsonObject> {
  try {
    return await performLogin(tenantId, conn, page, requireCredentialSubmission);
  } catch (error) {
    // Playwright's fill errors can include the supplied value. Never propagate them with credentials.
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      409,
      'LOGIN_FAILED',
      'Giriş adımı tamamlanamadı. Sistem aktif değil; bilgileri ve ekranı kontrol edin.',
    );
  }
}

export async function executeBackofficeLogin(
  tenantId: string,
  conn: typeof s.connections.$inferSelect,
): Promise<JsonObject> {
  if (conn.kind !== 'browser' || conn.config.backoffice !== true)
    throw new HttpError(400, 'BACKOFFICE_REQUIRED', 'Backoffice sistemi seçin.');
  const directory = join(projectRoot, '.data', 'login-tests', tenantId, conn.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const profileDir = await mkdtemp(join(directory, 'test-'));
  try {
    return await withApprovedBrowserPage(
      { ...backofficeBrowserOptions(tenantId, conn), profileDir },
      (page) => loginBackofficePage(tenantId, conn, page, true),
    );
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
}

export async function handleBackofficeCommand(
  ctx: TenantContext,
  action: string,
  payload: unknown,
  beforeMutation?: (db: import('./db.js').TenantDb) => Promise<void>,
): Promise<CommandResult> {
  if (action.startsWith('backoffice.mcp.'))
    return handleMcpSetupCommand(ctx, action, payload, beforeMutation);
  await assertMembership(ctx);
  requireAdmin(ctx.role);
  if (action === 'backoffice.save') {
    const p = z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(120),
        url: z.string().url().max(2000),
        description: z.string().trim().min(1).max(8000),
        username: z.string().min(1).max(300).optional(),
        password: z.string().min(1).max(2000).optional(),
      })
      .strict()
      .parse(payload);
    const url = new URL(p.url);
    assertPublicConfig({ url: p.url });
    if (!['http:', 'https:'].includes(url.protocol))
      throw new HttpError(400, 'INVALID_URL', 'HTTP veya HTTPS adresi girin.');
    if (!!p.username !== !!p.password)
      throw new HttpError(
        400,
        'CREDENTIALS_INCOMPLETE',
        'Kullanıcı adı ve parola birlikte girilmeli.',
      );
    const id = p.id ?? randomUUID();
    const ciphertext =
      p.username && p.password
        ? await encryptSecret(ctx.tenantId, id, { username: p.username, password: p.password })
        : null;
    await tenantDb(ctx.tenantId, async (db) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':backoffice'},0))`,
      );

      if (beforeMutation) await beforeMutation(db);
      const collision = (
        await db
          .select()
          .from(s.connections)
          .where(
            and(
              inArray(s.connections.kind, ['browser', 'mcp']),
              sql`lower(${s.connections.name})=lower(${p.name})`,
            ),
          )
      ).find((c) => c.id !== id);
      if (collision)
        throw new HttpError(
          409,
          'SYSTEM_NAME_EXISTS',
          'Bu isim başka bir sisteme ait. Workflow için benzersiz bir isim girin.',
        );
      const old = p.id
        ? await one(db.select().from(s.connections).where(eq(s.connections.id, id)))
        : null;
      if (old && (old.kind !== 'browser' || old.config.backoffice !== true))
        throw new HttpError(400, 'BACKOFFICE_REQUIRED', 'Bu kayıt bir Backoffice sistemi değil.');
      const config = {
        ...(old?.config ?? {}),
        backoffice: true,
        startUrl: url.href,
        allowedOrigins: [url.origin],
        loginRevision: Number(old?.config.loginRevision ?? 0) + 1,
      };
      const values = {
        name: p.name,
        purpose: p.description,
        status: 'awaiting_test',
        lastError: null,
        realAccountVerified: false,
        config,
      };
      if (old) await db.update(s.connections).set(values).where(eq(s.connections.id, id));
      else
        await db.insert(s.connections).values({
          id,
          tenantId: ctx.tenantId,
          kind: 'browser',
          ...values,
          permissions: ['browser.execute', 'teaching.record'],
          agents: ['admin'],
        });
      if (ciphertext)
        await db
          .insert(s.secrets)
          .values({ tenantId: ctx.tenantId, connectionId: id, ciphertext })
          .onConflictDoUpdate({
            target: [s.secrets.tenantId, s.secrets.connectionId],
            set: { ciphertext },
          });
      await log(db, ctx.tenantId, ctx.actor, 'backoffice.saved', id, {
        name: p.name,
        credentialsChanged: !!ciphertext,
        status: 'awaiting_test',
        permissionsGranted: false,
      });
    });
    return {
      message: 'Sistem kaydedildi. Başarılı giriş testi tamamlanana kadar aktif değil.',
      data: { id },
    };
  }
  if (action === 'backoffice.test') {
    const p = z.object({ id: z.string().uuid() }).strict().parse(payload);
    return tenantDb(ctx.tenantId, async (db) => {
      if (beforeMutation) await beforeMutation(db);
      const conn = await one(db.select().from(s.connections).where(eq(s.connections.id, p.id)));
      if (conn.config.backoffice !== true)
        throw new HttpError(400, 'BACKOFFICE_REQUIRED', 'Backoffice sistemi seçin.');
      const op = await createOperation(db, ctx, {
        capability: 'connection.test',
        connectionId: conn.id,
        inputs: { backoffice: true, loginRevision: conn.config.loginRevision },
        idempotencyKey: `backoffice-login:${randomUUID()}`,
      });
      return {
        message: 'Giriş testi kuyruğa alındı.',
        data: { operationId: op.id, status: op.status },
      };
    });
  }
  throw new HttpError(400, 'UNKNOWN_COMMAND', 'Backoffice komutu desteklenmiyor.');
}
