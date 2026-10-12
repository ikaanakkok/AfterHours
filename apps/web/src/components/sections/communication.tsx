'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Settings,
  Inbox as InboxIcon,
  Mail,
  MessageSquare,
  Send,
  UserRound,
} from 'lucide-react';
import {
  Button,
  Empty,
  Evidence,
  field,
  formatTime,
  Input,
  Notice,
  Panel,
  Select,
  Status,
  TextArea,
  type SectionProps,
} from '../ui';

export function Inbox({ data, command, busy }: SectionProps) {
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    () => searchParams.get('conversation') || data.conversations[0]?.id || null,
  );
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [conversationOpen, setConversationOpen] = useState(
    () => !!searchParams.get('conversation'),
  );
  const selected = data.conversations.find((item) => item.id === selectedId);
  const reply = selected ? (replies[selected.id] ?? '') : '';
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [selected?.messages.length, selected?.id]);

  async function incoming(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await command('demo.incoming', {
      body: field(form, 'body'),
      name: field(form, 'name'),
      address: field(form, 'address'),
      ...(field(form, 'externalId') ? { externalId: field(form, 'externalId') } : {}),
    });
    if (response?.data && typeof response.data.conversationId === 'string') {
      setSelectedId(response.data.conversationId);
      setConversationOpen(true);
    }
  }
  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const conversationId = selected.id;
    const submitted = replies[conversationId] ?? '';
    if (!submitted.trim()) return;
    if (
      await command('conversation.reply', {
        id: conversationId,
        body: submitted,
      })
    ) {
      setReplies((current) =>
        current[conversationId] === submitted ? { ...current, [conversationId]: '' } : current,
      );
    }
  }
  return (
    <div className="stack">
      <Panel
        title="Ortak gelen kutusu"
        description="Messages, reply status, and staff handoff in one conversation"
        action={<span className="status">{data.conversations.length} conversations</span>}
      >
        <div className={`inbox-layout ${conversationOpen && selected ? 'conversation-open' : ''}`}>
          <div className="conversation-list" aria-label="Conversations">
            {data.conversations.length ? (
              data.conversations.map((item) => (
                <button
                  key={item.id}
                  className="conversation-button"
                  aria-pressed={item.id === selected?.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setConversationOpen(true);
                    window.requestAnimationFrame(() => {
                      document.getElementById('conversation-back')?.focus();
                    });
                  }}
                >
                  <div className="row between">
                    <strong style={{ fontSize: 12 }}>
                      {item.customerName || item.customerAddress}
                    </strong>
                    <time dateTime={item.updatedAt}>
                      {formatTime(item.updatedAt, false, data.config.timezone)}
                    </time>
                  </div>
                  {item.emailSubject && <strong>{item.emailSubject}</strong>}
                  <p>{item.lastMessage}</p>
                  <div className="row between" style={{ marginTop: 8 }}>
                    <span className="micro" style={{ fontSize: 12 }}>
                      {item.channel === 'demo' ? 'TEST MESSAGE' : item.channel}
                    </span>
                    <Status value={item.mode} />
                  </div>
                </button>
              ))
            ) : (
              <Empty icon={MessageSquare} title="No conversations yet">
                Create your first test request below.
              </Empty>
            )}
          </div>
          <div className="chat">
            {selected ? (
              <>
                <div className="chat-heading">
                  <Button
                    id="conversation-back"
                    className="conversation-back"
                    small
                    onClick={() => {
                      setConversationOpen(false);
                      window.requestAnimationFrame(() => {
                        document
                          .querySelector<HTMLButtonElement>(
                            '.conversation-button[aria-pressed="true"]',
                          )
                          ?.focus();
                      });
                    }}
                  >
                    <ArrowLeft size={14} aria-hidden="true" /> Back to conversations
                  </Button>
                  <div className="row between">
                    <div>
                      <h3>{selected.customerName}</h3>
                      <p className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                        {selected.customerAddress}
                      </p>
                    </div>
                    <div className="row">
                      <Status value={selected.mode} />
                      {selected.mode === 'ai' ? (
                        <Button
                          small
                          disabled={!!busy}
                          onClick={() =>
                            void command('conversation.handoff', {
                              id: selected.id,
                              reason: 'Staff took over the conversation from the panel.',
                            })
                          }
                        >
                          <UserRound size={13} />
                          Take over
                        </Button>
                      ) : (
                        <Button
                          small
                          disabled={!!busy}
                          onClick={() =>
                            void command('conversation.resume', {
                              id: selected.id,
                            })
                          }
                        >
                          AI’a geri ver
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <div
                  className="messages"
                  aria-label="Conversation messages"
                  role="log"
                  aria-live="polite"
                >
                  {selected.messages.map((message) => (
                    <div
                      key={message.id}
                      className={`message ${message.direction === 'outbound' ? 'outbound' : ''}`}
                    >
                      <div>{message.body}</div>
                      <div className="message-meta">
                        <time dateTime={message.createdAt}>
                          {formatTime(message.createdAt, false, data.config.timezone)}
                        </time>
                        {message.direction === 'outbound' && <Status value={message.status} />}
                      </div>
                    </div>
                  ))}
                  <div ref={end} />
                </div>
                {['email', 'gmail', 'outlook'].includes(selected.channel) ? (
                  <div className="composer stack">
                    <Notice>
                      Email replies are drafted first. Sending requires separate approval and
                      permission checks.
                    </Notice>
                    <Link className="button" href="/email">
                      Open email drafts
                    </Link>
                  </div>
                ) : (
                  <form key={selected.id} className="composer form-stack" onSubmit={sendReply}>
                    <TextArea
                      label="Staff reply"
                      value={reply}
                      onChange={(event) => {
                        const body = event.target.value;
                        setReplies((current) => ({
                          ...current,
                          [selected.id]: body,
                        }));
                      }}
                      placeholder={
                        selected.mode === 'human'
                          ? 'Write your reply to the customer…'
                          : 'Take over the conversation to reply.'
                      }
                      disabled={selected.mode !== 'human'}
                      required
                      maxLength={10000}
                      rows={2}
                    />
                    <div className="row between">
                      <span className="muted" style={{ fontSize: 12 }}>
                        {selected.mode === 'human'
                          ? 'AI is not replying automatically.'
                          : 'AI replies according to the configured rules.'}
                      </span>
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={!!busy || selected.mode !== 'human' || !reply.trim()}
                        busy={busy === 'conversation.reply'}
                      >
                        <Send size={13} />
                        Send reply
                      </Button>
                    </div>
                  </form>
                )}
              </>
            ) : (
              <Empty icon={InboxIcon} title="Select a conversation">
                Messages and completed actions will appear here when a customer request comes in.
              </Empty>
            )}
          </div>
        </div>
      </Panel>
      {data.user.role === 'admin' && data.runtime.mode === 'demo' && (
        <Panel
          title="Test your first request"
          description="Start a real browser action from a controlled test request"
          footer={
            <>
              <CheckCircle2 size={13} />
              This test does not verify a real WhatsApp account.
            </>
          }
        >
          <div className="panel-body stack">
            {!data.config.automationEnabled && (
              <Notice variant="orange">
                Automatic customer communication is off. The message will be saved. To test the
                action, set active hours in Business Settings and enable automatic communication.
              </Notice>
            )}
            <form className="form-stack" onSubmit={incoming}>
              <div className="fields">
                <Input label="Customer name" name="name" defaultValue="Alex Morgan" required />
                <Input
                  label="Test customer number"
                  name="address"
                  defaultValue="905550001234"
                  required
                />
              </div>
              <TextArea
                label="Incoming customer request"
                name="body"
                defaultValue="Hi, I’m Alex Morgan. I’d like to request air conditioner maintenance. My AC is not cooling."
                required
                maxLength={10000}
              />
              <div className="fields">
                <Input
                  label="Message ID (optional)"
                  name="externalId"
                  hint="Submit the same ID again to test duplicate protection."
                  placeholder="e.g. test-request-001"
                />
                <div className="row" style={{ justifyContent: 'flex-end', alignItems: 'flex-end' }}>
                  <Button
                    type="submit"
                    variant="primary"
                    busy={busy === 'demo.incoming'}
                    disabled={!!busy}
                  >
                    <MessageSquare size={14} />
                    Create test request
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </Panel>
      )}
    </div>
  );
}

