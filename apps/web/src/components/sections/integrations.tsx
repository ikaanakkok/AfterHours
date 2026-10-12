'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleHelp,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { ConnectionView } from '@afterhours/core';
import { ProviderLogo } from '../provider-logo';
import {
  Button,
  Checkbox,
  Empty,
  Input,
  Notice,
  Panel,
  Status,
  TextArea,
  field,
  formatTime,
  type SectionProps,
} from '../ui';

export type ChannelKind =
  | 'whatsapp'
  | 'gmail'
  | 'outlook'
  | 'google_calendar'
  | 'microsoft_calendar'
  | 'sms'
  | 'ivr'
  | 'voice_whatsapp'
  | 'voice_phone';
type Availability = { google: boolean; microsoft: boolean };
const services: Array<{
  kind: ChannelKind;
  title: string;
  description: string;
  icon: LucideIcon;
  family?: 'google' | 'microsoft';
  unavailable?: boolean;
}> = [
  {
    kind: 'whatsapp',
    title: 'WhatsApp',
    description: 'Connect the account on your phone by scanning a QR code.',
    icon: MessageSquare,
  },
  {
    kind: 'gmail',
    title: 'Gmail',
    description: 'Receive email and draft replies with your Google account.',
    icon: Mail,
    family: 'google',
  },
  {
    kind: 'outlook',
    title: 'Outlook',
    description: 'Manage email with your Microsoft account.',
    icon: Mail,
    family: 'microsoft',
  },
  {
    kind: 'google_calendar',
    title: 'Google Calendar',
    description: 'Connect your calendar to manage availability and appointments.',
    icon: CalendarDays,
    family: 'google',
  },
  {
    kind: 'microsoft_calendar',
    title: 'Microsoft Calendar',
    description: 'Manage appointments in your Microsoft calendar.',
    icon: CalendarDays,
    family: 'microsoft',
  },
  {
    kind: 'sms',
    title: 'SMS',
    description: 'Record your SMS needs. Sending is not available yet.',
    icon: MessageSquare,
    unavailable: true,
  },
  {
    kind: 'ivr',
    title: 'IVR',
    description: 'Record your phone menu needs. Calling is not available yet.',
    icon: Phone,
    unavailable: true,
  },
  {
    kind: 'voice_whatsapp',
    title: 'WhatsApp Calls',
    description: 'Baileys supports messaging. Live call audio is not available yet.',
    icon: Phone,
    unavailable: true,
  },
  {
    kind: 'voice_phone',
    title: 'iPhone + Mac Calls',
    description: 'Setup guide for Bluetooth and Apple call relay.',
    icon: Phone,
    unavailable: true,
  },
];
const stepsFor = (kind: ChannelKind): string[] =>
  kind === 'whatsapp'
    ? [
        'Give this channel a name and describe what you will use it for.',
        'On your phone, open WhatsApp → Settings → Linked devices → Link a device. On Android, open Linked devices from the menu.',
        'Scan the QR code below with your phone. The status will update automatically once the connection is verified.',
      ]
    : kind === 'gmail' || kind === 'outlook'
      ? [
          'Name the business account you want to connect and describe how you will use its email.',
          'Select Connect with your account, then choose your business email account.',
          'Review and approve the provider’s permission screen. You will return to AfterHours once verification is complete.',
        ]
      : kind.includes('calendar')
        ? [
            'Name the calendar and describe how you will use it for appointments or scheduling.',
            'Connect with your Google or Microsoft account and approve calendar access.',
            'Once the connection is verified, set appointment durations and business hours in Calendar.',
          ]
        : kind === 'voice_phone'
          ? [
              'Use the same Apple Account on your iPhone and Mac.',
              'Turn on Bluetooth and connect both devices to the same Wi-Fi network. On iPhone, enable Calls on Other Devices; on Mac, enable Calls from iPhone in FaceTime settings.',
              'Run the device check in Voice Channels. Bluetooth or USB detection does not give AI access to call audio, and automatic answering is not available yet.',
            ]
          : kind === 'voice_whatsapp'
            ? [
                'For messaging, choose the WhatsApp channel and scan its QR code from the Linked devices screen.',
                'The account connects through Baileys. BlackHole is not used.',
                'The current Baileys version cannot answer live calls or carry call audio, so this channel does not answer calls automatically.',
              ]
            : [
                'Name the channel and describe how your business plans to use it.',
                'Setup requestni kaydedin.',
                'This channel will remain unavailable until its provider connection is implemented.',
              ];

