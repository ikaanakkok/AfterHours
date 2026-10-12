import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelCalendarEvent,
  prepareCalendarEvent,
  updateCalendarEvent,
  type CalendarEventSnapshot,
} from '../packages/core/src/integrations/calendar-operations.js';
import type { CalendarKind } from '../packages/core/src/integrations/calendar.js';
import { ExternalOutcomeUnknown, ProviderError } from '../packages/core/src/integrations/http.js';
import type { JsonObject } from '../packages/core/src/types.js';

const config = { calendarId: 'business-calendar', accountEmail: 'owner@example.test' };
const secrets = { accessToken: 'controlled-token' };
const referenceProperty = 'String {515b734a-d438-4344-aeb7-830dfb9fa436} Name AfterHoursOperation';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const update = {
  eventId: 'known-event',
  title: 'Görüşme ✨',
  description: "Yeni açıklama > SQL' özel karakterleri",
  start: '2026-10-12T09:00:00Z',
  end: '2026-10-12T09:45:00Z',
  timezone: 'Europe/Istanbul',
  duration: 45,
  buffer: 10,
  hours: [{ day: 1, start: '09:00', end: '18:00' }],
  reference: 'operation-update',
};
function initial(kind: CalendarKind): JsonObject {
  return kind === 'google_calendar'
    ? {
        id: 'known-event',
        etag: '"v1"',
        summary: 'Eski görüşme',
        description: 'Eski açıklama',
        start: { dateTime: '2026-10-12T08:00:00Z' },
        end: { dateTime: '2026-10-12T08:45:00Z' },
        status: 'confirmed',
        extendedProperties: { private: { afterhoursReference: 'create-original' } },
      }
    : {
        id: 'known-event',
        '@odata.etag': 'W/"v1"',
        changeKey: 'v1',
        subject: 'Eski görüşme',
        body: { contentType: 'text', content: 'Eski açıklama' },
        start: { dateTime: '2026-10-12T08:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-10-12T08:45:00.0000000', timeZone: 'UTC' },
        isCancelled: false,
        singleValueExtendedProperties: [],
      };
}