export function Email({ data, command, busy }: SectionProps) {
  const canManage = data.user.role === 'admin';
  const accounts = data.connections.filter(
    (item) => item.kind === 'gmail' || item.kind === 'outlook',
  );
  async function configureSync(
    event: FormEvent<HTMLFormElement>,
    account: (typeof accounts)[number],
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const enabled = form.get('enabled') === 'on';
    const draftEnabled = enabled && form.get('draftEnabled') === 'on';
    const permissions = [
      ...new Set([
        ...account.permissions,
        ...(enabled ? ['email.read'] : []),
        ...(draftEnabled ? ['email.draft'] : []),
      ]),
    ];
    const agents = [...new Set([...account.agents, ...(enabled ? ['customer' as const] : [])])];
    await command('connection.update', {
      id: account.id,
      permissions,
      agents,
      config: { ...account.config, emailSync: { enabled, draftEnabled } },
    });
  }
  async function draft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    if (
      await command('email.draft', {
        connectionId: field(form, 'connectionId'),
        to: field(form, 'to'),
        subject: field(form, 'subject'),
        body: field(form, 'body'),
      })
    )
      element.reset();
  }
  return (
    <div className="grid-main">
      <div className="stack">
        <Panel
          title="Incoming e-postalar"
          description="The first sync imports the past 7 days. New messages are checked every 60 seconds"
        >
          {accounts.map((account) => {
            const sync = account.config.emailSync as
              { enabled?: boolean; draftEnabled?: boolean } | undefined;
            return (
              <div className="panel-body stack" key={`${account.id}:${JSON.stringify(sync)}`}>
                <div className="row between">
                  <h3>{account.name}</h3>
                  <Status value={account.status} />
                </div>
                <form
                  className="form-stack"
                  onSubmit={(event) => void configureSync(event, account)}
                >
                  <label className="row">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={sync?.enabled === true}
                      disabled={!canManage || !!busy}
                    />
                    Sync incoming email
                  </label>
                  <label className="row">
                    <input
                      type="checkbox"
                      name="draftEnabled"
                      defaultChecked={sync?.draftEnabled === true}
                      disabled={!canManage || !!busy}
                    />
                    Draft replies with verified AI
                  </label>
                  <p className="hint">
                    New reading and drafting permissions take effect after admin approval and a
                    successful connection test. Sending always requires your action.
                  </p>
                  <Button small type="submit" disabled={!canManage || !!busy}>
                    <Settings size={13} />
                    Save sync settings
                  </Button>
                </form>
                {data.emailSync?.find((item) => item.connectionId === account.id) &&
                  (() => {
                    const view = data.emailSync!.find((item) => item.connectionId === account.id)!;
                    return (
                      <div className="stack">
                        <p className="hint">
                          Last synced:{' '}
                          {view.lastSyncedAt
                            ? formatTime(view.lastSyncedAt, true, data.config.timezone)
                            : 'Not completed yet'}{' '}
                          · Drafts pending: {view.pendingDraftCount}
                        </p>
                        {view.lastError && <Notice variant="orange">{view.lastError}</Notice>}
                      </div>
                    );
                  })()}
              </div>
            );
          })}
          {!accounts.length && (
            <Empty icon={Mail} title="Connect an email account">
              Connect your Gmail or Outlook account in Front Desk Channels.
            </Empty>
          )}
          {data.conversations
            .filter((item) => item.channel === 'email')
            .map((item) => (
              <div className="panel-body" key={item.id}>
                <strong>{item.emailSubject || item.customerName || item.customerAddress}</strong>
                <p>{item.lastMessage.slice(0, 180)}</p>
                <p className="hint">{formatTime(item.updatedAt, true, data.config.timezone)}</p>
              </div>
            ))}
        </Panel>
        <Panel
          title="Email drafts"
          description="Actual email delivery is tracked separately from drafting"
        >
          {data.drafts.length ? (
            data.drafts.map((item) => (
              <div
                key={item.id}
                className="panel-body"
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                <div className="row between">
                  <h3>{item.subject}</h3>
                  <Status value={item.status} />
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 5 }}>
                  To: {item.to} ·{' '}
                  {accounts.find((account) => account.id === item.connectionId)?.name ??
                    'Connected account'}
                </p>
                <p
                  style={{
                    fontSize: 12,
                    margin: '17px 0',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {item.body}
                </p>
                {!['sent', 'delivered'].includes(item.status) && (
                  <Button
                    small
                    variant="primary"
                    busy={busy === 'email.send'}
                    disabled={!canManage || !!busy || item.status === 'awaiting_approval'}
                    onClick={() => void command('email.send', { id: item.id })}
                  >
                    <Send size={12} />
                    {item.status === 'awaiting_approval' ? 'Awaiting send approval' : 'Send email'}
                  </Button>
                )}
              </div>
            ))
          ) : (
            <Empty icon={Mail} title="Create your first draft">
              Create a message for your connected Gmail or Outlook account. Sending permissions and
              approvals are checked separately.
            </Empty>
          )}
        </Panel>
        <Notice variant="orange">
          An email is not marked as sent until the real account connection and delivery are
          verified. Drafting does not grant permission to send.
        </Notice>
      </div>
      <Panel title="New email draft" description="Draft the message first, then approve sending">
        <div className="panel-body">
          {!canManage && (
            <Notice variant="orange">
              In this version, only business admins can draft and send email. Review prepared
              messages here.
            </Notice>
          )}
          {accounts.length ? (
            <form className="form-stack" onSubmit={draft}>
              <Select label="Sending account" name="connectionId" required>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ·{' '}
                    {account.status === 'ready' ? 'ready to use' : 'setup incomplete'}
                  </option>
                ))}
              </Select>
              <Input label="Recipient email" type="email" name="to" required />
              <Input label="Konu" name="subject" required maxLength={240} />
              <TextArea label="Message" name="body" required rows={7} maxLength={20000} />
              <Button
                type="submit"
                variant="primary"
                disabled={!canManage || !!busy}
                busy={busy === 'email.draft'}
              >
                Save draft
              </Button>
            </form>
          ) : (
            <Empty icon={Mail} title="Add an email account">
              Add a Gmail or Outlook account in Front Desk Channels and describe its intended use.
            </Empty>
          )}
        </div>
      </Panel>
    </div>
  );
}

