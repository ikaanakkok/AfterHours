'use client';

import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  CircleCheck,
  Clock3,
  Inbox,
  Link2,
  ShieldCheck,
  Sun,
  UserRound,
} from 'lucide-react';
import { Empty, formatTime, Panel, Status, type SectionProps } from '../ui';

const eventNames: Record<string, string> = {
  'message.received': 'Customer message received',
  'message.sent': 'Customer reply sent',
  'operation.queued': 'Operation queued',
  'operation.succeeded': 'Operation verified',
  'operation.failed': 'Operation failed',
  'config.updated': 'Business settings updated',
  'workflow.saved': 'Workflow draft saved',
  'workflow.published': 'Workflow published',
  'workflow.trial': 'Workflow tested',
  'cron.created': 'Scheduled task created',
  'cron.run': 'Scheduled task ran',
  'connection.created': 'Link eklendi',
  'connection.tested': 'Connection tested',
  'approval.approved': 'Operation approved',
  'approval.rejected': 'Operation declined',
  'conversation.handoff': 'Conversation handed off to staff',
  'conversation.resume': 'Conversation returned to AI',
  'email.drafted': 'Email draft created',
};
export function eventLabel(event: string) {
  return eventNames[event] ?? event.replace(/[._]/g, ' ');
}
export function actorLabel(type: string) {
  return (
    (
      {
        admin: 'Admin',
        staff: 'Staff',
        customer: 'Customer agent',
        cron: 'Scheduled task',
        system: 'System',
      } as Record<string, string>
    )[type] ?? type
  );
}
export function capabilityLabel(value: string) {
  return (
    (
      {
        'browser.request': 'Create request record',
        'browser.workflow': 'Taught browser task',
        'workflow.text.test': 'Workflow test',
        'workflow.text.run': 'Run workflow',
        'connection.test': 'Connection test',
        'email.send': 'Send email',
        'calendar.read': 'Check calendar availability',
        'calendar.create': 'Calendar event',
        'calendar.update': 'Update calendar event',
        'calendar.cancel': 'Cancel calendar event',
        'workflow.text.execute': 'Run workflow',
        'workflow.step.read': 'Workflow read step',
        'workflow.step.write': 'Workflow create-record step',
        'payment.link': 'Payment link',
      } as Record<string, string>
    )[value] ?? value
  );
}

