import { createHash } from 'node:crypto';
import type { JsonObject } from '../types.js';
import {
  assertSafeText,
  authHeaders,
  ExternalOutcomeUnknown,
  object,
  ProviderError,
  requestJson,
  textField,
} from './http.js';

export type EmailKind = 'gmail' | 'outlook';
export interface EmailInput {
  to: string;
  subject: string;
  body: string;
  reference: string;
  /** Source identifiers are supplied only from the tenant's persisted reply draft. */
  threadId?: string;
  inReplyTo?: string;
  sourceMessageId?: string;
}
export interface VerifiedResult {
  verified: true;
  externalRecordId: string;
  evidence: JsonObject;
}
export interface IncomingEmail {
  externalId: string;
  address: string;
  name: string;
  subject: string;
  body: string;
  receivedAt: string;
  threadId: string;
  internetMessageId: string | null;
}
export interface EmailPage {
  messages: IncomingEmail[];
  nextCursor: string | null;
}
export interface EmailReadOptions {
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string | null;
}

function validateEmail(input: EmailInput): void {
  if (!/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(input.to))
    throw new ProviderError('Alıcı e-posta adresi geçerli değil.', 422);
  assertSafeText(input.subject, 'Konu', 300);
  if (/[\r\n]/.test(input.subject))
    throw new ProviderError('Konu satırı birden fazla satır içeremez.', 422);
  assertSafeText(input.body, 'E-posta metni');
  assertSafeText(input.reference, 'İşlem referansı', 200);
  for (const value of [input.threadId, input.sourceMessageId])
    if (value !== undefined && (!value || value.length > 500 || /[\r\n\0]/.test(value)))
      throw new ProviderError('E-posta yanıt kimliği geçerli değil.', 422);
  if (
    input.inReplyTo !== undefined &&
    (!/^<[^<>\s\u0000-\u001f\u007f]+>$/.test(input.inReplyTo) || input.inReplyTo.length > 998)
  )
    throw new ProviderError('E-posta yanıt başlığı geçerli değil.', 422);
}

function messageId(reference: string): string {
  return `<${createHash('sha256').update(reference).digest('hex')}@afterhours.local>`;
}

export async function testEmailConnection(
  kind: EmailKind,
  config: JsonObject,
  secrets: JsonObject,
): Promise<{ verified: boolean; account?: string }> {
  const headers = await authHeaders(kind, config, secrets);
  const result = await requestJson(
    kind === 'gmail'
      ? 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
      : 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName',
    { headers },
  );
  const account =
    kind === 'gmail'
      ? textField(result, 'emailAddress')
      : typeof result.mail === 'string'
        ? result.mail
        : textField(result, 'userPrincipalName');
  return { verified: true, account };
}

async function verifyGmail(
  id: string,
  expectedMessageId: string,
  headers: Record<string, string>,
  expectedThreadId?: string,
): Promise<VerifiedResult> {
  const record = await requestJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Message-ID`,
    { headers },
  );
  const labels = Array.isArray(record.labelIds) ? record.labelIds : [];
  const payload = object(record.payload);
  const metadata = Array.isArray(payload.headers) ? payload.headers.map(object) : [];
  const actualMessageId = metadata.find(
    (item) => typeof item.name === 'string' && item.name.toLowerCase() === 'message-id',
  )?.value;
  if (
    record.id !== id ||
    !labels.includes('SENT') ||
    actualMessageId !== expectedMessageId ||
    (expectedThreadId !== undefined && record.threadId !== expectedThreadId)
  )
    throw new ExternalOutcomeUnknown('E-posta kaydı bulundu ancak gönderim kanıtı doğrulanamadı.');
  return {
    verified: true,
    externalRecordId: id,
    evidence: { provider: 'gmail', sentRecordId: id, messageId: expectedMessageId, sent: true },
  };
}

async function findGmail(
  expectedMessageId: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const query = new URLSearchParams({
    q: `in:sent rfc822msgid:${expectedMessageId}`,
    maxResults: '2',
  });
  const found = await requestJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`,
    { headers },
  );
  const records = Array.isArray(found.messages) ? found.messages.map(object) : [];
  if (records.length > 1)
    throw new ExternalOutcomeUnknown('Aynı referansla birden fazla gönderim bulundu.');
  return records[0] && typeof records[0].id === 'string' ? records[0].id : null;
}

