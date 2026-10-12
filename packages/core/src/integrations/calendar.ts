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
import type { VerifiedResult } from './email.js';

export type CalendarKind = 'google_calendar' | 'microsoft_calendar';
export interface TimeRange {
  start: string;
  end: string;
}
export interface CalendarRules {
  start: string;
  end: string;
  timezone: string;
  duration: number;
  buffer: number;
  hours: Array<{ day: number; start: string; end: string }>;
}
export interface CalendarEventInput extends CalendarRules {
  title: string;
  description: string;
  reference: string;
}

function time(value: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new ProviderError('Takvim zamanları saat dilimi içeren ISO tarihleri olmalı.', 422);
  return Date.parse(value);
}

function clock(value: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== '24:00')
    throw new ProviderError('Çalışma saati geçerli değil.', 422);
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function validateRules(rules: CalendarRules): { start: number; end: number } {
  const start = time(rules.start);
  const end = time(rules.end);
  if (end <= start || end - start > 31 * 86400_000)
    throw new ProviderError('Takvim aralığı en fazla 31 gün olabilir.', 422);
  if (
    !Number.isInteger(rules.duration) ||
    rules.duration < 5 ||
    rules.duration > 24 * 60 ||
    !Number.isInteger(rules.buffer) ||
    rules.buffer < 0 ||
    rules.buffer > 240
  )
    throw new ProviderError('Randevu süresi veya boşluğu geçerli değil.', 422);
  try {
    new Intl.DateTimeFormat('en', { timeZone: rules.timezone }).format(new Date());
  } catch {
    throw new ProviderError('Saat dilimi geçerli değil.', 422);
  }
  if (!Array.isArray(rules.hours) || rules.hours.length === 0)
    throw new ProviderError('Takvim çalışma saatleri henüz belirlenmedi.', 422);
  for (const item of rules.hours) {
    if (
      !Number.isInteger(item.day) ||
      item.day < 0 ||
      item.day > 6 ||
      clock(item.end) <= clock(item.start)
    )
      throw new ProviderError('Takvim çalışma günü/saatleri geçerli değil.', 422);
  }
  return { start, end };
}

function localDate(ms: number, timezone: string): { day: number; date: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ms);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    day: weekdays.indexOf(values.weekday ?? ''),
    date: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function withinCalendarHours(
  start: number,
  end: number,
  rules: Pick<CalendarRules, 'timezone' | 'hours' | 'buffer'>,
): boolean {
  const left = localDate(start - rules.buffer * 60_000, rules.timezone);
  const right = localDate(end + rules.buffer * 60_000 - 1, rules.timezone);
  if (left.date !== right.date) return false;
  return rules.hours.some(
    (hour) =>
      hour.day === left.day && left.minute >= clock(hour.start) && right.minute < clock(hour.end),
  );
}

export function calculateCalendarSlots(rules: CalendarRules, busy: TimeRange[]): TimeRange[] {
  const { start, end } = validateRules(rules);
  const occupied = busy.map((range) => ({ start: time(range.start), end: time(range.end) }));
  const duration = rules.duration * 60_000;
  const buffer = rules.buffer * 60_000;
  const slots: TimeRange[] = [];
  // Five-minute UTC steps preserve DST transitions; local business hours are checked for each candidate.
  for (
    let candidate = Math.ceil(start / 300_000) * 300_000;
    candidate + duration <= end;
    candidate += 300_000
  ) {
    const finish = candidate + duration;
    if (!withinCalendarHours(candidate, finish, rules)) continue;
    if (occupied.some((event) => candidate - buffer < event.end && finish + buffer > event.start))
      continue;
    slots.push({ start: new Date(candidate).toISOString(), end: new Date(finish).toISOString() });
    if (slots.length >= 1500) break;
  }
  return slots;
}

