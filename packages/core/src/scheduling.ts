import { CronExpressionParser } from 'cron-parser';

export const DEFAULT_TIMEZONE = 'Europe/Istanbul';

export function validateTimezone(timezone: string): string {
  if (!timezone || timezone.length > 100) throw new Error('Select a valid timezone.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error('Unrecognized timezone. Example: Europe/Istanbul.');
  }
  return timezone;
}

export function validateCron(expression: string, timezone = DEFAULT_TIMEZONE): void {
  validateTimezone(timezone);
  // Minute resolution keeps jobs appropriate for a local business workstation.
  // Five-field syntax also makes the schedule shown in the panel unambiguous.
  if (expression.trim().split(/\s+/).length !== 5 || expression.length > 150) {
    throw new Error('The schedule must have five fields: minute hour day month weekday.');
  }
  try {
    CronExpressionParser.parse(expression, { tz: timezone, currentDate: new Date() }).next();
  } catch {
    throw new Error('The cron schedule is invalid or has no future run time.');
  }
}

export function nextRunAt(
  expression: string,
  timezone = DEFAULT_TIMEZONE,
  after = new Date(),
): Date {
  validateCron(expression, timezone);
  if (!Number.isFinite(after.getTime())) throw new Error('A valid start time is required.');
  return CronExpressionParser.parse(expression, { tz: timezone, currentDate: after })
    .next()
    .toDate();
}

export interface ScheduleDecision {
  due: boolean;
  runAt: Date | null;
  nextRunAt: Date;
  missed: boolean;
}

/** Advance from now, never enqueue each missed occurrence after Mac downtime. */
export function decideSchedule(args: {
  expression: string;
  timezone: string;
  scheduledAt: Date | null;
  now?: Date;
  running?: boolean;
  graceMs?: number;
}): ScheduleDecision {
  const now = args.now ?? new Date();
  const next = nextRunAt(args.expression, args.timezone, now);
  const scheduled = args.scheduledAt;
  const graceMs = args.graceMs ?? 60_000;
  if (!scheduled || scheduled > now) {
    return { due: false, runAt: null, nextRunAt: scheduled ?? next, missed: false };
  }
  const missed = now.getTime() - scheduled.getTime() > graceMs;
  return {
    due: !missed && !args.running,
    runAt: !missed && !args.running ? scheduled : null,
    nextRunAt: next,
    missed,
  };
}