export function Integrations({ data, command, busy, notify }: SectionProps) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ChannelKind | null>(null);
  const [editing, setEditing] = useState<ConnectionView | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const isAdmin = data.user.role === 'admin';
  const connections = data.connections.filter((connection) =>
    services.some((service) => service.kind === connection.kind),
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    void fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'channel.setup.status',
        payload: {},
        tenantId: data.tenant.id,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Setup unavailable');
        return response.json();
      })
      .then((body) => {
        if (!controller.signal.aborted) setAvailability(body.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability({ google: false, microsoft: false });
      });
    const result = new URLSearchParams(window.location.search).get('setup');
    if (result === 'connected' || result === 'failed') {
      notify(
        result === 'connected'
          ? 'Your account is connected and verified.'
          : 'Could not connect the account. Check the permissions and try again.',
        result === 'failed',
      );
      window.history.replaceState(null, '', window.location.pathname);
    }
    return () => controller.abort();
  }, [data.tenant.id, isAdmin, notify]);
  async function saved(id: string) {
    if (!mounted.current) return;
    setActiveId(id);
    setAdding(false);
    setKind(null);
    setEditing(null);
  }
  function openNew() {
    setAdding(!adding);
    setKind(null);
    setEditing(null);
  }
  return (
    <div className="stack">
      <div className="row between wrap">
        <Notice>
          Choose a service to get started. We’ll guide you through connecting your account—no
          password or technical connection settings required.
        </Notice>
        {isAdmin && (
          <Button variant="primary" disabled={!!busy} onClick={openNew}>
            <Plus size={14} aria-hidden="true" /> Add channel
          </Button>
        )}
      </div>
      {adding && isAdmin && !kind && (
        <Panel
          title="Which channel would you like to connect?"
          description="Each service has its own setup steps."
          action={
            <Button small disabled={!!busy} onClick={() => setAdding(false)}>
              Close
            </Button>
          }
        >
          <div className="panel-body service-picker">
            {services.map((service) => {
              const Icon = service.icon;
              return (
                <button
                  type="button"
                  className="service-choice"
                  key={service.kind}
                  disabled={!!busy}
                  onClick={() => setKind(service.kind)}
                >
                  <ProviderLogo kind={service.kind} size={31} />
                  {![
                    'whatsapp',
                    'gmail',
                    'outlook',
                    'google_calendar',
                    'microsoft_calendar',
                  ].includes(service.kind) && <Icon size={25} aria-hidden="true" />}
                  <strong>{service.title}</strong>
                  <span>{service.description}</span>
                  {service.unavailable && <span className="status">Setup request</span>}
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </Panel>
      )}
      {adding && kind && isAdmin && (
        <ChannelSetup
          key={`${editing?.id ?? 'new'}-${kind}`}
          kind={kind}
          editing={editing}
          command={command}
          busy={busy}
          onSaved={saved}
          onBack={() => {
            setKind(null);
            setEditing(null);
          }}
          onClose={() => {
            setAdding(false);
            setKind(null);
            setEditing(null);
          }}
        />
      )}
      <div className="integration-grid">
        {connections.map((connection) => {
          const service = services.find((service) => service.kind === connection.kind)!;
          const Icon = service.icon;
          const active = activeId === connection.id;
          const oauthReady = service.family ? availability?.[service.family] === true : false;
          return (
            <section className="panel integration" key={connection.id}>
              <div className="row">
                <div className={`integration-logo service-${connection.kind}`}>
                  {[
                    'whatsapp',
                    'gmail',
                    'outlook',
                    'google_calendar',
                    'microsoft_calendar',
                  ].includes(connection.kind) ? (
                    <ProviderLogo kind={connection.kind as ChannelKind} size={28} />
                  ) : (
                    <Icon size={23} aria-hidden="true" />
                  )}
                </div>
                <div className="spacer">
                  <h2>{connection.name}</h2>
                  <p className="muted">{service.title}</p>
                </div>
                <Status value={connection.status} />
              </div>
              <p className="muted" style={{ marginTop: 14, lineHeight: 1.7 }}>
                {connection.purpose}
              </p>
              <div className="integration-detail">
                <div>
                  Hesap
                  <strong>
                    {typeof connection.config.accountEmail === 'string'
                      ? connection.config.accountEmail
                      : connection.config.mode === 'demo'
                        ? 'Local demo account'
                        : connection.realAccountVerified
                          ? 'Account verified'
                          : 'Connection pending'}
                  </strong>
                </div>
                <div>
                  Last verified
                  <strong>{formatTime(connection.lastTestAt, true, data.config.timezone)}</strong>
                </div>
              </div>
              {service.unavailable && (
                <Notice variant="orange">
                  This channel is not available yet. You can save a setup request, but it will not
                  send customer messages or start calls.
                </Notice>
              )}
              {connection.lastError && <Notice variant="orange">{connection.lastError}</Notice>}
              {isAdmin && (
                <div className="row wrap" style={{ marginTop: 14 }}>
                  <Button
                    small
                    disabled={!!busy}
                    aria-expanded={active}
                    onClick={() => setActiveId(active ? null : connection.id)}
                  >
                    <CircleHelp size={14} aria-hidden="true" />
                    {active
                      ? 'Close setup'
                      : connection.status === 'ready'
                        ? 'Connection details'
                        : 'Continue setup'}
                  </Button>
                  <Button
                    small
                    disabled={!!busy}
                    onClick={() => {
                      setEditing(connection);
                      setKind(connection.kind as ChannelKind);
                      setAdding(true);
                    }}
                  >
                    <Settings2 size={14} aria-hidden="true" /> Edit usage
                  </Button>
                  <Button
                    small
                    disabled={!!busy}
                    variant={connection.status === 'disabled' ? '' : 'danger'}
                    onClick={() =>
                      void command('connection.update', {
                        id: connection.id,
                        enabled: connection.status === 'disabled',
                      })
                    }
                  >
                    {connection.status === 'disabled' ? 'Enable' : 'Disable'}
                  </Button>
                  <Button
                    small
                    disabled={!!busy}
                    variant="danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          'Remove this channel from Front Desk Channels? Past conversations and operation records will be kept.',
                        )
                      )
                        void command('channel.setup.delete', { id: connection.id });
                    }}
                  >
                    Remove channel
                  </Button>
                </div>
              )}
              {active && isAdmin && (
                <div className="stack" style={{ marginTop: 20 }}>
                  <SetupSteps kind={service.kind} />
                  {service.kind === 'whatsapp' ? (
                    connection.config.mode === 'demo' ? (
                      <Notice>
                        This is a local demo channel. Add a new WhatsApp channel to pair a phone.
                      </Notice>
                    ) : (
                      <WhatsAppPairing
                        key={`${data.tenant.id}-${connection.id}-${String(connection.config.linkAttempt)}`}
                        connection={connection}
                        tenantId={data.tenant.id}
                        command={command}
                        busy={busy}
                        workerOnline={data.runtime.workerOnline}
                      />
                    )
                  ) : service.family && !service.unavailable ? (
                    <>
                      <Notice>
                        {oauthReady
                          ? 'Your password is never entered in AfterHours. Choose your account and approve the provider’s permission screen.'
                          : 'Account connection setup is not complete on this Mac yet. Once setup is complete, you will be able to connect your account in one step.'}
                      </Notice>
                      <Button
                        variant="primary"
                        disabled={!!busy || !oauthReady || connection.status === 'disabled'}
                        onClick={async () => {
                          const result = await command('channel.oauth.start', {
                            id: connection.id,
                          });
                          const url = result?.data?.url;
                          if (typeof url === 'string' && mounted.current) {
                            const target = new URL(url);
                            if (
                              (service.family === 'google' &&
                                target.origin === 'https://accounts.google.com') ||
                              (service.family === 'microsoft' &&
                                target.origin === 'https://login.microsoftonline.com')
                            )
                              window.location.assign(target.href);
                          }
                        }}
                      >
                        <ArrowRight size={14} aria-hidden="true" />
                        {service.family === 'google'
                          ? 'Connect with Google'
                          : 'Connect with Microsoft'}
                      </Button>
                      {connection.status === 'ready' && (
                        <Notice>
                          Account connection verified. Its use and selected permissions are governed
                          by your business rules.
                        </Notice>
                      )}
                    </>
                  ) : null}
                  <div className="channel-permissions">
                    <h3>Permissions you granted</h3>
                    <ul>
                      {connection.permissions.map((permission) => (
                        <li key={permission}>
                          {(
                            {
                              'message.send': 'Reply to customers',
                              'email.read': 'Read emails',
                              'email.draft': 'Draft replies',
                              'email.send': 'Send emails',
                              'calendar.read': 'View availability',
                              'calendar.create': 'Create appointments',
                              'calendar.update': 'Update appointments',
                              'calendar.cancel': 'Cancel appointments',
                            } as Record<string, string>
                          )[permission] ?? 'Authorized action'}
                        </li>
                      ))}
                    </ul>
                    <p className="hint">
                      Automatic customer replies also follow the active hours in Business Settings.
                    </p>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {!connections.length && (
        <Panel title="Front Desk Channels">
          <Empty icon={MessageSquare} title="Connect your first customer channel">
            Select Add channel, choose a service, and follow the setup steps.
          </Empty>
        </Panel>
      )}
      <style jsx global>{`
        .service-picker {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }
        .service-choice {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 10px;
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 19px;
          background: var(--surface);
          color: var(--ink);
          text-align: left;
          cursor: pointer;
        }
        .service-choice:hover {
          border-color: var(--accent);
        }
        .service-choice span:not(.status) {
          color: var(--muted);
          font-size: 12px;
          line-height: 1.6;
        }
        .setup-steps {
          display: grid;
          gap: 10px;
          list-style: none;
          padding: 0;
          counter-reset: step;
        }
        .setup-steps li {
          display: flex;
          gap: 12px;
          line-height: 1.65;
          font-size: 13px;
        }
        .setup-steps li::before {
          content: counter(step);
          counter-increment: step;
          flex: 0 0 25px;
          height: 25px;
          border-radius: 50%;
          background: var(--accent-light);
          color: #5233c9;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
        }
        .pairing-box {
          border: 1px dashed var(--line);
          border-radius: 10px;
          padding: 18px;
          text-align: center;
        }
        .pairing-box .qr-image {
          width: 288px;
          max-width: 100%;
          height: auto;
        }
        .channel-permissions ul {
          margin: 10px 0;
          padding-left: 20px;
          font-size: 13px;
          line-height: 1.9;
        }
        @media (max-width: 800px) {
          .service-picker {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 500px) {
          .service-picker {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function SetupSteps({ kind }: { kind: ChannelKind }) {
  return (
    <ol className="setup-steps" aria-label="Setup steps">
      {stepsFor(kind).map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}
function ChannelSetup({
  kind,
  editing,
  command,
  busy,
  onSaved,
  onBack,
  onClose,
}: {
  kind: ChannelKind;
  editing: ConnectionView | null;
  command: SectionProps['command'];
  busy: string | null;
  onSaved: (id: string) => Promise<void>;
  onBack: () => void;
  onClose: () => void;
}) {
  const service = services.find((service) => service.kind === kind)!;
  const [customerReplies, setCustomerReplies] = useState(
    editing?.agents.includes('customer') ?? false,
  );
  const [emailSend, setEmailSend] = useState(editing?.permissions.includes('email.send') ?? false);
  const [calendarWrite, setCalendarWrite] = useState(
    editing?.permissions.includes('calendar.create') ?? false,
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await command('channel.setup.save', {
      ...(editing ? { id: editing.id } : {}),
      kind,
      name: field(form, 'name'),
      purpose: field(form, 'purpose'),
      customerReplies,
      emailSend,
      calendarWrite,
      ...(kind.includes('calendar')
        ? { calendarId: String(editing?.config.calendarId ?? 'primary') }
        : {}),
    });
    if (typeof result?.data?.id === 'string') await onSaved(result.data.id);
  }
  return (
    <Panel
      title={`${service.title} · ${editing ? 'Edit usage' : 'Kurulum'}`}
      description={service.description}
      action={
        <Button small disabled={!!busy} onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="panel-body stack">
        <Button small disabled={!!busy} onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" /> Change service
        </Button>
        <SetupSteps kind={kind} />
        <form className="form-stack" onSubmit={save}>
          <Input
            label="What would you like to name this channel?"
            name="name"
            placeholder={
              kind === 'whatsapp' ? 'e.g. Store WhatsApp' : `e.g. Business ${service.title}`
            }
            defaultValue={editing?.name}
            required
            maxLength={120}
            disabled={!!busy}
          />
          <TextArea
            label="How will you use this channel?"
            name="purpose"
            placeholder={
              kind.includes('calendar')
                ? 'We manage appointments in this calendar.'
                : 'We handle customer orders and information requests here.'
            }
            defaultValue={editing?.purpose}
            required
            rows={3}
            maxLength={8000}
            disabled={!!busy}
          />
          {kind.includes('calendar') && (
            <Notice>
              Your account’s primary calendar will be used. The connection is verified after you
              sign in.
            </Notice>
          )}
          {!service.unavailable && (
            <fieldset>
              <legend>What should AfterHours be able to do?</legend>
              <div className="stack">
                <Checkbox
                  label="Allow the customer assistant to use this channel"
                  checked={customerReplies}
                  disabled={!!busy}
                  onChange={(event) => setCustomerReplies(event.target.checked)}
                />
                {(kind === 'gmail' || kind === 'outlook') && (
                  <>
                    <p className="hint">
                      Reading emails and drafting replies are the primary uses of this connection.
                    </p>
                    <Checkbox
                      label="Allow email sending after required approvals"
                      checked={emailSend}
                      disabled={!!busy}
                      onChange={(event) => setEmailSend(event.target.checked)}
                    />
                  </>
                )}
                {kind.includes('calendar') && (
                  <>
                    <p className="hint">
                      Viewing availability is the primary use of this connection.
                    </p>
                    <Checkbox
                      label="Allow appointment creation during available hours"
                      checked={calendarWrite}
                      disabled={!!busy}
                      onChange={(event) => setCalendarWrite(event.target.checked)}
                    />
                  </>
                )}
              </div>
            </fieldset>
          )}
          <Notice>
            <ShieldCheck size={14} aria-hidden="true" /> Do not enter your password here. WhatsApp
            pairs with your phone; email and calendar accounts connect through the provider’s own
            consent screen.
          </Notice>
          <Button
            type="submit"
            variant="primary"
            disabled={!!busy}
            busy={busy === 'channel.setup.save'}
          >
            {service.unavailable
              ? 'Save setup request'
              : kind === 'whatsapp'
                ? 'Save and show QR code'
                : 'Save and connect account'}
            <ArrowRight size={14} aria-hidden="true" />
          </Button>
        </form>
      </div>
    </Panel>
  );
}

function WhatsAppPairing({
  connection,
  tenantId,
  command,
  busy,
  workerOnline,
}: {
  connection: ConnectionView;
  tenantId: string;
  command: SectionProps['command'];
  busy: string | null;
  workerOnline: boolean;
}) {
  const [qr, setQr] = useState<{ image: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const ready = connection.status === 'ready';
  const disabled = connection.status === 'disabled';
  useEffect(() => {
    if (ready || disabled) return;
    const controller = new AbortController();
    let fetching = false;
    async function poll() {
      if (fetching) return;
      fetching = true;
      try {
        const response = await fetch(
          `/api/channels/whatsapp/qr?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(connection.id)}`,
          { cache: 'no-store', signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Could not retrieve the QR code.');
        if (controller.signal.aborted) return;
        const image = body.data?.qr,
          expiresAt = Date.parse(body.data?.expiresAt ?? '');
        setQr(
          typeof image === 'string' &&
            /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) &&
            expiresAt > Date.now()
            ? { image, expiresAt }
            : null,
        );
        setError(null);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setQr(null);
          setError(cause instanceof Error ? cause.message : 'Could not retrieve the QR code.');
        }
      } finally {
        fetching = false;
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [tenantId, connection.id, ready, disabled]);
  useEffect(() => {
    if (!qr) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((qr.expiresAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) setQr(null);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [qr]);
  if (ready)
    return (
      <Notice>
        <Check size={16} aria-hidden="true" /> Your WhatsApp account is connected. QR pairing is
        complete.
      </Notice>
    );
  if (disabled) return <Notice>This channel is disabled. Enable it before pairing.</Notice>;
  return (
    <div className="stack">
      <div className="pairing-box">
        {qr ? (
          <>
            <Image
              src={qr.image}
              alt="QR code to scan from Linked devices in WhatsApp on your phone"
              className="qr-image"
              width={288}
              height={288}
              unoptimized
            />
            <p className="hint">
              The QR code expires in {remaining} seconds. Scan it with your phone.
            </p>
          </>
        ) : (
          <>
            <QrCode size={42} aria-hidden="true" />
            <p style={{ marginTop: 12 }}>
              {workerOnline
                ? 'Preparing WhatsApp QR code…'
                : 'The AfterHours connection service must be running to pair your account.'}
            </p>
            <p className="hint">The code will appear here automatically when it is ready.</p>
          </>
        )}
      </div>
      {error && <Notice variant="error">{error}</Notice>}
      <Button
        disabled={!!busy || !workerOnline}
        onClick={() => {
          setQr(null);
          void command('whatsapp.connect', { id: connection.id });
        }}
      >
        <RefreshCw size={14} aria-hidden="true" /> Generate a new QR code
      </Button>
      <p className="hint">
        This QR code is only for pairing this business account. Automatic replies follow your active
        hours and granted permissions.
      </p>
    </div>
  );
}
