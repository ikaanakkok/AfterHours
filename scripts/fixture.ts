import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface FixtureRequest {
  id: string;
  customerName: string;
  customerAddress: string;
  description: string;
  reference: string;
  createdAt: string;
}

export interface FixtureOptions {
  dataDir?: string;
  testMode?: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · AfterHours test sitesi</title></head><body style="margin:0;background:#f5f2eb;color:#1b2937;font:16px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><main style="max-width:720px;margin:48px auto;padding:32px;background:white;border:1px solid #dedbd4"><p style="font-size:12px;letter-spacing:2px;color:#b45127">AFTERHOURS · KONTROLLÜ TEST SİTESİ</p><h1 style="font-size:30px;line-height:1.2">${escapeHtml(title)}</h1><p style="color:#68717b">Buradaki kayıtlar yalnızca geliştirme ve gösterim verileridir.</p>${body}<p><a href="/" style="color:#a64620">Yeni talep oluştur</a> · <a href="/requests" style="color:#a64620">Kayıtları gör</a></p></main></body></html>`;
}

function input(label: string, name: string, multiline = false): string {
  const style =
    'box-sizing:border-box;width:100%;padding:12px;margin:6px 0 18px;border:1px solid #bbc2c7;font:inherit';
  return `<label for="${name}">${label}</label>${multiline ? `<textarea id="${name}" name="${name}" required maxlength="4000" rows="4" style="${style}"></textarea>` : `<input id="${name}" name="${name}" required maxlength="${name === 'reference' ? 256 : 200}" style="${style}">`}`;
}

function form(testMode = false): string {
  const testControls = testMode
    ? '<label for="fixture-failure">Test hata davranışı</label><select id="fixture-failure" name="_failure"><option value="">Normal</option><option value="timeout-after-create">Kayıttan sonra bağlantıyı kes</option></select>'
    : '';
  return layout(
    'Müşteri talebi',
    `<form id="request-form" method="post" action="/requests">${input('Müşteri adı', 'customerName')}${input('İletişim adresi', 'customerAddress')}${input('Talebin açıklaması', 'description', true)}${input('Kalıcı işlem referansı', 'reference')}${testControls}<button id="create-request" type="submit" style="background:#182c40;color:white;padding:12px 24px;border:0;font:inherit;cursor:pointer">Talebi kaydet</button></form>`,
  );
}

function recordPage(record: FixtureRequest): string {
  return layout(
    'Talep doğrulandı',
    `<article id="request-record" data-afterhours-lookup="exists"><p>Kayıt kimliği: <strong id="request-id">${escapeHtml(record.id)}</strong></p><dl><dt>Müşteri</dt><dd id="record-customerName">${escapeHtml(record.customerName)}</dd><dt>İletişim</dt><dd id="record-customerAddress">${escapeHtml(record.customerAddress)}</dd><dt>Açıklama</dt><dd id="record-description">${escapeHtml(record.description)}</dd><dt>Referans</dt><dd id="record-reference">${escapeHtml(record.reference)}</dd><dt>Oluşturulma</dt><dd>${escapeHtml(record.createdAt)}</dd></dl></article>`,
  );
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > 16_384) throw new Error('İstek izin verilen boyutu aşıyor.');
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (request.headers['content-type']?.includes('application/json')) {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('İstek bir nesne içermeli.');
    return parsed as Record<string, unknown>;
  }
  return Object.fromEntries(new URLSearchParams(body));
}

