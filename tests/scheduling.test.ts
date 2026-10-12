import { describe, expect, it } from 'vitest';
import {
  decideSchedule,
  nextRunAt,
  validateCron,
  validateTimezone,
} from '../packages/core/src/scheduling';

describe('cron scheduling', () => {
  it('uses the configured timezone rather than the host timezone', () => {
    const after = new Date('2026-10-12T05:30:00Z');
    expect(nextRunAt('0 9 * * 1-5', 'Europe/Istanbul', after).toISOString()).toBe(
      '2026-10-12T06:00:00.000Z',
    );
    expect(nextRunAt('0 9 * * 1-5', 'America/New_York', after).toISOString()).toBe(
      '2026-10-12T13:00:00.000Z',
    );
  });
  it('rejects invalid schedules, seconds and unknown timezones', () => {
    expect(() => validateCron('99 * * * *')).toThrow();
    expect(() => validateCron('* * * * * *')).toThrow();
    expect(() => validateTimezone('AfterHours/Mac')).toThrow();
    expect(() => validateCron('*/10 * * * *', 'Europe/Istanbul')).not.toThrow();
  });
  it('skips the backlog after downtime and advances from now', () => {
    const decision = decideSchedule({
      expression: '*/10 * * * *',
      timezone: 'Europe/Istanbul',
      scheduledAt: new Date('2026-10-12T05:00:00Z'),
      now: new Date('2026-10-12T12:02:00Z'),
    });
    expect(decision).toMatchObject({ due: false, runAt: null, missed: true });
    expect(decision.nextRunAt.toISOString()).toBe('2026-10-12T12:10:00.000Z');
  });
  it('runs a recent slot once and skips overlaps', () => {
    const args = {
      expression: '*/10 * * * *',
      timezone: 'Europe/Istanbul',
      scheduledAt: new Date('2026-10-12T12:00:00Z'),
      now: new Date('2026-10-12T12:00:12Z'),
    };
    expect(decideSchedule(args).due).toBe(true);
    expect(decideSchedule({ ...args, running: true })).toMatchObject({ due: false, runAt: null });
  });
});
