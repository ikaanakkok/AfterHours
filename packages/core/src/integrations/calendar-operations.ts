import { createHash } from 'node:crypto';
import type { JsonObject } from '../types.js';
import {
  calculateCalendarSlots,
  withinCalendarHours,
  type CalendarEventInput,
  type CalendarKind,
  type TimeRange,
} from './calendar.js';
import type { VerifiedResult } from './email.js';
import {
  assertSafeText,
  authHeaders,
  ExternalOutcomeUnknown,
  object,
  ProviderError,
  requestJson,
  textField,
} from './http.js';

/** Trusted server snapshot taken before the exact mutation is approved. */
export interface CalendarEventSnapshot {
  kind: CalendarKind;
  accountEmail: string;
  calendarId: string;
  eventId: string;
  version: string;
  title: string;
  description: string;
  start: string;
  end: string;
}
export interface CalendarEventUpdateInput extends CalendarEventInput {
  eventId: string;
  expected: CalendarEventSnapshot;
}
export interface CalendarEventCancelInput {
  eventId: string;
  reference: string;
  expected: CalendarEventSnapshot;
  /** Only persisted, trusted operation evidence, never model or request-body data. */
  previousCancellation?: VerifiedResult;
}

const OPERATION_PROPERTY = 'String {515b734a-d438-4344-aeb7-830dfb9fa436} Name AfterHoursOperation';

function conflict(message = 'Takvim kaydı onaydan sonra değişti. Yeni onay gerekiyor.'): never {
  throw new ProviderError(message, 409, 'calendar_conflict');
}
function iso(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new ProviderError('Takvim zamanı saat dilimi içeren geçerli ISO tarihi olmalı.', 422);
  return new Date(value).toISOString();
}
function eventTime(kind: CalendarKind, value: unknown): string {
  const data = object(value);
  let result = textField(data, 'dateTime');
  if (kind === 'microsoft_calendar') {
    if (data.timeZone !== 'UTC' && data.timeZone !== 'Etc/UTC')
      throw new ProviderError('Takvim sağlayıcısı beklenmeyen saat dilimi döndürdü.');
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(result)) result += 'Z';
  }
  return iso(result);
}
function base(kind: CalendarKind, id: string): string {
  return kind === 'google_calendar'
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}`
    : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(id)}`;
}
function eventUrl(kind: CalendarKind, calendar: string, event: string, expand = true): string {
  const suffix =
    expand && kind === 'microsoft_calendar'
      ? `?$expand=${encodeURIComponent('singleValueExtendedProperties')}`
      : '';
  return `${base(kind, calendar)}/events/${encodeURIComponent(event)}${suffix}`;
}
function readHeaders(headers: Record<string, string>): Record<string, string> {
  return { ...headers, Prefer: 'outlook.timezone="UTC"' };
}

async function calendarIdentity(
  kind: CalendarKind,
  config: JsonObject,
  headers: Record<string, string>,
): Promise<{ accountEmail: string; calendarId: string }> {
  const requested = textField(config, 'calendarId');
  let accountEmail: string;
  let calendarId: string;
  if (kind === 'google_calendar') {
    const calendars: JsonObject[] = [];
    let pageToken = '';
    for (let page = 0; ; page++) {
      if (page >= 50)
        throw new ProviderError('Takvim listesi doğrulanamadı; hesap bağlantısını kontrol edin.');
      const query = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) });
      const result = await requestJson(
        `https://www.googleapis.com/calendar/v3/users/me/calendarList?${query}`,
        { headers },
      );
      if (!Array.isArray(result.items)) throw new ProviderError('Takvim listesi eksik döndü.');
      calendars.push(...result.items.map(object));
      if (!result.nextPageToken) break;
      pageToken = textField(result, 'nextPageToken');
    }
    const primary = calendars.find((calendar) => calendar.primary === true);
    const target = calendars.find((calendar) =>
      requested === 'primary' ? calendar.primary === true : calendar.id === requested,
    );
    if (!primary || !target || !['owner', 'writer'].includes(String(target.accessRole)))
      throw new ProviderError('Bağlı hesapta bu takvim için yazma izni doğrulanamadı.', 422);
    accountEmail = textField(primary, 'id');
    calendarId = textField(target, 'id');
  } else {
    const profile = await requestJson(
      'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName',
      { headers },
    );
    accountEmail =
      typeof profile.mail === 'string' && profile.mail
        ? profile.mail
        : textField(profile, 'userPrincipalName');
    const target = await requestJson(
      requested === 'primary'
        ? 'https://graph.microsoft.com/v1.0/me/calendar?$select=id,canEdit'
        : `${base(kind, requested)}?$select=id,canEdit`,
      { headers },
    );
    calendarId = textField(target, 'id');
    if ((requested !== 'primary' && calendarId !== requested) || target.canEdit !== true)
      throw new ProviderError('Bağlı hesapta bu takvim için yazma izni doğrulanamadı.', 422);
  }
  if (
    typeof config.accountEmail === 'string' &&
    config.accountEmail.toLowerCase() !== accountEmail.toLowerCase()
  )
    conflict('Bağlı takvim hesabı değişti. Hesap yeniden doğrulanmalı.');
  return { accountEmail: accountEmail.toLowerCase(), calendarId };
}