function zonedIso(value: string, zone: string): string {
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!parts) throw new Error('Check the start and end dates.');
  const desired = Date.UTC(
    Number(parts[1]),
    Number(parts[2]) - 1,
    Number(parts[3]),
    Number(parts[4]),
    Number(parts[5]),
  );
  let time = desired;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let iteration = 0; iteration < 3; iteration++) {
    const actual = Object.fromEntries(
      formatter.formatToParts(new Date(time)).map((part) => [part.type, part.value]),
    );
    const wallTime = Date.UTC(
      Number(actual.year),
      Number(actual.month) - 1,
      Number(actual.day),
      Number(actual.hour),
      Number(actual.minute),
    );
    const difference = desired - wallTime;
    if (difference === 0) return new Date(time).toISOString();
    time += difference;
  }
  throw new Error('This time is not valid in the selected time zone. Choose another time.');
}

export function Calendar({ data, command, busy, notify }: SectionProps) {
  const canManage = data.user.role === 'admin';
  const calendars = data.connections.filter(
    (item) => item.kind === 'google_calendar' || item.kind === 'microsoft_calendar',
  );
  const [queryId, setQueryId] = useState<string | null>(null);
  const queryOperation = data.operations.find((operation) => operation.id === queryId);
  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: 'calendar.query' | 'calendar.create',
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const payload = {
        connectionId: field(form, 'connectionId'),
        start: zonedIso(field(form, 'start'), data.config.timezone),
        end: zonedIso(field(form, 'end'), data.config.timezone),
        ...(action === 'calendar.create'
          ? {
              title: field(form, 'title'),
              description: field(form, 'description'),
            }
          : {}),
      };
      const result = await command(action, payload);
      if (result && action === 'calendar.query' && typeof result.data?.operationId === 'string')
        setQueryId(result.data.operationId);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Check the dates.', true);
    }
  }
  return (
    <div className="grid-main">
      <div className="stack">
        <Panel
          title="Calendar events"
          description={`${data.config.appointmentDuration} minutes · ${data.config.appointmentBuffer} minute buffer · ${data.config.timezone}`}
        >
          <div className="panel-body">
            <Notice>
              Availability is checked against the connected calendar. An event is confirmed only
              after the provider verifies its ID.
            </Notice>
          </div>
          {data.calendarEvents.length ? (
            <div
              className="table-wrap"
              role="region"
              aria-label="Table. Scroll horizontally on narrow screens."
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.calendarEvents.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        <div className="muted mono">
                          {item.providerId ?? 'Awaiting provider verification'}
                        </div>
                      </td>
                      <td>{formatTime(item.start, true, data.config.timezone)}</td>
                      <td>{formatTime(item.end, true, data.config.timezone)}</td>
                      <td>
                        <Status value={item.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={CalendarDays} title="No calendar events yet">
              After connecting a calendar, you can check availability and create permitted events.
            </Empty>
          )}
        </Panel>
        {calendars.length > 0 && (
          <Panel
            title="Calendar permissions"
            description="New permissions require admin approval and an account test"
          >
            <div className="panel-body">
              {calendars.map((account) => (
                <form
                  key={`${account.id}:${[...account.permissions].sort().join(',')}`}
                  className="form-stack"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const permissions = [
                      ...account.permissions.filter(
                        (value) => !['calendar.update', 'calendar.cancel'].includes(value),
                      ),
                      ...(form.get('update') ? ['calendar.update'] : []),
                      ...(form.get('cancel') ? ['calendar.cancel'] : []),
                    ];
                    await command('connection.update', { id: account.id, permissions });
                  }}
                >
                  <strong>{account.name}</strong>
                  <label>
                    <input
                      type="checkbox"
                      name="update"
                      disabled={!canManage || !!busy}
                      defaultChecked={account.permissions.includes('calendar.update')}
                    />{' '}
                    Update events
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      name="cancel"
                      disabled={!canManage || !!busy}
                      defaultChecked={account.permissions.includes('calendar.cancel')}
                    />{' '}
                    Cancel events with admin approval
                  </label>
                  <div className="form-actions">
                    <Button type="submit" disabled={!canManage || !!busy}>
                      Save calendar permissions
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!canManage || !!busy}
                      onClick={() => void command('connection.test', { id: account.id })}
                    >
                      Test account again
                    </Button>
                  </div>
                </form>
              ))}
            </div>
          </Panel>
        )}
        {calendars.length > 0 && (
          <Panel
            title="Edit or cancel a calendar event"
            description="The event and its latest version are verified again with the connected account"
          >
            <div className="panel-body">
              <form
                className="form-stack"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  try {
                    await command('calendar.update', {
                      connectionId: field(form, 'connectionId'),
                      eventId: field(form, 'eventId'),
                      title: field(form, 'title'),
                      description: field(form, 'description'),
                      start: zonedIso(field(form, 'start'), data.config.timezone),
                      end: zonedIso(field(form, 'end'), data.config.timezone),
                    });
                  } catch (error) {
                    notify(error instanceof Error ? error.message : 'Check the dates.', true);
                  }
                }}
              >
                <Select label="Calendar account" name="connectionId" required>
                  {calendars.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
                <Input label="Provider event ID" name="eventId" required />
                <Input label="New title" name="title" required />
                <div className="fields">
                  <Input label="New start" name="start" type="datetime-local" required />
                  <Input label="New end" name="end" type="datetime-local" required />
                </div>
                <TextArea label="New description" name="description" rows={2} />
                <div className="row wrap">
                  <Button type="submit" disabled={!canManage || !!busy}>
                    Prepare update
                  </Button>
                  <Button
                    variant="danger"
                    type="button"
                    disabled={!canManage || !!busy}
                    onClick={(event) => {
                      const form = new FormData(event.currentTarget.form!);
                      const eventId = field(form, 'eventId');
                      if (!eventId) {
                        notify('Enter the provider event ID to cancel.', true);
                        return;
                      }
                      void command('calendar.cancel', {
                        connectionId: field(form, 'connectionId'),
                        eventId,
                      });
                    }}
                  >
                    Request cancellation approval
                  </Button>
                </div>
                <p className="hint">
                  Cancellation requires admin approval for the specific event in Agent Operations.
                </p>
              </form>
            </div>
          </Panel>
        )}
        {calendars.length > 0 && (
          <Panel title="Check availability">
            <div className="panel-body">
              <form
                className="form-stack"
                onSubmit={(event) => void submit(event, 'calendar.query')}
              >
                <Select label="Calendar connection" name="connectionId" required>
                  {calendars.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
                <div className="fields">
                  <Input label="Range start" name="start" type="datetime-local" required />
                  <Input label="Range end" name="end" type="datetime-local" required />
                </div>
                <small className="muted">Time zone: {data.config.timezone}</small>
                <Button
                  type="submit"
                  disabled={!canManage || !!busy}
                  busy={busy === 'calendar.query'}
                >
                  Check availability
                </Button>
              </form>
              {queryOperation && (
                <div className="stack" style={{ marginTop: 15 }}>
                  <Status value={queryOperation.status} />
                  <Evidence
                    value={{
                      result: queryOperation.result,
                      error: queryOperation.error,
                    }}
                    label={
                      queryOperation.status === 'succeeded'
                        ? 'Availability returned by provider'
                        : 'Availability check status'
                    }
                  />
                </div>
              )}
            </div>
          </Panel>
        )}
      </div>
      <Panel title="New calendar event" description="Business duration and opening hours apply">
        <div className="panel-body">
          {!canManage && (
            <Notice variant="orange">
              In this version, only business admins can check calendars and create events. Review
              verified events here.
            </Notice>
          )}
          {calendars.length ? (
            <form
              className="form-stack"
              onSubmit={(event) => void submit(event, 'calendar.create')}
            >
              <Select label="Calendar connection" name="connectionId" required>
                {calendars.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Input label="Event title" name="title" required />
              <Input label="Start" name="start" type="datetime-local" required />
              <Input
                label="End"
                name="end"
                type="datetime-local"
                required
                hint={`All times are in the ${data.config.timezone} time zone.`}
              />
              <TextArea label="Description" name="description" rows={3} />
              <Button
                type="submit"
                variant="primary"
                disabled={!canManage || !!busy}
                busy={busy === 'calendar.create'}
              >
                Check availability and create event
              </Button>
            </form>
          ) : (
            <Empty icon={CalendarDays} title="Connect a calendar">
              Connect a Google or Microsoft calendar in Front Desk Channels and describe how you
              will use it.
            </Empty>
          )}
        </div>
      </Panel>
    </div>
  );
}