export function createFixtureServer(options: FixtureOptions = {}) {
  const file = join(
    resolve(options.dataDir ?? process.env.AFTERHOURS_FIXTURE_DATA_DIR ?? '.data/fixture'),
    'requests.json',
  );
  let serialWrite: Promise<void> = Promise.resolve();
  const readRecords = async (): Promise<FixtureRequest[]> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('Test kayıt dosyası bozulmuş.');
      return parsed as FixtureRequest[];
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return [];
      throw error;
    }
  };
  const withWrite = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = serialWrite.then(fn, fn);
    serialWrite = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const persist = async (records: FixtureRequest[]) => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify(records, null, 2), { mode: 0o600 });
    await rename(temp, file);
  };
  const respond = (response: ServerResponse, status: number, body: string, json = false) => {
    response.writeHead(status, {
      'content-type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(body);
  };
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') {
        respond(response, 200, JSON.stringify({ ok: true, fixture: true }), true);
        return;
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/requests/new')) {
        respond(response, 200, form(options.testMode));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/requests') {
        const records = await readRecords();
        respond(
          response,
          200,
          layout(
            'Talep kayıtları',
            `<p id="request-count">${records.length} kayıt</p><ul>${records.map((record) => `<li><a href="/requests/${encodeURIComponent(record.id)}">${escapeHtml(record.customerName)} — ${escapeHtml(record.description)}</a></li>`).join('')}</ul>`,
          ),
        );
        return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/requests/by-reference/')) {
        const reference = decodeURIComponent(url.pathname.slice('/requests/by-reference/'.length));
        const records = await readRecords();
        const record = records.find((item) => item.reference === reference);
        respond(
          response,
          record ? 200 : 404,
          record
            ? recordPage(record)
            : layout(
                'Kayıt bulunamadı',
                '<p data-afterhours-lookup="absent">Bu referansla oluşturulmuş bir kayıt bulunmuyor.</p>',
              ),
        );
        return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/requests/')) {
        const id = decodeURIComponent(url.pathname.slice('/requests/'.length));
        const record = (await readRecords()).find((item) => item.id === id);
        respond(
          response,
          record ? 200 : 404,
          record ? recordPage(record) : layout('Kayıt bulunamadı', '<p>Bu kayıt mevcut değil.</p>'),
        );
        return;
      }
      if (request.method === 'POST' && url.pathname === '/requests') {
        const fields = await readBody(request);
        const data: Record<string, string> = {};
        for (const key of ['customerName', 'customerAddress', 'description', 'reference']) {
          const value = fields[key];
          if (
            typeof value !== 'string' ||
            !value.trim() ||
            value.length > (key === 'description' ? 4000 : key === 'reference' ? 256 : 200)
          ) {
            respond(
              response,
              422,
              layout('Bilgi eksik', `<p>${escapeHtml(key)} alanını kontrol edin.</p>`),
            );
            return;
          }
          data[key] = value.trim();
        }
        const record = await withWrite(async () => {
          const records = await readRecords();
          const existing = records.find((item) => item.reference === data.reference);
          if (existing) return existing;
          const created: FixtureRequest = {
            id: `REQ-${randomUUID().slice(0, 12).toUpperCase()}`,
            customerName: data.customerName!,
            customerAddress: data.customerAddress!,
            description: data.description!,
            reference: data.reference!,
            createdAt: new Date().toISOString(),
          };
          records.push(created);
          await persist(records);
          return created;
        });
        if (options.testMode && fields._failure === 'timeout-after-create') {
          // Durable write already completed; connection loss tests lookup-based recovery.
          request.socket.destroy();
          return;
        }
        response.writeHead(303, {
          location: `/requests/${encodeURIComponent(record.id)}`,
          'cache-control': 'no-store',
        });
        response.end();
        return;
      }
      if (options.testMode && request.method === 'POST' && url.pathname === '/__test/reset') {
        await withWrite(() => persist([]));
        respond(response, 200, JSON.stringify({ ok: true }), true);
        return;
      }
      if (options.testMode && request.method === 'GET' && url.pathname === '/__test/redirect') {
        response.writeHead(302, { location: url.searchParams.get('to') ?? '/' });
        response.end();
        return;
      }
      respond(
        response,
        404,
        layout('Sayfa bulunamadı', '<p>Bu adres test sitesinde mevcut değil.</p>'),
      );
    })().catch(() => {
      if (!response.headersSent)
        respond(
          response,
          500,
          layout(
            'Test sitesi hatası',
            '<p>Kayıt işlenemedi. Veri dosyasını ve geliştirme terminalini kontrol edin.</p>',
          ),
        );
      else response.end();
    });
  });
  return { server, records: readRecords };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createFixtureServer({
    testMode: process.env.AFTERHOURS_FIXTURE_TEST_MODE === 'true',
  });
  const port = Number(process.env.AFTERHOURS_FIXTURE_PORT ?? 4001);
  server.listen(port, '127.0.0.1', () =>
    console.log(`AfterHours demo talep sitesi: http://127.0.0.1:${port}`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => server.close(() => process.exit(0)));
}