async function readEvent(
  kind: CalendarKind,
  calendar: string,
  headers: Record<string, string>,
  eventId: string,
): Promise<JsonObject | null> {
  try {
    const record = await requestJson(eventUrl(kind, calendar, eventId), {
      headers: readHeaders(headers),
    });
    if (record.id !== eventId) conflict('Takvim sağlayıcısındaki kayıt kimliği hedefle eşleşmedi.');
    return record;
  } catch (error) {
    if (error instanceof ProviderError && [404, 410].includes(error.providerStatus ?? 0))
      return null;
    throw error;
  }
}
function cancelled(record: JsonObject): boolean {
  return record.status === 'cancelled' || record.isCancelled === true;
}
function snapshot(
  kind: CalendarKind,
  identity: { accountEmail: string; calendarId: string },
  record: JsonObject,
): CalendarEventSnapshot {
  if (cancelled(record)) throw new ProviderError('Takvim kaydı zaten iptal edilmiş.', 422);
  // A series master would mutate multiple occurrences outside the exact approved target.
  if (
    (Array.isArray(record.recurrence) && record.recurrence.length > 0) ||
    record.type === 'seriesMaster'
  )
    throw new ProviderError('Tekrarlayan seri yerine tek bir etkinlik seçilmeli.', 422);
  return {
    kind,
    ...identity,
    eventId: textField(record, 'id'),
    version: textField(record, kind === 'google_calendar' ? 'etag' : '@odata.etag'),
    start: eventTime(kind, record.start),
    end: eventTime(kind, record.end),
    title: textField(record, kind === 'google_calendar' ? 'summary' : 'subject', false),
    description:
      kind === 'google_calendar'
        ? textField(record, 'description', false)
        : textField(object(record.body), 'content', false),
  };
}
function validateExpected(
  kind: CalendarKind,
  input: { eventId: string; reference: string; expected: CalendarEventSnapshot },
): void {
  assertSafeText(input.eventId, 'Etkinlik kimliği', 2048);
  assertSafeText(input.reference, 'İşlem referansı', 200);
  const expected = object(input.expected);
  for (const field of ['accountEmail', 'calendarId', 'eventId', 'version'])
    assertSafeText(textField(expected, field), 'Onaylanan takvim hedefi', 2048);
  if (
    expected.kind !== kind ||
    expected.eventId !== input.eventId ||
    typeof expected.title !== 'string' ||
    typeof expected.description !== 'string'
  )
    throw new ProviderError('Onaylanan takvim hedefi geçerli değil.', 422, 'invalid_input');
  iso(expected.start);
  iso(expected.end);
}
function fingerprint(expected: CalendarEventSnapshot): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        expected.kind,
        expected.accountEmail,
        expected.calendarId,
        expected.eventId,
        expected.version,
        expected.start,
        expected.end,
        expected.title,
        expected.description,
      ]),
    )
    .digest('hex');
}
function assertIdentity(
  identity: { accountEmail: string; calendarId: string },
  expected: CalendarEventSnapshot,
): void {
  if (
    identity.calendarId !== expected.calendarId ||
    identity.accountEmail !== expected.accountEmail
  )
    conflict('Onaylanan takvim veya hesap artık bağlı hedefle eşleşmiyor.');
}
function assertFresh(actual: CalendarEventSnapshot, expected: CalendarEventSnapshot): void {
  if (fingerprint(actual) !== fingerprint(expected)) conflict();
}

/** Read-only: the caller persists this snapshot inside the exact approved command. */
export async function prepareCalendarEvent(
  kind: CalendarKind,
  config: JsonObject,
  secrets: JsonObject,
  eventId: string,
): Promise<CalendarEventSnapshot> {
  assertSafeText(eventId, 'Etkinlik kimliği', 2048);
  const headers = await authHeaders(kind, config, secrets);
  const identity = await calendarIdentity(kind, config, headers);
  const record = await readEvent(kind, identity.calendarId, headers, eventId);
  if (!record) throw new ProviderError('Takvim kaydı bulunamadı.', 404, 'calendar_event_not_found');
  return snapshot(kind, identity, record);
}