function calendarId(config: JsonObject): string {
  return textField(config, 'calendarId');
}
function googleBase(config: JsonObject): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId(config))}`;
}
function microsoftBase(config: JsonObject): string {
  return `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId(config))}`;
}

export async function testCalendarConnection(
  kind: CalendarKind,
  config: JsonObject,
  secrets: JsonObject,
): Promise<{ verified: boolean; calendar: string }> {
  const headers = await authHeaders(kind, config, secrets);
  const calendar = await requestJson(
    kind === 'google_calendar' ? googleBase(config) : microsoftBase(config),
    { headers },
  );
  return {
    verified: true,
    calendar:
      kind === 'google_calendar' ? textField(calendar, 'summary') : textField(calendar, 'name'),
  };
}

function graphDateTime(value: unknown): string {
  const data = object(value);
  const dateTime = textField(data, 'dateTime');
  // Graph is requested with Prefer: outlook.timezone="UTC". Reject unexpected timezone conversion.
  if (data.timeZone !== 'UTC' && data.timeZone !== 'Etc/UTC')
    throw new ProviderError('Takvim sağlayıcısı beklenmeyen bir saat dilimi döndürdü.');
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(dateTime) ? dateTime : `${dateTime}Z`;
}

async function listBusy(
  kind: CalendarKind,
  config: JsonObject,
  headers: Record<string, string>,
  start: string,
  end: string,
): Promise<TimeRange[]> {
  if (kind === 'google_calendar') {
    const result = await requestJson('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers,
      body: JSON.stringify({ timeMin: start, timeMax: end, items: [{ id: calendarId(config) }] }),
    });
    const calendars = object(result.calendars);
    const target = object(calendars[calendarId(config)]);
    if (Array.isArray(target.errors) && target.errors.length > 0)
      throw new ProviderError('Takvim müsaitliği okunamadı; kayıt oluşturulmadı.');
    if (!Array.isArray(target.busy)) throw new ProviderError('Takvim müsaitliği eksik döndü.');
    return target.busy.map((value) => {
      const range = object(value);
      return { start: textField(range, 'start'), end: textField(range, 'end') };
    });
  }
  const query = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    $select: 'id,start,end,showAs,isCancelled',
    $top: '1000',
  });
  const result = await requestJson(`${microsoftBase(config)}/calendarView?${query}`, {
    headers: { ...headers, Prefer: 'outlook.timezone="UTC"' },
  });
  if (result['@odata.nextLink'])
    throw new ProviderError(
      'Takvim aralığı çok fazla kayıt içeriyor; daha kısa aralık seçin.',
      422,
    );
  if (!Array.isArray(result.value)) throw new ProviderError('Takvim müsaitliği eksik döndü.');
  return result.value
    .map(object)
    .filter((event) => event.showAs !== 'free' && event.isCancelled !== true)
    .map((event) => ({ start: graphDateTime(event.start), end: graphDateTime(event.end) }));
}

export async function getCalendarAvailability(
  kind: CalendarKind,
  config: JsonObject,
  secrets: JsonObject,
  rules: CalendarRules,
): Promise<{ slots: TimeRange[]; busy: TimeRange[] }> {
  validateRules(rules);
  const headers = await authHeaders(kind, config, secrets);
  const busy = await listBusy(kind, config, headers, rules.start, rules.end);
  return { slots: calculateCalendarSlots(rules, busy), busy };
}

const REFERENCE_PROPERTY = 'String {515b734a-d438-4344-aeb7-830dfb9fa436} Name AfterHoursReference';

async function findExisting(
  kind: CalendarKind,
  config: JsonObject,
  headers: Record<string, string>,
  reference: string,
): Promise<JsonObject | null> {
  if (kind === 'google_calendar') {
    const query = new URLSearchParams({
      privateExtendedProperty: `afterhoursReference=${reference}`,
      maxResults: '2',
    });
    const result = await requestJson(`${googleBase(config)}/events?${query}`, { headers });
    if (!Array.isArray(result.items))
      throw new ProviderError('Mevcut takvim kayıtları okunamadı; yeni kayıt oluşturulmadı.');
    const items = result.items.map(object).filter((event) => event.status !== 'cancelled');
    if (items.length > 1)
      throw new ExternalOutcomeUnknown('Aynı referansla birden fazla takvim kaydı bulundu.');
    return items[0] ?? null;
  }
  const escaped = reference.replaceAll("'", "''");
  const query = new URLSearchParams({
    $filter: `singleValueExtendedProperties/Any(ep: ep/id eq '${REFERENCE_PROPERTY}' and ep/value eq '${escaped}')`,
    $expand: `singleValueExtendedProperties($filter=id eq '${REFERENCE_PROPERTY}')`,
    $top: '2',
  });
  const result = await requestJson(`${microsoftBase(config)}/events?${query}`, {
    headers: { ...headers, Prefer: 'outlook.timezone="UTC"' },
  });
  if (!Array.isArray(result.value))
    throw new ProviderError('Mevcut takvim kayıtları okunamadı; yeni kayıt oluşturulmadı.');
  const items = result.value.map(object).filter((event) => event.isCancelled !== true);
  if (items.length > 1)
    throw new ExternalOutcomeUnknown('Aynı referansla birden fazla takvim kaydı bulundu.');
  return items[0] ?? null;
}

function verifyEvent(
  kind: CalendarKind,
  record: JsonObject,
  input: CalendarEventInput,
): VerifiedResult {
  const recordStart =
    kind === 'google_calendar'
      ? textField(object(record.start), 'dateTime')
      : graphDateTime(record.start);
  const recordEnd =
    kind === 'google_calendar'
      ? textField(object(record.end), 'dateTime')
      : graphDateTime(record.end);
  const title = kind === 'google_calendar' ? record.summary : record.subject;
  const actualReference =
    kind === 'google_calendar'
      ? object(object(record.extendedProperties).private).afterhoursReference
      : Array.isArray(record.singleValueExtendedProperties)
        ? record.singleValueExtendedProperties
            .map(object)
            .find((value) => value.id === REFERENCE_PROPERTY)?.value
        : undefined;
  if (
    time(recordStart) !== time(input.start) ||
    time(recordEnd) !== time(input.end) ||
    title !== input.title ||
    actualReference !== input.reference ||
    record.status === 'cancelled' ||
    record.isCancelled === true
  )
    throw new ExternalOutcomeUnknown('Takvim kaydı beklenen bilgilerle eşleşmedi.');
  const id = textField(record, 'id');
  return {
    verified: true,
    externalRecordId: id,
    evidence: {
      provider: kind,
      eventId: id,
      start: input.start,
      end: input.end,
      reference: input.reference,
      readBackVerified: true,
    },
  };
}

/** The caller holds a connection/calendar lease to serialize competing writes. */
export async function createCalendarEvent(
  kind: CalendarKind,
  config: JsonObject,
  secrets: JsonObject,
  input: CalendarEventInput,
): Promise<VerifiedResult> {
  const { start, end } = validateRules(input);
  assertSafeText(input.title, 'Etkinlik başlığı', 300);
  assertSafeText(input.reference, 'İşlem referansı', 200);
  if (end - start !== input.duration * 60_000 || !withinCalendarHours(start, end, input))
    throw new ProviderError(
      'Randevu süresi veya çalışma saatleri işletme kurallarıyla eşleşmiyor.',
      422,
      'calendar_rule_violation',
    );
  const headers = await authHeaders(kind, config, secrets);
  const existing = await findExisting(kind, config, headers, input.reference);
  if (existing) return verifyEvent(kind, existing, input);
  const buffer = input.buffer * 60_000;
  const busy = await listBusy(
    kind,
    config,
    headers,
    new Date(start - buffer).toISOString(),
    new Date(end + buffer).toISOString(),
  );
  if (busy.some((range) => start - buffer < time(range.end) && end + buffer > time(range.start)))
    throw new ProviderError(
      'Bu saat artık uygun değil. Yeni bir saat seçilmeli.',
      409,
      'calendar_conflict',
    );
  const hash = createHash('sha256').update(input.reference).digest('hex');
  const body =
    kind === 'google_calendar'
      ? {
          id: `ah${hash}`,
          summary: input.title,
          description: input.description,
          start: { dateTime: input.start, timeZone: input.timezone },
          end: { dateTime: input.end, timeZone: input.timezone },
          extendedProperties: { private: { afterhoursReference: input.reference } },
        }
      : {
          transactionId: hash,
          subject: input.title,
          body: { contentType: 'Text', content: input.description },
          start: { dateTime: new Date(start).toISOString().slice(0, -1), timeZone: 'UTC' },
          end: { dateTime: new Date(end).toISOString().slice(0, -1), timeZone: 'UTC' },
          singleValueExtendedProperties: [{ id: REFERENCE_PROPERTY, value: input.reference }],
        };
  const base = kind === 'google_calendar' ? googleBase(config) : microsoftBase(config);
  const created = await requestJson(
    `${base}/events`,
    { method: 'POST', headers, body: JSON.stringify(body) },
    { write: true },
  );
  try {
    const id = textField(created, 'id');
    const expand =
      kind === 'microsoft_calendar'
        ? `?$expand=${encodeURIComponent(`singleValueExtendedProperties($filter=id eq '${REFERENCE_PROPERTY}')`)}`
        : '';
    const record = await requestJson(`${base}/events/${encodeURIComponent(id)}${expand}`, {
      headers: { ...headers, Prefer: 'outlook.timezone="UTC"' },
    });
    return verifyEvent(kind, record, input);
  } catch {
    throw new ExternalOutcomeUnknown(
      'Takvim kaydı oluşturulmuş olabilir; kayıt doğrulaması için inceleme gerekiyor.',
    );
  }
}
