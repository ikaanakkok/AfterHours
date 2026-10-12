import { z } from 'zod';
import { HttpError } from './errors.js';
import type { Actor, BusinessConfig, ConnectionView, WorkflowDefinition } from './types.js';

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/);
const hours = z
  .array(z.object({ day: z.number().int().min(0).max(6), start: time, end: time }).strict())
  .max(100);
export const configPatchSchema = z
  .object({
    businessName: z.string().trim().min(1).max(120),
    description: z.string().max(8000),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid timezone'),
    language: z.string().min(2).max(40),
    tone: z.string().max(500),
    automationEnabled: z.boolean(),
    activeHours: hours,
    knowledge: z
      .array(z.object({ title: z.string().max(200), content: z.string().max(8000) }).strict())
      .max(100),
    requireApproval: z.array(z.string().min(1).max(100)).max(100),
    paymentsEnabled: z.boolean(),
    appointmentDuration: z.number().int().min(5).max(480),
    appointmentBuffer: z.number().int().min(0).max(240),
    calendarHours: hours,
  })
  .partial()
  .strict();
export const workflowSchema = z
  .object({
    name: z.string().min(1).max(120),
    purpose: z.string().min(1).max(4000),
    connectionId: z.string().uuid(),
    inputs: z
      .array(
        z
          .object({
            key: z
              .string()
              .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
              .refine(
                (key) => key !== 'reference',
                'İşlem referansı platform tarafından belirlenir.',
              ),
            label: z.string().min(1).max(100),
            required: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(30)
      .refine(
        (inputs) => new Set(inputs.map((input) => input.key)).size === inputs.length,
        'Girdi adları benzersiz olmalı.',
      ),
    steps: z
      .array(
        z.discriminatedUnion('action', [
          z.object({ action: z.literal('goto'), url: z.string().min(1).max(2000) }).strict(),
          z
            .object({
              action: z.literal('fill'),
              selector: z.string().min(1).max(500),
              value: z.string().max(8000),
              secret: z.literal(false).optional(),
            })
            .strict(),
          z.object({ action: z.literal('click'), selector: z.string().min(1).max(500) }).strict(),
          z
            .object({
              action: z.literal('select'),
              selector: z.string().min(1).max(500),
              value: z.string().max(8000),
            })
            .strict(),
          z
            .object({
              action: z.literal('read'),
              selector: z.string().min(1).max(500),
              output: z.string().max(100),
            })
            .strict(),
          z
            .object({
              action: z.literal('assert'),
              selector: z.string().min(1).max(500),
              contains: z.string().max(8000).optional(),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(100),
    verification: z
      .object({
        selector: z.string().min(1),
        recordIdSelector: z.string().min(1),
        expected: z.string().optional(),
      })
      .strict(),
    idempotency: z
      .object({
        lookupUrl: z.string().min(1),
        recordIdSelector: z.string().min(1),
        absentSelector: z.string().optional(),
      })
      .strict(),
    requiresApproval: z.boolean(),
  })
  .strict();
export const defaultConfig = (name: string): BusinessConfig => ({
  version: 1,
  businessName: name,
  description: '',
  timezone: 'Europe/Istanbul',
  language: 'Türkçe',
  tone: 'Kısa, doğal ve yardımsever',
  automationEnabled: false,
  activeHours: [],
  knowledge: [],
  requireApproval: ['email.send', 'payment.link', 'calendar.cancel'],
  paymentsEnabled: false,
  appointmentDuration: 45,
  appointmentBuffer: 15,
  calendarHours: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '18:00' })),
});
export const canonicalCapability = (capability: string) =>
  capability === 'browser.trial' ||
  capability.startsWith('workflow.text.') ||
  capability.startsWith('workflow.step.')
    ? 'browser.execute'
    : capability.startsWith('teaching.')
      ? 'teaching.record'
      : capability;
export const requestsHuman = (body: string) =>
  /(?:insan|personel|yetkili|temsilci|ekip)\s*(?:la|le|ile|bir|istiyorum|görüş|konuş)|(?:human|person|representative|staff|agent)\s*(?:please|now|support)|(?:speak|talk)\s+to\s+(?:a\s+)?(?:human|person|representative)/i.test(
    body,
  );
export function isActive(config: BusinessConfig, at = new Date()) {
  if (!config.automationEnabled || !config.activeHours.length) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (k: string) => parts.find((p) => p.type === k)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
  const current = `${part('hour')}:${part('minute')}`;
  return config.activeHours.some((h) =>
    h.start <= h.end
      ? h.day === day && current >= h.start && current < h.end
      : (h.day === day && current >= h.start) || ((h.day + 1) % 7 === day && current < h.end),
  );
}
export function authorizeConnection(
  conn: Pick<ConnectionView, 'status' | 'permissions' | 'agents'>,
  actor: Actor,
  capability: string,
  { testing = false } = {},
) {
  if (conn.status === 'disabled' || (!testing && conn.status !== 'ready'))
    throw new HttpError(
      409,
      'CONNECTION_NOT_READY',
      'Bağlantının kurulum ve doğrulaması tamamlanmalı.',
    );
  if (!conn.agents.includes(actor.type) || !conn.permissions.includes(capability))
    throw new HttpError(
      403,
      'CAPABILITY_DENIED',
      'Bu ajan ve bağlantı için gerekli işlem izni verilmemiş.',
    );
}
export function validateWorkflowInputs(def: WorkflowDefinition, inputs: Record<string, unknown>) {
  const declared = new Set(def.inputs.map((spec) => spec.key));
  if (Object.keys(inputs).some((key) => !declared.has(key)))
    throw new HttpError(
      400,
      'UNKNOWN_WORKFLOW_INPUT',
      'Yalnızca işin tanımlanmış girdileri kullanılabilir.',
    );
  for (const spec of def.inputs)
    if (spec.required && (typeof inputs[spec.key] !== 'string' || !String(inputs[spec.key]).trim()))
      throw new HttpError(400, 'MISSING_INPUT', `${spec.label} bilgisi gerekiyor.`);
  for (const value of Object.values(inputs))
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      throw new HttpError(400, 'INVALID_INPUT', 'İş girdileri basit metin veya sayılar olmalı.');
  return Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.trim() : value,
    ]),
  ) as Record<string, string | number | boolean>;
}
export function financialTerms(
  record: { verified: boolean; amount: number; currency: string },
  input: Record<string, unknown>,
) {
  if (
    !record.verified ||
    !Number.isSafeInteger(record.amount) ||
    record.amount <= 0 ||
    !/^[a-z]{3}$/.test(record.currency)
  )
    throw new HttpError(409, 'UNVERIFIED_AMOUNT', 'Doğrulanmış tutar ve para birimi gerekiyor.');
  if (
    Object.keys(input).some((k) =>
      [
        'amount',
        'currency',
        'connectedAccount',
        'recipient',
        'approval',
        'role',
        'tenantId',
      ].includes(k),
    )
  )
    throw new HttpError(
      403,
      'UNTRUSTED_FINANCIAL_INPUT',
      'Ödeme bilgileri yalnızca doğrulanmış işletme kaydından alınabilir.',
    );
  return { amount: record.amount, currency: record.currency };
}