function operationReference(kind: CalendarKind, record: JsonObject): unknown {
  return kind === 'google_calendar'
    ? object(object(record.extendedProperties ?? {}).private ?? {}).afterhoursOperation
    : Array.isArray(record.singleValueExtendedProperties)
      ? record.singleValueExtendedProperties
          .map(object)
          .find((property) => property.id === OPERATION_PROPERTY)?.value
      : undefined;
}
function verified(action: 'update' | 'cancel', input: CalendarEventCancelInput): VerifiedResult {
  return {
    verified: true,
    externalRecordId: input.eventId,
    evidence: {
      action,
      provider: input.expected.kind,
      accountEmail: input.expected.accountEmail,
      calendarId: input.expected.calendarId,
      eventId: input.eventId,
      reference: input.reference,
      targetFingerprint: fingerprint(input.expected),
      readBackVerified: true,
      ...(action === 'cancel' ? { cancelled: true } : {}),
    },
  };
}
function verifyUpdate(
  kind: CalendarKind,
  record: JsonObject,
  input: CalendarEventUpdateInput,
): VerifiedResult {
  try {
    const saved = snapshot(kind, input.expected, record);
    if (
      saved.eventId !== input.eventId ||
      saved.start !== iso(input.start) ||
      saved.end !== iso(input.end) ||
      saved.title !== input.title ||
      saved.description !== input.description ||
      operationReference(kind, record) !== input.reference
    )
      throw new Error('Readback mismatch');
    return {
      ...verified('update', input),
      evidence: {
        ...verified('update', input).evidence,
        start: input.start,
        end: input.end,
        title: input.title,
        description: input.description,
        version: saved.version,
      },
    };
  } catch {
    throw new ExternalOutcomeUnknown('Takvim güncellemesi beklenen bilgilerle doğrulanamadı.');
  }
}

