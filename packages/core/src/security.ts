import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { tenantDb } from './db.js';
import { secrets, connections } from './schema.js';
import type { JsonObject } from './types.js';
import { isDemo } from './env.js';
import { HttpError } from './errors.js';

const run = promisify(execFile);
let keyPromise: Promise<Buffer> | undefined;
export function stableHash(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, val]) => [k, sort(val)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(sort(value)))
    .digest('hex');
}
export function redact(value: unknown): unknown {
  if (typeof value === 'string')
    return value
      .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
        try {
          const url = new URL(raw);
          let changed = false;
          if (url.username || url.password) {
            url.username = 'redacted';
            url.password = 'redacted';
            changed = true;
          }
          for (const key of url.searchParams.keys())
            if (/password|secret|token|api.?key|credential|authorization/i.test(key)) {
              url.searchParams.set(key, '[redacted]');
              changed = true;
            }
          if (
            /password|secret|token|api.?key|credential|authorization/i.test(
              decodeURIComponent(url.hash),
            )
          ) {
            url.hash = 'redacted';
            changed = true;
          }
          return changed ? url.toString() : raw;
        } catch {
          return '[invalid URL]';
        }
      })
      .replace(
        /\b(?:sk-[\w-]{10,}|(?:sk|rk)_(?:live|test)_[\w]+|Bearer\s+[\w.\/-]+)/g,
        '[redacted]',
      )
      .replace(
        /((?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret|token)\s*[=:]\s*["']?)[^\s&#"']+/gi,
        '$1[redacted]',
      );
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /password|secret|token|cookie|credential|ciphertext|authorization|apikey|api_key/i.test(k)
          ? '[redacted]'
          : redact(v),
      ]),
    );
  return value;
}
async function masterKey() {
  return (keyPromise ??= (async () => {
    if (process.env.AFTERHOURS_TEST_MASTER_KEY && (isDemo() || process.env.NODE_ENV === 'test')) {
      const key = Buffer.from(process.env.AFTERHOURS_TEST_MASTER_KEY, 'hex');
      if (key.length !== 32) throw new Error('Invalid test encryption key');
      return key;
    }
    if (process.platform !== 'darwin')
      throw new Error('Mac Keychain is required for live credentials.');
    try {
      const { stdout } = await run('/usr/bin/security', [
        'find-generic-password',
        '-s',
        'AfterHours.local.master',
        '-a',
        'afterhours',
        '-w',
      ]);
      const key = Buffer.from(stdout.trim(), 'hex');
      if (key.length !== 32) throw new Error('Invalid Keychain item');
      return key;
    } catch {
      throw new Error(
        'AfterHours Keychain key is unavailable. Run pnpm setup or allow Keychain access.',
      );
    }
  })());
}
export async function encryptSecret(tenantId: string, connectionId: string, value: JsonObject) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await masterKey(), iv);
  cipher.setAAD(Buffer.from(`${tenantId}:${connectionId}`));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export async function decryptSecret(
  tenantId: string,
  connectionId: string,
  value: string,
): Promise<JsonObject> {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', await masterKey(), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${tenantId}:${connectionId}`));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'),
  ) as JsonObject;
}
export async function readConnectionSecret(
  tenantId: string,
  connectionId: string,
): Promise<JsonObject> {
  const row = await tenantDb(
    tenantId,
    async (db) =>
      (await db.select().from(secrets).where(eq(secrets.connectionId, connectionId)))[0],
  );
  return row ? decryptSecret(tenantId, connectionId, row.ciphertext) : {};
}
/** Captures the endpoint/account and its encrypted credential in one transaction. */
export async function readConnectionSnapshot(tenantId: string, connectionId: string) {
  const snapshot = await tenantDb(tenantId, async (db) => {
    const connection = (
      await db.select().from(connections).where(eq(connections.id, connectionId)).for('update')
    )[0];
    if (!connection) throw new HttpError(404, 'NOT_FOUND', 'Bağlantı bu işletmede bulunamadı.');
    const secret = (
      await db.select().from(secrets).where(eq(secrets.connectionId, connectionId)).for('share')
    )[0];
    return { connection, ciphertext: secret?.ciphertext };
  });
  return {
    connection: snapshot.connection,
    credential: snapshot.ciphertext
      ? await decryptSecret(tenantId, connectionId, snapshot.ciphertext)
      : {},
  };
}
export async function writeConnectionSecret(
  tenantId: string,
  connectionId: string,
  value: JsonObject,
) {
  const ciphertext = await encryptSecret(tenantId, connectionId, value);
  await tenantDb(tenantId, (db) =>
    db
      .insert(secrets)
      .values({ tenantId, connectionId, ciphertext })
      .onConflictDoUpdate({
        target: [secrets.tenantId, secrets.connectionId],
        set: { ciphertext },
      }),
  );
}
export async function deleteConnectionSecret(tenantId: string, connectionId: string) {
  await tenantDb(tenantId, (db) =>
    db.delete(secrets).where(eq(secrets.connectionId, connectionId)),
  );
}
/** Refreshes an existing credential atomically without overwriting a later reconnect or clear. */
export async function rotateConnectionSecret(
  tenantId: string,
  connectionId: string,
  expectedHash: string,
  value: JsonObject,
): Promise<boolean> {
  const ciphertext = await encryptSecret(tenantId, connectionId, value);
  return tenantDb(tenantId, async (db) => {
    const row = (
      await db.select().from(secrets).where(eq(secrets.connectionId, connectionId)).for('update')
    )[0];
    if (
      !row ||
      stableHash(await decryptSecret(tenantId, connectionId, row.ciphertext)) !== expectedHash
    )
      return false;
    const changed = await db
      .update(secrets)
      .set({ ciphertext })
      .where(eq(secrets.connectionId, connectionId))
      .returning({ connectionId: secrets.connectionId });
    return changed.length === 1;
  });
}
export function assertPublicConfig(config: JsonObject): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value)) {
        if (
          /password|secret|(?:access|refresh)[_-]?token|api.?key|credential|^token$|cookie|authorization/i.test(
            key,
          )
        )
          throw new Error('Secrets must use encrypted connection credentials.');
        visit(item);
      }
    if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) {
      let url: URL;
      try {
        url = new URL(value.trim());
      } catch {
        throw new Error('Invalid connection URL');
      }
      if (
        url.username ||
        url.password ||
        Array.from(url.searchParams.keys()).some((key) =>
          /password|secret|token|api.?key|credential|authorization/i.test(key),
        ) ||
        /password|secret|token|api.?key|credential|authorization/i.test(
          decodeURIComponent(url.hash),
        )
      )
        throw new Error('Connection URL may not contain credentials.');
    }
  };
  visit(config);
}