function provider(kind: CalendarKind) {
  let record: JsonObject | null = initial(kind);
  const state = {
    account: 'owner@example.test',
    calendar: 'business-calendar',
    denied: false,
    staleOnWrite: false,
    unreadableAfterWrite: false,
    mismatchAfterWrite: false,
    timeoutOnWrite: false,
    busy: [] as JsonObject[],
    get record() {
      return record;
    },
    set record(value: JsonObject | null) {
      record = value;
    },
  };
  const fetch = vi.fn(async (target: string | URL, init?: RequestInit) => {
    const url = new URL(String(target));
    const method = init?.method ?? 'GET';
    if (url.pathname.endsWith('/users/me/calendarList'))
      return json({
        items: [
          { id: state.account, primary: true, accessRole: 'owner' },
          { id: state.calendar, accessRole: state.denied ? 'reader' : 'owner' },
        ],
      });
    if (url.pathname.endsWith('/me'))
      return json({ id: 'account-1', mail: state.account, userPrincipalName: state.account });
    if (!url.pathname.includes('/events') && !url.pathname.endsWith('/calendarView'))
      return json({ id: state.calendar, canEdit: !state.denied, name: 'Business' });
    if (url.pathname.endsWith('/events') || url.pathname.endsWith('/calendarView'))
      return json(kind === 'google_calendar' ? { items: state.busy } : { value: state.busy });
    if (method === 'GET') {
      if (state.unreadableAfterWrite) return json({ error: 'unavailable' }, 503);
      if (!record) return json({ error: 'not found' }, 404);
      return json(record);
    }
    if (state.staleOnWrite) return json({ error: 'etag mismatch' }, 412);
    if (state.timeoutOnWrite) throw new Error('Timeout');
    if (method === 'DELETE') {
      record = null;
      return new Response(null, { status: 204 });
    }
    if (method !== 'PATCH') throw new Error('Unexpected method');
    const body = JSON.parse(String(init?.body)) as JsonObject;
    record = {
      ...record,
      ...body,
      ...(kind === 'google_calendar'
        ? { etag: '"v2"' }
        : { '@odata.etag': 'W/"v2"', changeKey: 'v2' }),
    };
    if (state.mismatchAfterWrite) {
      if (kind === 'google_calendar') record.description = 'Mismatched';
      else record.body = { contentType: 'text', content: 'Mismatched' };
    }
    return json(record);
  });
  vi.stubGlobal('fetch', fetch);
  return {
    state,
    fetch,
    writes: () =>
      fetch.mock.calls.filter(([, init]) => ['PATCH', 'DELETE'].includes(init?.method ?? '')),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(['google_calendar', 'microsoft_calendar'] as const)(
  '%s frozen calendar operations',
  (kind) => {
    it('prepares the account, canonical calendar, event version and complete original target before approval', async () => {
      provider(kind);
      const snapshot = await prepareCalendarEvent(kind, config, secrets, 'known-event');
      expect(snapshot).toMatchObject({
        kind,
        calendarId: config.calendarId,
        accountEmail: config.accountEmail,
        eventId: 'known-event',
        version: kind === 'google_calendar' ? '"v1"' : 'W/"v1"',
        title: 'Eski görüşme',
        description: 'Eski açıklama',
        start: '2026-10-12T08:00:00.000Z',
        end: '2026-10-12T08:45:00.000Z',
      });
    });
    it('updates with If-Match, rereads every approved field and reconciles repeated requests without another write', async () => {
      const fake = provider(kind);
      const expected = await prepareCalendarEvent(kind, config, secrets, update.eventId);
      const input = { ...update, expected };
      const result = await updateCalendarEvent(kind, config, secrets, input);
      expect(result).toMatchObject({
        verified: true,
        externalRecordId: 'known-event',
        evidence: { reference: update.reference, readBackVerified: true, action: 'update' },
      });
      const second = await updateCalendarEvent(kind, config, secrets, input);
      expect(second.verified).toBe(true);
      expect(fake.writes()).toHaveLength(1);
      const headers = new Headers(fake.writes()[0]?.[1]?.headers);
      expect(headers.get('If-Match')).toBe(expected.version);
      if (kind === 'google_calendar')
        expect(fake.state.record?.extendedProperties).toEqual({
          private: {
            afterhoursReference: 'create-original',
            afterhoursOperation: update.reference,
          },
        });
      else
        expect(fake.state.record?.singleValueExtendedProperties).toContainEqual({
          id: referenceProperty,
          value: update.reference,
        });
    });
    it('cancels only a known versioned target and proves absence after DELETE 204', async () => {
      const fake = provider(kind);
      const expected = await prepareCalendarEvent(kind, config, secrets, update.eventId);
      const input = { eventId: update.eventId, expected, reference: 'operation-cancel' };
      const result = await cancelCalendarEvent(kind, config, secrets, input);
      expect(result).toMatchObject({
        verified: true,
        externalRecordId: update.eventId,
        evidence: {
          action: 'cancel',
          cancelled: true,
          reference: input.reference,
          readBackVerified: true,
        },
      });
      await expect(
        cancelCalendarEvent(kind, config, secrets, { ...input, previousCancellation: result }),
      ).resolves.toMatchObject({ verified: true });
      expect(fake.writes()).toHaveLength(1);
      expect(new Headers(fake.writes()[0]?.[1]?.headers).get('If-Match')).toBe(expected.version);
    });
    it('does not count an arbitrary absent event or another operation cancellation as success', async () => {
      const fake = provider(kind);
      const expected = await prepareCalendarEvent(kind, config, secrets, update.eventId);
      fake.state.record = null;
      await expect(
        cancelCalendarEvent(kind, config, secrets, {
          eventId: update.eventId,
          expected,
          reference: 'new-cancel',
        }),
      ).rejects.toBeInstanceOf(ExternalOutcomeUnknown);
      await expect(
        cancelCalendarEvent(kind, config, secrets, {
          eventId: update.eventId,
          expected,
          reference: 'new-cancel',
          previousCancellation: {
            verified: true,
            externalRecordId: update.eventId,
            evidence: { reference: 'other-operation', cancelled: true },
          },
        }),
      ).rejects.toBeInstanceOf(ExternalOutcomeUnknown);
      expect(fake.writes()).toHaveLength(0);
    });
    it('rejects a different configured account, calendar, or event before any write', async () => {
      const fake = provider(kind);
      const expected = await prepareCalendarEvent(kind, config, secrets, update.eventId);
      for (const changed of [
        { ...expected, accountEmail: 'intruder@example.test' },
        { ...expected, calendarId: 'other-calendar' },
        { ...expected, eventId: 'other-event' },
      ]) {
        await expect(
          updateCalendarEvent(kind, config, secrets, { ...update, expected: changed }),
        ).rejects.toBeInstanceOf(ProviderError);
      }
      fake.state.account = 'changed-account@example.test';
      await expect(
        cancelCalendarEvent(kind, config, secrets, {
          eventId: update.eventId,
          expected,
          reference: 'cancel-account',
        }),
      ).rejects.toBeInstanceOf(ProviderError);
      expect(fake.writes()).toHaveLength(0);
    });
    it('blocks an event changed since approval and provider precondition races', async () => {
      const fake = provider(kind);
      const expected = await prepareCalendarEvent(kind, config, secrets, update.eventId);
      fake.state.record = {
        ...fake.state.record,
        ...(kind === 'google_calendar' ? { etag: '"changed"' } : { '@odata.etag': 'W/"changed"' }),
      };
      await expect(
        updateCalendarEvent(kind, config, secrets, { ...update, expected }),
      ).rejects.toMatchObject({ code: 'calendar_conflict', status: 409 });
      expect(fake.writes()).toHaveLength(0);
      fake.state.record = initial(kind);
      fake.state.staleOnWrite = true;
      await expect(
        cancelCalendarEvent(kind, config, secrets, {
          eventId: update.eventId,
          expected,
          reference: 'cancel-race',
        }),
      ).rejects.toMatchObject({ code: 'calendar_conflict', status: 409 });
    });
    it('treats description mismatch and lost readback as unknown outcomes', async () => {
      const fake = provider(kind);
      const expected = await prepareCalendarEvent(kind, config, secrets, update.eventId);
      fake.state.mismatchAfterWrite = true;
      await expect(
        updateCalendarEvent(kind, config, secrets, { ...update, expected }),
      ).rejects.toBeInstanceOf(ExternalOutcomeUnknown);
      await expect(
        updateCalendarEvent(kind, config, secrets, { ...update, expected }),
      ).rejects.toBeInstanceOf(ExternalOutcomeUnknown);
      expect(fake.writes()).toHaveLength(1);
    });
    it('does not retry a timed-out write automatically', async () => {
      const fake = provider(kind);
      const expected = await prepareCalendarEvent(kind, config, secrets, update.eventId);
      fake.state.timeoutOnWrite = true;
      await expect(
        updateCalendarEvent(kind, config, secrets, { ...update, expected }),
      ).rejects.toBeInstanceOf(ExternalOutcomeUnknown);
      expect(fake.writes()).toHaveLength(1);
    });
    it('validates working hours and excludes the original event when checking conflicts', async () => {
      const fake = provider(kind);
      const expected = await prepareCalendarEvent(kind, config, secrets, update.eventId);
      fake.state.busy = [initial(kind)];
      await expect(
        updateCalendarEvent(kind, config, secrets, {
          ...update,
          start: expected.start,
          end: expected.end,
          expected,
        }),
      ).resolves.toMatchObject({ verified: true });
      const other = { ...initial(kind), id: 'another-booking' };
      fake.state.record = initial(kind);
      fake.state.busy = [other];
      await expect(
        updateCalendarEvent(kind, config, secrets, {
          ...update,
          start: expected.start,
          end: expected.end,
          expected,
          reference: 'conflict-operation',
        }),
      ).rejects.toMatchObject({ code: 'calendar_conflict' });
    });
    it('rejects missing authentication, unreadable versions, invalid inputs and read-only calendars', async () => {
      const fake = provider(kind);
      await expect(prepareCalendarEvent(kind, config, {}, update.eventId)).rejects.toMatchObject({
        code: 'missing_credentials',
      });
      for (const invalid of ['', undefined, null, 12])
        await expect(
          prepareCalendarEvent(kind, config, secrets, invalid as unknown as string),
        ).rejects.toBeInstanceOf(ProviderError);
      fake.state.record = { ...initial(kind), etag: undefined, '@odata.etag': undefined };
      await expect(
        prepareCalendarEvent(kind, config, secrets, update.eventId),
      ).rejects.toBeInstanceOf(ProviderError);
      fake.state.record = initial(kind);
      fake.state.denied = true;
      await expect(
        prepareCalendarEvent(kind, config, secrets, update.eventId),
      ).rejects.toBeInstanceOf(ProviderError);
      expect(fake.writes()).toHaveLength(0);
    });
  },
);

it('rejects caller-supplied missing snapshots and invalid update content before fetching', async () => {
  const fake = provider('google_calendar');
  await expect(
    updateCalendarEvent('google_calendar', config, secrets, {
      ...update,
      expected: null as unknown as CalendarEventSnapshot,
    }),
  ).rejects.toBeInstanceOf(ProviderError);
  expect(fake.fetch).not.toHaveBeenCalled();
});
