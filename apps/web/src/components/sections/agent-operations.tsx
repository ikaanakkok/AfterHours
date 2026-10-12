'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Activity, Check, MoreHorizontal, UserRound, X } from 'lucide-react';
import {
  Button,
  Empty,
  Evidence,
  Notice,
  Panel,
  Status,
  formatTime,
  type SectionProps,
} from '../ui';
import { actorLabel, capabilityLabel } from './overview';

type Intervention = {
  id: string;
  title: string;
  detail: string;
  status: string;
  createdAt: string;
  operationId?: string | null;
  conversationId?: string | null;
  kind: 'approval' | 'handoff' | 'operation';
  evidence: unknown;
};
export function AgentOperations({ data, command, busy }: SectionProps) {
  const [tab, setTab] = useState<'human' | 'activity'>('human');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const admin = data.user.role === 'admin';
  const rows: Intervention[] = [
    ...data.approvals.map((item): Intervention => {
      const operation = data.operations.find((operation) => operation.id === item.operationId);
      const workflow = operation?.capability.startsWith('workflow.text.')
        ? data.workflows.find((workflow) => workflow.id === operation.workflowId)
        : undefined;
      return {
        ...item,
        title: workflow
          ? `${workflow.name} · ${operation?.inputs.compiledPlan ? 'Approve operation plan' : 'Approve workflow test'}`
          : item.title,
        detail: workflow
          ? `${operation?.inputs.compiledPlan ? 'The operations and inputs below are waiting for your approval.' : 'Your approval is required to run this workflow test.'} ${typeof operation?.inputs.textSnapshot === 'string' ? operation.inputs.textSnapshot : (workflow.sourceText ?? workflow.purpose)}`
          : item.summary,
        kind: 'approval',
        evidence: { ...item.payload, approvalSummary: item.summary },
      };
    }),
    ...data.handoffs.map((item): Intervention => ({
      ...item,
      title:
        data.conversations.find((conversation) => conversation.id === item.conversationId)
          ?.customerName ?? 'Operations intervention',
      detail: item.reason,
      kind: 'handoff',
      evidence: { reason: item.reason, conversationId: item.conversationId, status: item.status },
    })),
    ...data.operations
      .filter(
        (item) =>
          ['needs_attention', 'failed'].includes(item.status) &&
          !data.approvals.some((approval) => approval.operationId === item.id),
      )
      .map((item): Intervention => ({
        ...item,
        title: capabilityLabel(item.capability),
        detail: item.error ?? 'The result needs review.',
        kind: 'operation',
        operationId: item.id,
        evidence: { inputs: item.inputs, result: item.result, error: item.error },
      })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const matching = (value: string) =>
    value.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr'));
  const interventions = rows.filter((item) =>
    matching(`${item.title} ${item.detail} ${item.status}`),
  );
  const operations = [...data.operations]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((item) => matching(`${item.capability} ${item.status} ${item.error ?? ''}`));
  const pending = rows.filter(
    (item) => !['resolved', 'approved', 'rejected'].includes(item.status),
  ).length;
  function more(id: string, content: ReactNode) {
    return (
      <>
        <Button
          small
          aria-expanded={expanded === id}
          aria-controls={`detail-${id}`}
          aria-label="More · Operation details"
          onClick={() => setExpanded(expanded === id ? null : id)}
        >
          <MoreHorizontal size={14} aria-hidden="true" />
          More
        </Button>
        {expanded === id && (
          <div id={`detail-${id}`} className="stack" style={{ marginTop: 12, minWidth: 240 }}>
            {content}
          </div>
        )}
      </>
    );
  }
  return (
    <div className="stack">
      <div className="row between wrap">
        <div className="row" role="tablist" aria-label="Agent Operations tabs">
          <Button
            id="human-tab"
            role="tab"
            aria-selected={tab === 'human'}
            tabIndex={tab === 'human' ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                setTab('activity');
                document.getElementById('activity-tab')?.focus();
              }
            }}
            aria-controls="human-panel"
            variant={tab === 'human' ? 'primary' : ''}
            onClick={() => setTab('human')}
          >
            <UserRound size={14} aria-hidden="true" />
            Human intervention <span className="status orange">{pending}</span>
          </Button>
          <Button
            id="activity-tab"
            role="tab"
            aria-selected={tab === 'activity'}
            tabIndex={tab === 'activity' ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                setTab('human');
                document.getElementById('human-tab')?.focus();
              }
            }}
            aria-controls="activity-panel"
            variant={tab === 'activity' ? 'primary' : ''}
            onClick={() => setTab('activity')}
          >
            <Activity size={14} aria-hidden="true" />
            Agent activity
          </Button>
        </div>
        <label>
          <span className="sr-only">Search operations</span>
          <input
            className="search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search operations or status…"
          />
        </label>
      </div>
      {tab === 'human' ? (
        <div id="human-panel" role="tabpanel" aria-labelledby="human-tab">
          <Panel
            title="Items awaiting human intervention"
            description="Newest first · Human approvals and previous decisions are shown together"
          >
            {interventions.length ? (
              <div
                className="table-wrap"
                role="region"
                aria-label="Table. Scroll horizontally on narrow screens."
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Topic / request</th>
                      <th>Status / human approval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interventions.map((item) => (
                      <tr key={`${item.kind}-${item.id}`}>
                        <td>
                          <strong>{item.title}</strong>
                          <p className="muted" style={{ maxWidth: 290, marginTop: 5 }}>
                            {item.detail.length > 160
                              ? `${item.detail.slice(0, 160)}…`
                              : item.detail}
                          </p>
                          <p className="hint">
                            <time dateTime={item.createdAt}>
                              {formatTime(item.createdAt, true, data.config.timezone)}
                            </time>
                          </p>
                          {more(
                            item.id,
                            <>
                              <p>{item.detail}</p>
                              <p className="hint">
                                Request time:{' '}
                                {formatTime(item.createdAt, true, data.config.timezone)}
                              </p>
                              <Evidence
                                label="Request and operation details"
                                value={item.evidence}
                              />
                              {item.operationId && (
                                <Evidence
                                  label="Related operation and audit trail"
                                  value={{
                                    operation: data.operations.find(
                                      (operation) => operation.id === item.operationId,
                                    ),
                                    audit: data.audit.filter(
                                      (entry) =>
                                        entry.targetId === item.operationId ||
                                        entry.targetId === item.id,
                                    ),
                                  }}
                                />
                              )}
                              {item.conversationId && (
                                <Link
                                  className="button small"
                                  href={`/inbox?conversation=${encodeURIComponent(item.conversationId)}`}
                                >
                                  Open conversation
                                </Link>
                              )}
                              {item.kind === 'approval' &&
                                item.status === 'pending' &&
                                (admin ? (
                                  <div className="row wrap">
                                    <Button
                                      small
                                      variant="primary"
                                      disabled={!!busy}
                                      onClick={() =>
                                        void command('approval.resolve', {
                                          id: item.id,
                                          decision: 'approve',
                                        })
                                      }
                                    >
                                      <Check size={13} aria-hidden="true" />
                                      Onayla
                                    </Button>
                                    <Button
                                      small
                                      variant="danger"
                                      disabled={!!busy}
                                      onClick={() =>
                                        void command('approval.resolve', {
                                          id: item.id,
                                          decision: 'reject',
                                        })
                                      }
                                    >
                                      <X size={13} aria-hidden="true" />
                                      Reddet
                                    </Button>
                                  </div>
                                ) : (
                                  <Notice>Business admin approval is required.</Notice>
                                ))}
                            </>,
                          )}
                        </td>
                        <td>
                          <Status value={item.status} />
                          {item.kind === 'approval' && item.status === 'approved' && (
                            <p className="hint">Human approval received</p>
                          )}
                          {item.kind === 'handoff' && item.status === 'resolved' && (
                            <p className="hint">Resolved by staff</p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={UserRound}
                title={search ? 'No matching items found' : 'No items need intervention'}
              >
                Approvals, customer handoffs, and tasks that could not be safely completed appear
                here.
              </Empty>
            )}
          </Panel>
        </div>
      ) : (
        <div id="activity-panel" role="tabpanel" aria-labelledby="activity-tab">
          <Panel
            title="Agent activity"
            description="Newest first · Records show actual results and verification status"
          >
            {operations.length ? (
              <div
                className="table-wrap"
                role="region"
                aria-label="Table. Scroll horizontally on narrow screens."
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Operation / system</th>
                      <th>Started by</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operations.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{capabilityLabel(item.capability)}</strong>
                          <p className="hint">
                            {data.connections.find(
                              (connection) => connection.id === item.connectionId,
                            )?.name ??
                              data.workflows.find((workflow) => workflow.id === item.workflowId)
                                ?.name ??
                              'Business operation'}
                          </p>
                          <p className="hint">
                            <time dateTime={item.createdAt}>
                              {formatTime(item.createdAt, true, data.config.timezone)}
                            </time>
                          </p>
                          {more(
                            item.id,
                            <>
                              {item.error && <Notice variant="error">{item.error}</Notice>}
                              <Evidence
                                label="Inputs, result, and evidence"
                                value={{
                                  id: item.id,
                                  startedAt: item.createdAt,
                                  updatedAt: item.updatedAt,
                                  inputs: item.inputs,
                                  result: item.result,
                                }}
                              />
                              <Evidence
                                label="Audit log"
                                value={data.audit.filter((entry) => entry.targetId === item.id)}
                              />
                              {item.conversationId && (
                                <Link
                                  className="button small"
                                  href={`/inbox?conversation=${encodeURIComponent(item.conversationId)}`}
                                >
                                  Open related conversation
                                </Link>
                              )}
                            </>,
                          )}
                        </td>
                        <td>{actorLabel(item.actor.type)}</td>
                        <td>
                          <Status value={item.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={Activity}
                title={search ? 'No matching operations' : 'No operations yet'}
              >
                Invoices, ERP and customer operations, and workflow runs are listed here for
                reference. incelenebilir.
              </Empty>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
