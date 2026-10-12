'use client';

import { useState, type FormEvent } from 'react';
import {
  Check,
  ChevronRight,
  Clock3,
  MessageCircleQuestion,
  Play,
  Plus,
  RefreshCw,
  Workflow,
  X,
} from 'lucide-react';
import type { WorkflowView } from '@afterhours/core';
import {
  Button,
  Empty,
  Evidence,
  Input,
  Notice,
  Panel,
  Status,
  TextArea,
  field,
  formatTime,
  type SectionProps,
} from '../ui';

export function Workflows({ data, command, busy }: SectionProps) {
  const [editing, setEditing] = useState<WorkflowView | null>(null);
  const [open, setOpen] = useState(false);
  const [questionTabs, setQuestionTabs] = useState<Record<string, boolean>>({});
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
  const isAdmin = data.user.role === 'admin';
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      await command('workflow.text.save', {
        ...(editing?.mode === 'text' ? { id: editing.id } : {}),
        name: field(form, 'name'),
        text: field(form, 'text'),
      })
    ) {
      setOpen(false);
      setEditing(null);
    }
  }
  return (
    <div className="stack">
      <div className="row between wrap">
        <Notice>
          Separate steps <strong>&gt;</strong> with and use the saved system names. Schedules such
          as “every 10 minutes” are managed within the workflow.
        </Notice>
        {isAdmin && (
          <Button
            variant="primary"
            disabled={!!busy}
            onClick={() => {
              setEditing(null);
              setOpen(!open);
            }}
          >
            <Plus size={14} aria-hidden="true" />
            Add workflow
          </Button>
        )}
      </div>
      {open && isAdmin && (
        <Panel
          title={editing ? `${editing.name} · Edit` : 'Create a workflow in plain language'}
          action={
            <Button small disabled={!!busy} onClick={() => setOpen(false)}>
              Close
            </Button>
          }
        >
          <form className="panel-body form-stack" key={editing?.id ?? 'new'} onSubmit={save}>
            <Input
              label="Workflow name"
              name="name"
              defaultValue={editing?.name}
              required
              maxLength={200}
            />
            <TextArea
              label="Task description"
              name="text"
              defaultValue={editing?.sourceText ?? editing?.purpose ?? ''}
              rows={7}
              required
              maxLength={20000}
              placeholder="Every 10 minutes, sign in to the Hotel ERP > Check new reservations > Add new entries to the Invoicing system > Verify the result"
              hint="Systems are matched by the names shown on the Backoffice Systems page. Required permissions and a successful sign-in test are needed."
            />
            <Button
              type="submit"
              variant="primary"
              disabled={!!busy}
              busy={busy === 'workflow.text.save'}
            >
              Save draft
            </Button>
          </form>
        </Panel>
      )}
      {data.workflows.map((workflow) => {
        const latest = workflow.latestTestOperationId
          ? data.operations.find((operation) => operation.id === workflow.latestTestOperationId)
          : undefined;
        const jobs = data.cronJobs.filter((job) => job.workflowId === workflow.id);
        const questionCount =
          workflow.clarification?.questions.filter((question) => question.status === 'open')
            .length ?? 0;
        const clarified =
          workflow.clarification?.status === 'ready' &&
          workflow.clarification.analyzedVersion === workflow.version &&
          questionCount === 0;
        const questionsOpen = questionTabs[workflow.id] ?? false;
        const history = data.operations.filter(
          (operation) =>
            operation.workflowId === workflow.id || jobs.some((job) => job.id === operation.cronId),
        );
        return (
          <Panel
            key={workflow.id}
            title={workflow.name}
            description={`v${workflow.version} · ${workflow.enabled ? 'Active' : 'Inactive'}`}
            action={<Status value={workflow.status} />}
          >
            <div className="panel-body stack">
              {workflow.mode === 'text' && (
                <div className="row wrap" role="tablist" aria-label={`${workflow.name} tabs`}>
                  <Button
                    id={`workflow-details-${workflow.id}`}
                    role="tab"
                    aria-selected={!questionsOpen}
                    aria-controls={`workflow-content-${workflow.id}`}
                    tabIndex={questionsOpen ? -1 : 0}
                    variant={!questionsOpen ? 'primary' : ''}
                    onClick={() =>
                      setQuestionTabs((previous) => ({ ...previous, [workflow.id]: false }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                        event.preventDefault();
                        setQuestionTabs((previous) => ({ ...previous, [workflow.id]: true }));
                        document.getElementById(`workflow-questions-${workflow.id}`)?.focus();
                      }
                    }}
                  >
                    Workflow
                  </Button>
                  <Button
                    id={`workflow-questions-${workflow.id}`}
                    role="tab"
                    aria-selected={questionsOpen}
                    aria-controls={`workflow-content-${workflow.id}`}
                    tabIndex={questionsOpen ? 0 : -1}
                    variant={questionsOpen ? 'primary' : ''}
                    onClick={() =>
                      setQuestionTabs((previous) => ({ ...previous, [workflow.id]: true }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                        event.preventDefault();
                        setQuestionTabs((previous) => ({ ...previous, [workflow.id]: false }));
                        document.getElementById(`workflow-details-${workflow.id}`)?.focus();
                      }
                    }}
                  >
                    <MessageCircleQuestion size={14} aria-hidden="true" /> Questions{' '}
                    <span
                      className="workflow-question-count"
                      aria-label={`${questionCount} question awaiting an answer`}
                    >
                      {questionCount}
                    </span>
                  </Button>
                </div>
              )}
              <div
                className="stack"
                id={`workflow-content-${workflow.id}`}
                role={workflow.mode === 'text' ? 'tabpanel' : undefined}
                aria-labelledby={
                  workflow.mode === 'text'
                    ? `${questionsOpen ? 'workflow-questions' : 'workflow-details'}-${workflow.id}`
                    : undefined
                }
              >
                {questionsOpen && workflow.mode === 'text' ? (
                  <WorkflowQuestions
                    workflow={workflow}
                    command={command}
                    busy={busy}
                    isAdmin={isAdmin}
                    drafts={questionDrafts}
                    onDraft={(id, value) =>
                      setQuestionDrafts((previous) => ({ ...previous, [id]: value }))
                    }
                  />
                ) : (
                  <>
                    {workflow.sourceText ? (
                      <div className="workflow-text">
                        <div className="row wrap">
                          {workflow.sourceText.split('>').map((step, index) => (
                            <span
                              className="row"
                              key={`${index}-${step}`}
                              style={{ alignItems: 'flex-start' }}
                            >
                              {index > 0 && <ChevronRight size={15} aria-hidden="true" />}
                              <span>{step.trim()}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <Notice>
                        Task saved from a previous version: {workflow.purpose}. You can revise it as
                        a text-based workflow.
                      </Notice>
                    )}
                    <p className="hint">
                      Sistemler:{' '}
                      {workflow.systemIds
                        ?.map(
                          (id) =>
                            data.connections.find((connection) => connection.id === id)?.name ??
                            'System not found',
                        )
                        .join(', ') ||
                        data.connections.find(
                          (connection) => connection.id === workflow.definition.connectionId,
                        )?.name ||
                        'Metinden belirlenecek'}
                    </p>
                    {workflow.planningError && (
                      <Notice variant="orange">{workflow.planningError}</Notice>
                    )}
                    {workflow.mode === 'text' && !clarified && (
                      <Notice variant="orange">
                        {questionCount
                          ? `${questionCount} question(s) need an answer.`
                          : workflow.clarification?.status === 'awaiting_provider'
                            ? 'Connect a provider on the AI Providers page so the task can be understood.'
                            : 'Let’s review the task and clarify anything uncertain before testing.'}{' '}
                        <Button
                          small
                          onClick={() =>
                            setQuestionTabs((previous) => ({ ...previous, [workflow.id]: true }))
                          }
                        >
                          Open Questions
                        </Button>
                      </Notice>
                    )}
                    {workflow.schedule && (
                      <Notice>
                        <Clock3 size={14} aria-hidden="true" /> Schedule in workflow:{' '}
                        {workflow.schedule.expression} · {workflow.schedule.timezone}
                      </Notice>
                    )}
                    {isAdmin && (
                      <div className="row wrap">
                        <Button
                          small
                          disabled={!!busy || workflow.mode !== 'text' || !clarified}
                          onClick={() => void command('workflow.text.test', { id: workflow.id })}
                        >
                          <Play size={13} aria-hidden="true" />
                          Test
                        </Button>
                        <Button
                          small
                          disabled={!!busy}
                          onClick={() => {
                            setEditing(workflow);
                            setOpen(true);
                          }}
                        >
                          {workflow.mode === 'legacy' ? 'Rebuild in plain language' : 'Edit'}
                        </Button>
                        <Button
                          small
                          disabled={
                            !!busy ||
                            workflow.mode !== 'text' ||
                            (!workflow.enabled && !clarified) ||
                            (!workflow.enabled && workflow.status !== 'ready')
                          }
                          onClick={() =>
                            void command('workflow.text.toggle', {
                              id: workflow.id,
                              enabled: !workflow.enabled,
                            })
                          }
                        >
                          {workflow.enabled ? 'Pause' : 'Activate'}
                        </Button>
                      </div>
                    )}
                    {latest && (
                      <div className="stack">
                        <div className="row between">
                          <h3>Last test</h3>
                          <Status value={latest.status} />
                        </div>
                        {latest.error && <Notice variant="error">{latest.error}</Notice>}
                        <Evidence
                          label="Test details and verification evidence"
                          value={{
                            time: latest.createdAt,
                            inputs: latest.inputs,
                            result: latest.result,
                            error: latest.error,
                          }}
                        />
                        {isAdmin &&
                          clarified &&
                          latest.status === 'succeeded' &&
                          workflow.status !== 'ready' && (
                            <div className="row wrap">
                              <Button
                                small
                                variant="primary"
                                disabled={!!busy}
                                onClick={() =>
                                  void command('workflow.text.confirm', {
                                    id: workflow.id,
                                    operationId: latest.id,
                                    confirmed: true,
                                  })
                                }
                              >
                                <Check size={13} aria-hidden="true" />
                                The test completed successfully
                              </Button>
                              <Button
                                small
                                variant="danger"
                                disabled={!!busy}
                                onClick={() =>
                                  void command('workflow.text.confirm', {
                                    id: workflow.id,
                                    operationId: latest.id,
                                    confirmed: false,
                                  })
                                }
                              >
                                <X size={13} aria-hidden="true" />
                                The result is incorrect
                              </Button>
                            </div>
                          )}
                      </div>
                    )}
                    {jobs.length > 0 && (
                      <div className="stack">
                        <h3>Zamanlama</h3>
                        {jobs.map((job) => (
                          <div className="list-row" key={job.id}>
                            <Clock3 size={16} aria-hidden="true" />
                            <div className="spacer">
                              <strong>{job.name}</strong>
                              <p>
                                {job.expression} · {job.timezone}
                              </p>
                              <p>
                                Last result: {job.lastResult ?? 'Not run yet'} · Next:{' '}
                                {formatTime(job.nextRunAt, true, job.timezone)}
                              </p>
                            </div>
                            <Status value={job.enabled ? 'active' : 'disabled'} />
                          </div>
                        ))}
                      </div>
                    )}
                    {history.length > 0 && (
                      <Evidence
                        label={`Run history (${history.length})`}
                        value={history.map((operation) => ({
                          id: operation.id,
                          createdAt: operation.createdAt,
                          status: operation.status,
                          result: operation.result,
                          error: operation.error,
                        }))}
                      />
                    )}
                    {workflow.status !== 'ready' && (
                      <p className="hint">
                        This workflow cannot be activated until it passes a test and receives human
                        approval.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </Panel>
        );
      })}
      {!data.workflows.length && (
        <Panel title="Workflows">
          <Empty icon={Workflow} title="Describe your first task in plain language">
            Describe which system to use and what to do. Test it first, then verify the result
            before enabling it.
          </Empty>
        </Panel>
      )}
      <style jsx global>{`
        .workflow-question-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 22px;
          height: 22px;
          padding: 0 5px;
          border-radius: 50%;
          background: var(--surface);
          color: var(--ink);
          border: 1px solid var(--line);
          font-size: 12px;
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}

function WorkflowQuestions({
  workflow,
  command,
  busy,
  isAdmin,
  drafts,
  onDraft,
}: {
  workflow: WorkflowView;
  command: SectionProps['command'];
  busy: string | null;
  isAdmin: boolean;
  drafts: Record<string, string>;
  onDraft: (id: string, value: string) => void;
}) {
  const clarification = workflow.clarification;
  const questions = clarification?.questions ?? [];
  const status = clarification?.status ?? 'not_analyzed';
  async function answer(event: FormEvent<HTMLFormElement>, questionId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await command('workflow.questions.answer', {
      id: workflow.id,
      questionId,
      answer: field(form, 'answer'),
      version: workflow.version,
    });
  }
  return (
    <div className="stack">
      <div className="row between wrap">
        <div>
          <h3>Questions about this task</h3>
          <p className="hint">
            Clarify anything uncertain. If an answer changes, the workflow must be tested again
            edilir.
          </p>
        </div>
        {isAdmin && (
          <Button
            small
            disabled={!!busy || status === 'analyzing'}
            onClick={() => void command('workflow.questions.analyze', { id: workflow.id })}
          >
            <RefreshCw size={14} aria-hidden="true" />{' '}
            {status === 'analyzing' ? 'In progress…' : 'Review task again'}
          </Button>
        )}
      </div>
      {clarification?.error && <Notice variant="orange">{clarification.error}</Notice>}
      {status === 'awaiting_provider' && (
        <Notice>
          Waiting for AI connection. Add a provider on the AI Providers page, then review this task
          again. inceleyin.
        </Notice>
      )}
      {status === 'analyzing' && (
        <Notice>
          Your steps and answers are being reviewed. Testing is unavailable during review.
        </Notice>
      )}
      {questions.map((question) => (
        <section className="panel" key={question.id}>
          <form className="panel-body stack" onSubmit={(event) => void answer(event, question.id)}>
            <div className="row between">
              <h3>{question.prompt}</h3>
              <Status
                value={question.status === 'answered' ? 'resolved' : 'pending'}
                label={question.status === 'answered' ? 'Answered' : 'Awaiting answer'}
              />
            </div>
            <p className="muted">{question.reason}</p>
            <TextArea
              key={question.id}
              name="answer"
              label="Your answer"
              value={drafts[`${workflow.id}:${question.id}`] ?? question.answer ?? ''}
              onChange={(event) => onDraft(`${workflow.id}:${question.id}`, event.target.value)}
              required
              maxLength={4000}
              rows={3}
              disabled={!isAdmin || !!busy}
            />
            {isAdmin && (
              <Button
                type="submit"
                variant="primary"
                disabled={!!busy}
                busy={busy === 'workflow.questions.answer'}
              >
                {question.status === 'answered' ? 'Update answer' : 'Save answer'}
              </Button>
            )}
          </form>
        </section>
      ))}
      {!questions.length && status === 'ready' && (
        <Notice>
          {clarification?.analysisSource === 'controlled_fixture'
            ? 'The steps for this controlled local example are available. This is not a live AI analysis.'
            : 'Review is complete and no clarification is needed. You can test the workflow.'}
        </Notice>
      )}
      {!questions.length && status === 'not_analyzed' && (
        <Notice>
          We’ll review the task and ask brief questions if needed. Testing is unavailable until the
          review is complete.
        </Notice>
      )}
      {!isAdmin && <Notice>Only business admins can answer workflow questions.</Notice>}
    </div>
  );
}