async function busyOtherEvents(
  kind: CalendarKind,
  calendar: string,
  headers: Record<string, string>,
  input: CalendarEventUpdateInput,
): Promise<TimeRange[]> {
  const start = new Date(Date.parse(input.start) - input.buffer * 60_000).toISOString();
  const end = new Date(Date.parse(input.end) + input.buffer * 60_000).toISOString();
  const query = new URLSearchParams(
    kind === 'google_calendar'
      ? { timeMin: start, timeMax: end, singleEvents: 'true', maxResults: '2500' }
      : {
          startDateTime: start,
          endDateTime: end,
          $top: '1000',
          $select: 'id,start,end,showAs,isCancelled',
        },
  );
  const result = await requestJson(
    `${base(kind, calendar)}/${kind === 'google_calendar' ? 'events' : 'calendarView'}?${query}`,
    { headers: readHeaders(headers) },
  );
  if (result.nextPageToken || result['@odata.nextLink'])
    throw new ProviderError('Takvim aralığı eksik döndü; çakışma kontrolü tamamlanamadı.', 422);
  const values = kind === 'google_calendar' ? result.items : result.value;
  if (!Array.isArray(values)) throw new ProviderError('Takvim çakışma kontrolü eksik döndü.');
  return values
    .map(object)
    .filter(
      (event) =>
        event.id !== input.eventId &&
        !cancelled(event) &&
        event.transparency !== 'transparent' &&
        event.showAs !== 'free',
    )
    .map((event) => {
      // All-day Google events are occupied local dates, not malformed timed events.
      if (kind === 'google_calendar' && typeof object(event.start).date === 'string')
        return { start, end };
      return { start: eventTime(kind, event.start), end: eventTime(kind, event.end) };
    });
}
async function writeEvent(
  kind: CalendarKind,
  calendar: string,
  headers: Record<string, string>,
  input: CalendarEventCancelInput,
  method: 'PATCH' | 'DELETE',
  body?: JsonObject,
): Promise<void> {
  try {
    await requestJson(
      eventUrl(kind, calendar, input.eventId, false),
      {
        method,
        headers: { ...readHeaders(headers), 'If-Match': input.expected.version },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      { write: true, allowEmpty: method === 'DELETE' },
    );
  } catch (error) {
    if (error instanceof ProviderError && error.providerStatus === 412) conflict();
    throw error;
  }
}

/** Caller checks permission/approval and serializes this calendar's external writes. */
export async function updateCalendarEvent(
  kind: CalendarKind,
  config: JsonObject,
  secrets: JsonObject,
  input: CalendarEventUpdateInput,
): Promise<VerifiedResult> {
  validateExpected(kind, input);
  assertSafeText(input.title, 'Etkinlik başlığı', 300);
  if (
    typeof input.description !== 'string' ||
    input.description.length > 100_000 ||
    input.description.includes('\0')
  )
    throw new ProviderError('Etkinlik açıklaması geçerli değil.', 422, 'invalid_input');
  // Reuse all rule validation, then enforce the exact approved appointment duration.
  calculateCalendarSlots(input, []);
  if (
    Date.parse(input.end) - Date.parse(input.start) !== input.duration * 60_000 ||
    !withinCalendarHours(Date.parse(input.start), Date.parse(input.end), input)
  )
    throw new ProviderError(
      'Randevu süresi veya çalışma saatleri işletme kurallarıyla eşleşmiyor.',
      422,
      'calendar_rule_violation',
    );
  const headers = await authHeaders(kind, config, secrets);
  const identity = await calendarIdentity(kind, config, headers);
  assertIdentity(identity, input.expected);
  const record = await readEvent(kind, identity.calendarId, headers, input.eventId);
  if (!record) conflict('Onaylanan etkinlik artık takvimde bulunmuyor.');
  if (operationReference(kind, record) === input.reference)
    return verifyUpdate(kind, record, input);
  assertFresh(snapshot(kind, identity, record), input.expected);
  if (record.isOnlineMeeting === true && input.description !== input.expected.description)
    throw new ProviderError(
      'Çevrimiçi toplantının bağlantı bilgilerini korumak için açıklaması bu işlemle değiştirilemez.',
      422,
    );
  const busy = await busyOtherEvents(kind, identity.calendarId, headers, input);
  const left = Date.parse(input.start) - input.buffer * 60_000;
  const right = Date.parse(input.end) + input.buffer * 60_000;
  if (busy.some((event) => left < Date.parse(event.end) && right > Date.parse(event.start)))
    conflict('Bu saat artık uygun değil. Yeni bir saat seçilmeli.');
  const body: JsonObject =
    kind === 'google_calendar'
      ? {
          summary: input.title,
          description: input.description,
          start: { dateTime: input.start, timeZone: input.timezone },
          end: { dateTime: input.end, timeZone: input.timezone },
          extendedProperties: {
            ...object(record.extendedProperties ?? {}),
            private: {
              ...object(object(record.extendedProperties ?? {}).private ?? {}),
              afterhoursOperation: input.reference,
            },
          },
        }
      : {
          subject: input.title,
          ...(input.description !== input.expected.description
            ? { body: { contentType: 'Text', content: input.description } }
            : {}),
          start: { dateTime: iso(input.start).slice(0, -1), timeZone: 'UTC' },
          end: { dateTime: iso(input.end).slice(0, -1), timeZone: 'UTC' },
          singleValueExtendedProperties: [
            ...(Array.isArray(record.singleValueExtendedProperties)
              ? record.singleValueExtendedProperties
                  .map(object)
                  .filter((property) => property.id !== OPERATION_PROPERTY)
              : []),
            { id: OPERATION_PROPERTY, value: input.reference },
          ],
        };
  await writeEvent(kind, identity.calendarId, headers, input, 'PATCH', body);
  try {
    const readBack = await readEvent(kind, identity.calendarId, headers, input.eventId);
    if (!readBack) throw new Error('Missing updated event');
    return verifyUpdate(kind, readBack, input);
  } catch {
    throw new ExternalOutcomeUnknown(
      'Takvim kaydı güncellenmiş olabilir; doğrulama için inceleme gerekiyor.',
    );
  }
}

/** Caller requires admin approval. Unknown outcomes need review, never a blind DELETE retry. */
export async function cancelCalendarEvent(
  kind: CalendarKind,
  config: JsonObject,
  secrets: JsonObject,
  input: CalendarEventCancelInput,
): Promise<VerifiedResult> {
  validateExpected(kind, input);
  const headers = await authHeaders(kind, config, secrets);
  const identity = await calendarIdentity(kind, config, headers);
  assertIdentity(identity, input.expected);
  const record = await readEvent(kind, identity.calendarId, headers, input.eventId);
  if (!record || cancelled(record)) {
    const previous = input.previousCancellation;
    if (
      previous?.verified === true &&
      previous.externalRecordId === input.eventId &&
      previous.evidence.action === 'cancel' &&
      previous.evidence.cancelled === true &&
      previous.evidence.reference === input.reference &&
      previous.evidence.targetFingerprint === fingerprint(input.expected)
    )
      return verified('cancel', input);
    throw new ExternalOutcomeUnknown(
      'Etkinlik artık mevcut değil; bu iptal işleminin sonucu kanıtlanamadı.',
    );
  }
  assertFresh(snapshot(kind, identity, record), input.expected);
  await writeEvent(kind, identity.calendarId, headers, input, 'DELETE');
  try {
    const readBack = await readEvent(kind, identity.calendarId, headers, input.eventId);
    if (readBack && !cancelled(readBack)) throw new Error('Event remains active');
    return verified('cancel', input);
  } catch {
    throw new ExternalOutcomeUnknown(
      'Takvim kaydı iptal edilmiş olabilir; doğrulama için inceleme gerekiyor.',
    );
  }
}