export function Overview({ data }: SectionProps) {
  const verified = data.operations.filter((operation) => operation.status === 'succeeded');
  const attention =
    data.approvals.filter((item) => item.status === 'pending').length +
    data.handoffs.filter((item) => item.status !== 'resolved').length +
    data.operations.filter((item) => item.status === 'needs_attention').length;
  const latest = data.operations[0];
  const conversation = data.conversations[0];
  const connection = data.connections.find((item) => item.kind === 'browser');
  const metrics = [
    {
      title: 'Customer conversations',
      value: data.conversations.length,
      detail: `${data.conversations.filter((item) => item.mode === 'human').length} conversation(s) managed by staff`,
      icon: Inbox,
    },
    {
      title: 'Verified operations',
      value: verified.length,
      detail: 'Operations checked against evidence',
      icon: CircleCheck,
    },
    {
      title: 'Needs your attention',
      value: attention,
      detail: 'Approval or intervention required',
      icon: ShieldCheck,
    },
    {
      title: 'Scheduled tasks',
      value: data.cronJobs.filter((job) => job.enabled).length,
      detail: `${data.cronJobs.length} active scheduled tasks`,
      icon: Clock3,
    },
  ];
  return (
    <>
      <Panel
        className="overview-attention"
        title={attention ? `${attention} item(s) need your attention` : 'No pending interventions'}
        description={
          attention
            ? 'Review approvals, customer handoffs, and uncertain outcomes.'
            : 'Track your operations and connections below.'
        }
        action={
          <Link href="/agent-operations" className={`button ${attention ? 'primary' : ''}`}>
            <UserRound size={16} aria-hidden="true" /> Review operations{' '}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        }
      >
        <span className="sr-only">Pending work</span>
      </Panel>
      <div className="stats">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              className={`stat ${metric.title === 'Needs your attention' && attention > 0 ? 'attention' : ''}`}
              key={metric.title}
            >
              <div className="stat-title">
                <span>{metric.title}</span>
                <Icon size={15} aria-hidden="true" />
              </div>
              <div className="stat-number">{metric.value}</div>
              <div className="stat-detail">{metric.detail}</div>
            </div>
          );
        })}
      </div>
      <div className="grid-main">
        <div className="stack">
          <section className="briefing">
            <span className="micro" style={{ color: 'var(--accent)' }}>
              YOUR BUSINESS, UNDER YOUR CONTROL
            </span>
            <h2>
              {data.config.automationEnabled
                ? 'Your assistant is active during the hours you set.'
                : 'Get your first task ready to run safely.'}
            </h2>
            <p>
              {data.config.automationEnabled
                ? 'Customer communications follow your active hours. Scheduled tasks run on their own schedules; actions awaiting approval are left for you.'
                : 'Set a purpose for your connection, teach it a task, and verify the result. Automatic customer communication stays off until you enable it.'}
            </p>
            <div className="briefing-stamp" aria-hidden="true">
              <Sun size={29} strokeWidth={1.1} />
            </div>
            <div className="row wrap">
              <Link className="button primary" href="/workflows">
                <BookOpen size={14} aria-hidden="true" />
                Create workflow <ArrowRight size={13} aria-hidden="true" />
              </Link>
              <Link className="button ghost" href="/inbox">
                Try your first request
              </Link>
            </div>
          </section>
          <Panel
            title="From customer request to verified result"
            description="Status of your first end-to-end flow"
            action={
              <Link className="button small" href="/agent-operations">
                View operations <ArrowRight size={12} />
              </Link>
            }
            footer={
              <>
                <ShieldCheck size={13} />A task is not marked complete for the customer until
                verification is finished.
              </>
            }
          >
            <div className="panel-body">
              <div className="row between">
                <div>
                  <h3>Customer / service request</h3>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {connection?.name ?? 'Waiting for browser connection'} ·{' '}
                    {data.runtime.mode === 'demo' ? 'Controlled test site' : 'Connected web system'}
                  </p>
                </div>
                <Status value={latest?.status ?? 'awaiting_test'} />
              </div>
              <div className="progress-steps">
                {[
                  { label: 'Request received', ready: !!conversation },
                  {
                    label: 'Action taken',
                    ready: !!latest && ['verifying', 'succeeded'].includes(latest.status),
                  },
                  {
                    label: 'Verified',
                    ready: latest?.status === 'succeeded',
                  },
                  {
                    label: 'Reply sent',
                    ready: !!conversation?.messages.some(
                      (message) =>
                        message.direction === 'outbound' &&
                        ['delivered', 'sent', 'test_delivered'].includes(message.status),
                    ),
                  },
                ].map((step, index) => (
                  <div className="progress-step" key={step.label}>
                    <div className={`step-dot ${step.ready ? 'done' : ''}`}>
                      {step.ready ? <Check size={12} /> : index + 1}
                    </div>
                    {step.label}
                  </div>
                ))}
              </div>
              {latest ? (
                <div className="row between" style={{ fontSize: 12 }}>
                  <span className="muted">
                    Last action {formatTime(latest.createdAt, true, data.config.timezone)}
                  </span>
                  <span className="mono">{latest.id.slice(0, 8)}</span>
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 12 }}>
                  The first action appears here when you create a test request from the Inbox.
                </p>
              )}
            </div>
          </Panel>
          <Panel
            title="Link durumu"
            description="Test verification and live account verification are tracked separately"
            action={
              <Link className="button small" href="/front-desk-channels">
                All connections
              </Link>
            }
          >
            {data.connections.length ? (
              data.connections.slice(0, 4).map((item) => (
                <div className="list-row" key={item.id}>
                  <div className="list-icon">
                    <Link2 size={16} />
                  </div>
                  <div className="spacer">
                    <div className="list-title">{item.name}</div>
                    <p>
                      {item.realAccountVerified
                        ? 'Verified with live account'
                        : item.kind === 'browser' && item.status === 'ready'
                          ? 'Verified in test environment'
                          : 'Live account not verified yet'}
                    </p>
                  </div>
                  <Status value={item.status} />
                </div>
              ))
            ) : (
              <Empty icon={Link2} title="Add your first connection">
                Connect a system and choose what it can be used for.
              </Empty>
            )}
          </Panel>
        </div>
        <div className="stack">
          <Panel
            title="Son hareketler"
            description="From the central audit log"
            action={
              <Link href="/agent-operations" aria-label="Open audit log">
                <Activity size={15} />
              </Link>
            }
          >
            {data.audit.length ? (
              <div className="timeline">
                {data.audit.slice(0, 6).map((item) => (
                  <div className="timeline-item" key={item.id}>
                    <div className="list-title">{eventLabel(item.event)}</div>
                    <p>{actorLabel(item.actor.type)}</p>
                    <time dateTime={item.createdAt}>
                      {formatTime(item.createdAt, true, data.config.timezone)}
                    </time>
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon={Activity} title="Activity will appear here">
                This area updates as connections, settings, and operations change.
              </Empty>
            )}
          </Panel>
          <Panel title="Queued work" action={<Clock3 size={16} color="var(--muted)" />}>
            {data.cronJobs.some((job) => job.enabled) ? (
              data.cronJobs
                .filter((job) => job.enabled)
                .slice(0, 3)
                .map((job) => (
                  <div className="list-row" key={job.id}>
                    <div className="spacer">
                      <div className="list-title">{job.name}</div>
                      <p>{job.timezone}</p>
                    </div>
                    <small>
                      {job.nextRunAt
                        ? formatTime(job.nextRunAt, true, job.timezone)
                        : 'Calendar pending'}
                    </small>
                  </div>
                ))
            ) : (
              <Empty icon={Clock3} title="Your calendar is empty">
                Create a scheduled task to run a published workflow regularly.
              </Empty>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
