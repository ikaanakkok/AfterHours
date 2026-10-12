'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Check, MessageSquare, Save, Send } from 'lucide-react';
import {
  Button,
  Empty,
  Evidence,
  formatTime,
  Notice,
  Panel,
  Status,
  TextArea,
  type SectionProps,
} from '../ui';

export function Management({ data, command, busy }: SectionProps) {
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = message;
    if (await command('management.message', { body: submitted }))
      setMessage((current) => (current === submitted ? '' : current));
  }
  const actionLabels: Record<string, string> = {
    'config.update': 'Update business settings',
    'context.text.add': 'Add business information',
    'context.link.add': 'Add information link',
    'context.answer': 'Answer an information question',
    'backoffice.save': 'Save business system',
    'backoffice.test': 'Verify business system sign-in',
    'backoffice.mcp.save': 'Save MCP system',
    'backoffice.mcp.test': 'Discover MCP tools',
    'channel.setup.save': 'Set up communication account',
    'channel.oauth.start': 'Connect account',
    'connection.create': 'Add connection',
    'connection.update': 'Update connection',
    'connection.test': 'Test connection',
    'workflow.text.save': 'Save workflow description',
    'workflow.text.test': 'Start workflow test',
    'workflow.text.confirm': 'Confirm test result',
    'workflow.text.toggle': 'Change workflow status',
    'workflow.questions.analyze': 'Review workflow questions',
    'workflow.questions.answer': 'Answer workflow question',
    'email.draft': 'Draft email',
    'email.send': 'Send email',
    'calendar.query': 'Check calendar availability',
    'calendar.create': 'Create calendar event',
    'calendar.update': 'Update calendar event',
    'calendar.cancel': 'Request calendar cancellation approval',
    'mcp.execute': 'Start an operation in an authorized connected system',
  };
  const labels: Record<string, string> = {
    appointmentDuration: 'Appointment duration',
    appointmentBuffer: 'Buffer between appointments',
    tone: 'Conversation tone',
    automationEnabled: 'Automatic communication',
    requireApproval: 'Actions requiring approval',
    businessName: 'Business name',
    description: 'Business description',
    language: 'Language',
    timezone: 'Time zone',
  };
  return (
    <div className="grid-main">
      <div className="stack">
        <Notice
          variant={
            data.connections.some(
              (item) =>
                item.kind === 'ai_provider' &&
                item.status === 'ready' &&
                item.config.enabled === true,
            )
              ? ''
              : 'orange'
          }
        >
          {data.connections.some(
            (item) =>
              item.kind === 'ai_provider' &&
              item.status === 'ready' &&
              item.config.enabled === true,
          )
            ? 'The management assistant uses the AI provider selected and tested in the panel. Suggestions take effect only after you apply them.'
            : 'The management assistant is waiting for an AI provider to be set up and tested. Choose one on the AI Providers page; your message will remain in the conversation history.'}
        </Notice>
        <Panel
          title="Tell us about your business"
          description="Context-aware suggestions for your business, connections, and workflows"
        >
          <div className="panel-body">
            <div
              className="admin-chat"
              aria-label="Management assistant conversation"
              role="log"
              aria-live="polite"
            >
              {data.adminMessages.length ? (
                data.adminMessages.map((item) => (
                  <div
                    key={item.id}
                    className={`message ${item.role === 'user' ? 'outbound' : ''}`}
                  >
                    <div className="micro" style={{ fontSize: 12, marginBottom: 6 }}>
                      {item.role === 'user' ? 'YOU' : 'MANAGEMENT ASSISTANT'}
                    </div>
                    {item.body}
                    <div className="message-meta">
                      {formatTime(item.createdAt, false, data.config.timezone)}
                    </div>
                  </div>
                ))
              ) : (
                <Empty icon={MessageSquare} title="Let’s define your business together">
                  For example, “Set appointments to 45 minutes with a 15-minute buffer” Review the
                  suggestion before applying it.
                </Empty>
              )}
            </div>
            <form className="form-stack" onSubmit={submit} style={{ marginTop: 18 }}>
              <TextArea
                label="Your message to the management assistant"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Appointments at our business last 45 minutes…"
                required
                maxLength={10000}
                rows={3}
              />
              <div className="row between">
                <span className="muted" style={{ fontSize: 12 }}>
                  Only available to authorized business admins
                </span>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!!busy || !message.trim()}
                  busy={busy === 'management.message'}
                >
                  <Send size={13} />
                  Send
                </Button>
              </div>
            </form>
            <div className="row wrap" style={{ marginTop: 15 }}>
              <Button
                small
                onClick={() =>
                  setMessage('Set appointments to 45 minutes with a 15-minute buffer.')
                }
              >
                Appointment durations
              </Button>
              <Button
                small
                onClick={() => setMessage('Reply to customers in a brief, friendly tone.')}
              >
                Conversation tone
              </Button>
            </div>
          </div>
        </Panel>
        <Panel
          title="Suggested actions"
          description="Permissions, current records, and approvals are checked at every step"
        >
          {(data.managementPlans ?? []).length ? (
            data.managementPlans!.map((plan) => (
              <div className="panel-body stack" key={plan.id}>
                <div className="row between">
                  <h3>{plan.summary}</h3>
                  <Status value={plan.status} />
                </div>
                <ol>
                  {plan.steps.map((step, index) => (
                    <li key={index} style={{ marginBottom: 12 }}>
                      <strong>{actionLabels[step.command] ?? 'Business operation'}</strong> ·{' '}
                      <Status value={step.status} />
                      <Evidence
                        label="Suggested change and step result"
                        value={{ inputs: step.payload, result: step.result, error: step.error }}
                      />
                      {typeof step.result?.data?.url === 'string' && (
                        <a
                          className="button small"
                          href={step.result.data.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Connect account
                        </a>
                      )}
                    </li>
                  ))}
                </ol>
                {plan.error && <Notice variant="orange">{plan.error}</Notice>}
                {plan.status === 'pending' && (
                  <Button
                    small
                    variant="primary"
                    disabled={!!busy}
                    onClick={() => void command('proposal.apply', { id: plan.id })}
                  >
                    <Check size={13} />
                    Apply suggestion
                  </Button>
                )}
                {plan.status === 'awaiting_operation' && (
                  <Notice>
                    Waiting for operation verification or admin approval. Review it in Agent
                    Operations. sonucu izleyin.
                  </Notice>
                )}
                {plan.status === 'awaiting_user' && (
                  <Notice>Complete the account connection or requested human approval.</Notice>
                )}
              </div>
            ))
          ) : (
            <Empty icon={Save} title="No action suggestions yet">
              The assistant clarifies missing information with brief questions. Review the resulting
              suggestion here inceleyebilirsiniz.
            </Empty>
          )}
        </Panel>
        <Panel
          title="Configuration suggestions"
          description="Suggestions are tied to the current configuration version"
        >
          {data.proposals.length ? (
            data.proposals.map((proposal) => (
              <div
                className="panel-body stack"
                key={proposal.id}
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                <div className="row between">
                  <h3>{proposal.summary}</h3>
                  <Status value={proposal.status} />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Base settings version: v{proposal.baseVersion} · Current version: v
                  {data.config.version}
                </div>
                <div className="tag-list">
                  {Object.entries(proposal.patch).map(([key, value]) => (
                    <span key={key} className="status blue">
                      {labels[key] ?? key}:{' '}
                      {typeof value === 'boolean'
                        ? value
                          ? 'On'
                          : 'Off'
                        : Array.isArray(value)
                          ? value.join(', ')
                          : String(value)}
                    </span>
                  ))}
                </div>
                {proposal.status === 'pending' && (
                  <>
                    <Notice variant={proposal.baseVersion !== data.config.version ? 'orange' : ''}>
                      {proposal.baseVersion !== data.config.version
                        ? 'Settings have changed since this suggestion was created. Create a new suggestion using the latest settings.'
                        : proposal.risk === 'normal' || proposal.risk === 'standard'
                          ? 'This changes the same persistent setting used by the app, chat, and panel.'
                          : 'This change requires additional admin approval. The approval summary appears under Pending work.'}
                    </Notice>
                    <Button
                      variant="primary"
                      small
                      disabled={!!busy || proposal.baseVersion !== data.config.version}
                      onClick={() => void command('proposal.apply', { id: proposal.id })}
                    >
                      <Check size={13} />
                      Apply suggestion
                    </Button>
                  </>
                )}
              </div>
            ))
          ) : (
            <Empty icon={Save} title="No settings suggestions yet">
              Changes agreed in the conversation can be reviewed here before being saved to the
              persistent configuration. uygulanabilir.
            </Empty>
          )}
        </Panel>
      </div>
      <Panel
        title="Current business settings"
        description={`The panel and chat use the same configuration · v${data.config.version}`}
        action={
          <Link href="/settings" className="button small">
            Edit
          </Link>
        }
      >
        <div className="panel-body stack">
          <div>
            <div className="micro">BUSINESS</div>
            <h3 style={{ marginTop: 7 }}>{data.config.businessName}</h3>
            <p className="muted" style={{ marginTop: 7, fontSize: 12 }}>
              {data.config.description || 'No business description has been added yet.'}
            </p>
          </div>
          <div>
            <div className="micro">CUSTOMER COMMUNICATION</div>
            <p style={{ marginTop: 7, fontSize: 12 }}>
              {data.config.language} · {data.config.tone}
            </p>
            <div style={{ marginTop: 10 }}>
              <Status
                value={data.config.automationEnabled ? 'active' : 'disabled'}
                label={
                  data.config.automationEnabled
                    ? 'Automatic communication on'
                    : 'Automatic communication off'
                }
              />
            </div>
          </div>
          <div>
            <div className="micro">CALENDAR</div>
            <p style={{ fontSize: 12, marginTop: 7 }}>
              {data.config.appointmentDuration} minute appointments ·{' '}
              {data.config.appointmentBuffer} minute buffer
            </p>
            <p className="muted" style={{ fontSize: 12, marginTop: 5 }}>
              {data.config.timezone}
            </p>
          </div>
          <div>
            <div className="micro">ACTION TYPES REQUIRING APPROVAL</div>
            <div className="tag-list" style={{ marginTop: 9 }}>
              {data.config.requireApproval
                .filter((value) => !value.startsWith('payment.'))
                .map((value) => (
                  <span className="status orange" key={value}>
                    {value}
                  </span>
                ))}
            </div>
          </div>
          <Evidence
            value={{
              activeHours: data.config.activeHours,
              calendarHours: data.config.calendarHours,
              knowledge: data.config.knowledge,
            }}
            label="Active hours and business information"
          />
        </div>
      </Panel>
    </div>
  );
}
