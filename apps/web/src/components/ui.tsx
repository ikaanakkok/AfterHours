'use client';

import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import { CheckCircle2, Info, LoaderCircle, type LucideIcon } from 'lucide-react';

export function Button({
  children,
  variant = '',
  small,
  busy,
  className = '',
  onKeyDown,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: '' | 'primary' | 'danger' | 'ghost';
  small?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || props.role !== 'tab') return;
        const tabs = Array.from(
          event.currentTarget
            .closest('[role="tablist"]')
            ?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [],
        );
        const index = tabs.indexOf(event.currentTarget);
        const next =
          event.key === 'Home'
            ? tabs[0]
            : event.key === 'End'
              ? tabs.at(-1)
              : event.key === 'ArrowRight'
                ? tabs[(index + 1) % tabs.length]
                : event.key === 'ArrowLeft'
                  ? tabs[(index - 1 + tabs.length) % tabs.length]
                  : undefined;
        if (next) {
          event.preventDefault();
          next.click();
          next.focus();
        }
      }}
      className={`button ${variant} ${small ? 'small' : ''} ${className}`}
    >
      {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Panel({
  title,
  description,
  children,
  action,
  footer,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
      {footer && <div className="panel-footer">{footer}</div>}
    </section>
  );
}

export function Empty({
  icon: Icon = Info,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={20} aria-hidden="true" />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Input({
  label,
  hint,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={
          [props['aria-describedby'], hint ? `${id}-hint` : '', error ? `${id}-error` : '']
            .filter(Boolean)
            .join(' ') || undefined
        }
      />
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  error,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        {...props}
        id={id}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={
          [props['aria-describedby'], hint ? `${id}-hint` : '', error ? `${id}-error` : '']
            .filter(Boolean)
            .join(' ') || undefined
        }
      />
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Select({
  label,
  hint,
  error,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        {...props}
        id={id}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={
          [props['aria-describedby'], hint ? `${id}-hint` : '', error ? `${id}-error` : '']
            .filter(Boolean)
            .join(' ') || undefined
        }
      >
        {children}
      </select>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <label className="checkbox" htmlFor={id}>
      <input {...props} id={id} type="checkbox" />
      <span>{label}</span>
    </label>
  );
}

const statuses: Record<string, [string, string]> = {
  setup: ['Setup in progress', ''],
  missing_info: ['Information missing', 'orange'],
  awaiting_test: ['Test required', 'blue'],
  ready: ['Ready to use', 'green'],
  needs_attention: ['Needs attention', 'orange'],
  disabled: ['Disabled', ''],
  queued: ['Queued', 'blue'],
  awaiting_approval: ['Awaiting approval', 'orange'],
  running: ['Running', 'blue'],
  verifying: ['Verifying', 'blue'],
  succeeded: ['Verified', 'green'],
  failed: ['Failed', 'red'],
  ai: ['Managed by AI', 'green'],
  human: ['Managed by staff', 'orange'],
  inbound: ['Incoming', ''],
  outbound: ['Outgoing', ''],
  draft: ['Draft', ''],
  sent: ['Sent', 'green'],
  delivered: ['Delivered', 'green'],
  pending: ['Pending', 'orange'],
  approved: ['Approved', 'green'],
  rejected: ['Declined', 'red'],
  published: ['Published', 'green'],
  applied: ['Applied', 'green'],
  applying: ['Applying', 'blue'],
  awaiting_operation: ['Awaiting action', 'orange'],
  awaiting_user: ['Waiting for you', 'orange'],
  dispatching: ['Starting', 'blue'],
  needs_review: ['Review needed', 'orange'],
  stale: ['Information changed', 'orange'],
  cancelled: ['Cancelled', ''],
  verified: ['Verified', 'green'],
  open: ['Pending', 'orange'],
  resolved: ['Resolved', 'green'],
  active: ['Active', 'green'],
  completed: ['Completed', 'green'],
  prepared: ['Prepared', 'blue'],
  sending: ['Sending', 'blue'],
  received: ['Received', ''],
  awaiting_provider: ['Waiting for AI connection', 'orange'],
  analyzing: ['In progress', 'blue'],
  processing: ['In progress', 'blue'],
  answered: ['Answered', 'green'],
  login_failed: ['Login failed', 'red'],
  test_delivered: ['Delivered in test', 'green'],
};

export function Status({ value, label }: { value: string; label?: string }) {
  const [text, color] = statuses[value] ?? [value, ''];
  return (
    <span className={`status ${color}`}>
      {value === 'succeeded' || value === 'ready' || value === 'verified' ? (
        <CheckCircle2 size={11} aria-hidden="true" />
      ) : null}
      {label ?? text}
    </span>
  );
}

export function Notice({
  children,
  variant = '',
}: {
  children: ReactNode;
  variant?: '' | 'orange' | 'error';
}) {
  return (
    <div className={`notice ${variant}`}>
      <Info size={16} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function formatTime(
  value: string | null | undefined,
  detailed = false,
  timezone = 'Europe/Istanbul',
) {
  if (!value) return 'Not run yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    ...(detailed ? { day: 'numeric', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(date);
}

const sensitive = /password|secret|token|authorization|cookie|api.?key|credential/i;
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitive.test(key) ? '[hidden]' : clean(item),
      ]),
    );
  return value;
}
export function Evidence({
  value,
  label = 'View details and evidence',
}: {
  value: unknown;
  label?: string;
}) {
  return (
    <details>
      <summary>{label}</summary>
      <pre>{JSON.stringify(clean(value), null, 2)}</pre>
    </details>
  );
}

export interface SectionProps {
  data: import('@afterhours/core').WorkspaceView;
  command: (
    action: string,
    payload: unknown,
  ) => Promise<import('@afterhours/core').CommandResult | null>;
  busy: string | null;
  notify: (message: string, error?: boolean) => void;
  refresh?: () => Promise<boolean>;
}

export function jsonValue(text: FormDataEntryValue | null, fallback: unknown = {}): unknown {
  if (!text || typeof text !== 'string' || !text.trim()) return fallback;
  return JSON.parse(text);
}
export function field(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}