async function assertSendingAccount(
  kind: EmailKind,
  config: JsonObject,
  headers: Record<string, string>,
): Promise<void> {
  if (typeof config.accountEmail !== 'string' || !config.accountEmail) return; // Standalone adapter tests may omit identity; runtime requires it.
  const profile = await requestJson(
    kind === 'gmail'
      ? 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
      : 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName',
    { headers },
  );
  const actual =
    kind === 'gmail'
      ? textField(profile, 'emailAddress')
      : typeof profile.mail === 'string'
        ? profile.mail
        : textField(profile, 'userPrincipalName');
  if (actual.toLowerCase() !== config.accountEmail.toLowerCase())
    throw new ProviderError(
      'E-posta erişimi onaylanan gönderici hesabıyla uyuşmuyor.',
      409,
      'email_account_changed',
    );
}

async function sendGmail(
  config: JsonObject,
  secrets: JsonObject,
  input: EmailInput,
): Promise<VerifiedResult> {
  const headers = await authHeaders('gmail', config, secrets);
  await assertSendingAccount('gmail', config, headers);
  const reference = messageId(input.reference);
  const existing = await findGmail(reference, headers);
  if (existing) return verifyGmail(existing, reference, headers, input.threadId);
  const raw = [
    `To: ${input.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(input.subject).toString('base64')}?=`,
    `Message-ID: ${reference}`,
    ...(input.inReplyTo
      ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`]
      : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(input.body).toString('base64'),
  ].join('\r\n');
  const result = await requestJson(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        raw: Buffer.from(raw).toString('base64url'),
        ...(input.threadId ? { threadId: input.threadId } : {}),
      }),
    },
    { write: true },
  );
  try {
    return await verifyGmail(textField(result, 'id'), reference, headers, input.threadId);
  } catch {
    throw new ExternalOutcomeUnknown(
      'E-posta gönderilmiş olabilir; gönderilmiş öğelerde doğrulama gerekiyor.',
    );
  }
}

const REFERENCE_PROPERTY = 'String {515b734a-d438-4344-aeb7-830dfb9fa436} Name AfterHoursReference';

async function findOutlook(
  reference: string,
  headers: Record<string, string>,
): Promise<JsonObject | null> {
  const escaped = reference.replaceAll("'", "''");
  const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${REFERENCE_PROPERTY}' and ep/value eq '${escaped}')`;
  const search = new URLSearchParams({
    $filter: filter,
    $expand: `singleValueExtendedProperties($filter=id eq '${REFERENCE_PROPERTY}')`,
    $select: 'id,isDraft,sentDateTime,conversationId',
    $top: '2',
  });
  const response = await requestJson(`https://graph.microsoft.com/v1.0/me/messages?${search}`, {
    headers,
  });
  const values = Array.isArray(response.value) ? response.value.map(object) : [];
  if (values.length > 1)
    throw new ExternalOutcomeUnknown('Aynı referansla birden fazla e-posta bulundu.');
  return values[0] ?? null;
}

async function sendOutlook(
  config: JsonObject,
  secrets: JsonObject,
  input: EmailInput,
): Promise<VerifiedResult> {
  const headers = {
    ...(await authHeaders('outlook', config, secrets)),
    Prefer: 'IdType="ImmutableId"',
  };
  await assertSendingAccount('outlook', config, headers);
  let record = await findOutlook(input.reference, headers);
  if (!record) {
    // Native replies preserve the source conversation. The created draft is still unsent.
    if (input.sourceMessageId) {
      record = await requestJson(
        `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(input.sourceMessageId)}/createReply`,
        { method: 'POST', headers, body: JSON.stringify({}) },
        { write: true },
      );
      const recipients = Array.isArray(record.toRecipients) ? record.toRecipients.map(object) : [];
      if (
        recipients.length !== 1 ||
        textField(object(recipients[0]!.emailAddress), 'address').toLowerCase() !==
          input.to.toLowerCase()
      )
        throw new ExternalOutcomeUnknown('Yanıt taslağının alıcısı kaynak mesajla doğrulanamadı.');
      record = await requestJson(
        `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(textField(record, 'id'))}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            subject: input.subject,
            body: { contentType: 'Text', content: input.body },
            singleValueExtendedProperties: [{ id: REFERENCE_PROPERTY, value: input.reference }],
          }),
        },
        { write: true },
      );
    } else {
      record = await requestJson(
        'https://graph.microsoft.com/v1.0/me/messages',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            subject: input.subject,
            body: { contentType: 'Text', content: input.body },
            toRecipients: [{ emailAddress: { address: input.to } }],
            singleValueExtendedProperties: [{ id: REFERENCE_PROPERTY, value: input.reference }],
          }),
        },
        { write: true },
      );
    }
  }
  const id = textField(record, 'id');
  if (record.isDraft === true) {
    await requestJson(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}/send`,
      { method: 'POST', headers: { ...headers, 'Content-Length': '0' } },
      { write: true, allowEmpty: true },
    );
  } else if (!record.sentDateTime) {
    throw new ExternalOutcomeUnknown('E-posta taslağı veya gönderim durumu belirlenemedi.');
  }
  // Sending is asynchronous in Graph. A missing Sent Items proof must never be called sent.
  try {
    const verified = await findOutlook(input.reference, headers);
    if (
      !verified ||
      verified.isDraft !== false ||
      typeof verified.sentDateTime !== 'string' ||
      (input.threadId !== undefined && verified.conversationId !== input.threadId)
    )
      throw new ExternalOutcomeUnknown();
    const sentId = textField(verified, 'id');
    return {
      verified: true,
      externalRecordId: sentId,
      evidence: {
        provider: 'outlook',
        sentRecordId: sentId,
        sentDateTime: verified.sentDateTime,
        sent: true,
      },
    };
  } catch {
    throw new ExternalOutcomeUnknown(
      'Outlook gönderimi kabul etti; gönderilmiş öğelerde doğrulama bekleniyor.',
    );
  }
}

function gmailBody(part: JsonObject, depth = 0): string {
  if (depth > 8) return '';
  if (part.mimeType === 'text/plain' && part.body && typeof part.body === 'object') {
    const data = object(part.body).data;
    return typeof data === 'string'
      ? Buffer.from(data, 'base64url').toString('utf8').slice(0, 20_000)
      : '';
  }
  const children = Array.isArray(part.parts) ? part.parts : [];
  for (const child of children) {
    const text = gmailBody(object(child), depth + 1);
    if (text) return text;
  }
  return '';
}

/** Reads are scoped to this account. The worker deduplicates externalId and owns the tenant mapping. */
export async function readEmailMessagePage(
  kind: EmailKind,
  config: JsonObject,
  secrets: JsonObject,
  options: EmailReadOptions = {},
): Promise<EmailPage> {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new ProviderError('E-posta okuma sınırı geçerli değil.', 422);
  const since = options.since ? Date.parse(options.since) : null;
  if (since !== null && !Number.isFinite(since))
    throw new ProviderError('E-posta başlangıç tarihi geçerli değil.', 422);
  const until = options.until ? Date.parse(options.until) : null;
  if (until !== null && (!Number.isFinite(until) || (since !== null && until <= since)))
    throw new ProviderError('E-posta bitiş tarihi geçerli değil.', 422);
  if (options.cursor && (typeof options.cursor !== 'string' || options.cursor.length > 8000))
    throw new ProviderError('E-posta sayfa kimliği geçerli değil.', 422);
  if (kind === 'outlook') {
    const query = new URLSearchParams({
      $select: 'id,conversationId,internetMessageId,subject,from,body,receivedDateTime',
      $top: String(limit),
      $orderby: 'receivedDateTime desc',
    });
    const filters = [
      ...(since !== null ? [`receivedDateTime ge ${new Date(since).toISOString()}`] : []),
      ...(until !== null ? [`receivedDateTime lt ${new Date(until).toISOString()}`] : []),
    ];
    if (filters.length) query.set('$filter', filters.join(' and '));
    const url = options.cursor
      ? safeOutlookCursor(options.cursor)
      : `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${query}`;
    const headers = await authHeaders(kind, config, secrets);
    const result = await requestJson(url, {
      headers: { ...headers, Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' },
    });
    if (!Array.isArray(result.value) || result.value.length > limit)
      throw new ProviderError('Gelen e-postalar okunamadı.');
    const next = pageCursor(result, '@odata.nextLink');
    if (next) safeOutlookCursor(next);
    const messages = result.value.map(object).map((message) => {
      const from = object(object(message.from).emailAddress);
      const body = object(message.body);
      if (body.contentType !== 'text' && body.contentType !== 'Text')
        throw new ProviderError(
          'E-posta sağlayıcısı düz metin yerine beklenmeyen içerik döndürdü.',
        );
      return {
        externalId: textField(message, 'id'),
        address: textField(from, 'address'),
        name: textField(from, 'name', false) || textField(from, 'address'),
        subject: textField(message, 'subject', false),
        body: textField(body, 'content', false).slice(0, 20_000),
        receivedAt: textField(message, 'receivedDateTime'),
        threadId: textField(message, 'conversationId', false) || textField(message, 'id'),
        internetMessageId: textField(message, 'internetMessageId', false) || null,
      };
    });
    return { messages: validateIncoming(messages, since, until), nextCursor: next };
  }
  const query = new URLSearchParams({
    q: `in:inbox${since !== null ? ` after:${Math.floor(since / 1000)}` : ''}${until !== null ? ` before:${Math.ceil(until / 1000)}` : ''}`,
    maxResults: String(limit),
  });
  if (options.cursor) query.set('pageToken', options.cursor);
  const headers = await authHeaders(kind, config, secrets);
  const response = await requestJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`,
    { headers },
  );
  const ids = Array.isArray(response.messages)
    ? response.messages.map((value) => textField(object(value), 'id'))
    : [];
  if (ids.length > limit) throw new ProviderError('E-posta sayfası okuma sınırını aştı.');
  const messages: IncomingEmail[] = [];
  for (const id of ids) {
    const record = await requestJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      { headers },
    );
    const payload = object(record.payload);
    const metadata = Array.isArray(payload.headers) ? payload.headers.map(object) : [];
    const header = (name: string): string => {
      const value = metadata.find(
        (item) => typeof item.name === 'string' && item.name.toLowerCase() === name,
      )?.value;
      return typeof value === 'string' ? value : '';
    };
    const from = header('from');
    const address =
      /<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ??
      /[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+/.exec(from)?.[0];
    if (!address) throw new ProviderError('Gelen e-postanın gönderen adresi okunamadı.');
    const received =
      typeof record.internalDate === 'string' ? Number(record.internalDate) : Number.NaN;
    if (!Number.isFinite(received)) throw new ProviderError('Gelen e-postanın tarihi okunamadı.');
    const body =
      gmailBody(payload) ||
      (typeof record.snippet === 'string' ? record.snippet.slice(0, 20_000) : '');
    messages.push({
      externalId: id,
      address,
      name:
        from
          .replace(/<[^>]+>/, '')
          .trim()
          .replace(/^"|"$/g, '') || address,
      subject: header('subject'),
      body,
      receivedAt: new Date(received).toISOString(),
      threadId: textField(record, 'threadId', false) || id,
      internetMessageId: header('message-id') || null,
    });
  }
  const next = pageCursor(response, 'nextPageToken');
  return { messages: validateIncoming(messages, since, until), nextCursor: next };
}

function pageCursor(value: JsonObject, key: string): string | null {
  const cursor = value[key];
  if (cursor === undefined || cursor === null || cursor === '') return null;
  if (typeof cursor !== 'string' || cursor.length > 8000 || /[\r\n\0]/.test(cursor))
    throw new ProviderError('E-posta sayfa kimliği geçerli değil.');
  return cursor;
}

function safeOutlookCursor(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError('E-posta sayfa adresi geçerli değil.', 422);
  }
  if (
    url.origin !== 'https://graph.microsoft.com' ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/v1\.0\/me\/mailFolders(?:\/inbox|\('inbox'\))\/messages$/i.test(url.pathname) ||
    value.length > 8000
  )
    throw new ProviderError('E-posta sayfa adresi hesap gelen kutusuna ait değil.', 422);
  return url.href;
}
function validateIncoming(
  messages: IncomingEmail[],
  since: number | null,
  until: number | null,
): IncomingEmail[] {
  return messages.filter((message) => {
    const received = Date.parse(message.receivedAt);
    if (
      !Number.isFinite(received) ||
      !/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(message.address)
    )
      throw new ProviderError('Gelen e-postanın göndereni veya tarihi geçerli değil.');
    if (
      message.externalId.length > 500 ||
      message.threadId.length > 500 ||
      message.subject.length > 998
    )
      throw new ProviderError('Gelen e-postanın kimliği veya konusu çok uzun.');
    message.name = message.name.slice(0, 200);
    if (message.internetMessageId && message.internetMessageId.length > 998)
      message.internetMessageId = null;
    return (since === null || received >= since) && (until === null || received < until);
  });
}
/** Compatibility helper: explicit callers read one bounded page. Worker uses the persistent page API. */
export async function readEmailMessages(
  kind: EmailKind,
  config: JsonObject,
  secrets: JsonObject,
  options: EmailReadOptions = {},
): Promise<IncomingEmail[]> {
  return (await readEmailMessagePage(kind, config, secrets, options)).messages;
}

/** Only call after the application layer authorizes the exact persisted draft. */
export async function sendEmail(
  kind: EmailKind,
  config: JsonObject,
  secrets: JsonObject,
  input: EmailInput,
): Promise<VerifiedResult> {
  validateEmail(input);
  return kind === 'gmail' ? sendGmail(config, secrets, input) : sendOutlook(config, secrets, input);
}
