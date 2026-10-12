'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  FileText,
  ImageIcon,
  Link2,
  MessageCircleQuestion,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Empty,
  Input,
  Notice,
  Panel,
  Status,
  TextArea,
  formatTime,
  type SectionProps,
} from '../ui';

export function Context({ data, command, busy, notify, refresh }: SectionProps) {
  const [tab, setTab] = useState<'documents' | 'questions'>('documents');
  const [adding, setAdding] = useState<'file' | 'text' | 'link'>('file');
  const [uploading, setUploading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const uploadActive = useRef(false);
  const mounted = useRef(true);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      uploadController.current?.abort();
    };
  }, []);
  const context = data.context;
  const pending = context.questions.filter((question) => question.status === 'open').length;
  const admin = data.user.role === 'admin';
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const title = String(form.get('title') ?? '').trim();
    if (adding === 'file') {
      if (uploadActive.current) return;
      uploadActive.current = true;
      setUploading(true);
      form.set('tenantId', data.tenant.id);
      const controller = new AbortController();
      uploadController.current = controller;
      try {
        const response = await fetch(
          `/api/context/upload?tenantId=${encodeURIComponent(data.tenant.id)}`,
          {
            method: 'POST',
            body: form,
            signal: controller.signal,
          },
        );
        const result = (await response.json()) as { message?: string; error?: string };
        if (!mounted.current) return;
        if (!response.ok) throw new Error(result.error ?? 'Could not upload file.');
        element.reset();
        notify(result.message ?? 'Document added. Its review status will appear in the list.');
        await refresh?.();
      } catch (error) {
        if (!mounted.current) return;
        notify(error instanceof Error ? error.message : 'Upload failed.', true);
      } finally {
        uploadActive.current = false;
        if (mounted.current) setUploading(false);
      }
    } else {
      const result = await command(
        adding === 'text' ? 'context.text.add' : 'context.link.add',
        adding === 'text'
          ? { title, text: String(form.get('text') ?? '') }
          : { title, url: String(form.get('url') ?? '').trim() },
      );
      if (result) element.reset();
    }
  }
  return (
    <div className="stack">
      <div className="row between wrap">
        <div className="row" role="tablist" aria-label="Context tabs">
          <Button
            id="context-documents-tab"
            role="tab"
            aria-selected={tab === 'documents'}
            tabIndex={tab === 'documents' ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                setTab('questions');
                document.getElementById('context-questions-tab')?.focus();
              }
            }}
            aria-controls="context-documents"
            variant={tab === 'documents' ? 'primary' : ''}
            onClick={() => setTab('documents')}
          >
            <Paperclip size={14} aria-hidden="true" />
            Documents
          </Button>
          <Button
            id="context-questions-tab"
            role="tab"
            aria-selected={tab === 'questions'}
            tabIndex={tab === 'questions' ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                setTab('documents');
                document.getElementById('context-documents-tab')?.focus();
              }
            }}
            aria-controls="context-questions"
            variant={tab === 'questions' ? 'primary' : ''}
            onClick={() => setTab('questions')}
          >
            <MessageCircleQuestion size={14} aria-hidden="true" />
            Questions{' '}
            <span className="context-count" aria-label={`${pending} question awaiting an answer`}>
              {pending}
            </span>
          </Button>
        </div>
        {admin && (
          <Button
            disabled={!!busy || uploading || !context.attachments.length}
            busy={busy === 'context.analyze'}
            onClick={() => void command('context.analyze', {})}
          >
            <RefreshCw size={13} aria-hidden="true" />
            Bilgileri yeniden incele
          </Button>
        )}
      </div>
      {context.error && <Notice variant="orange">{context.error}</Notice>}
      {context.status === 'awaiting_provider' && (
        <Notice>
          Information saved. Add and test a provider on the AI Providers page to review it.
        </Notice>
      )}
      {context.status === 'analyzing' && (
        <Notice>
          Documents are being reviewed. Open questions will update when the review is complete.
        </Notice>
      )}
      {tab === 'documents' ? (
        <div
          id="context-documents"
          role="tabpanel"
          aria-labelledby="context-documents-tab"
          className="grid-two"
        >
          <Panel
            title="Information you added"
            description={`${context.attachments.length} documents · Review status`}
          >
            {context.attachments.length ? (
              context.attachments.map((attachment) => (
                <div
                  className="panel-body stack"
                  key={attachment.id}
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <div className="row">
                    <div className="list-icon">
                      {attachment.kind === 'image' ? (
                        <ImageIcon size={17} aria-hidden="true" />
                      ) : attachment.kind === 'link' ? (
                        <Link2 size={17} aria-hidden="true" />
                      ) : (
                        <FileText size={17} aria-hidden="true" />
                      )}
                    </div>
                    <div className="spacer">
                      <h3>{attachment.title}</h3>
                      <p className="muted" style={{ fontSize: 12 }}>
                        {attachment.kind.toUpperCase()} ·{' '}
                        {formatTime(attachment.createdAt, true, data.config.timezone)}
                      </p>
                    </div>
                    <Status value={attachment.status} />
                  </div>
                  {attachment.summary && (
                    <p style={{ fontSize: 12, lineHeight: 1.7 }}>{attachment.summary}</p>
                  )}
                  {attachment.error && <Notice variant="orange">{attachment.error}</Notice>}
                  {attachment.url && (
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="button small"
                    >
                      Open link <Link2 size={12} aria-hidden="true" />
                    </a>
                  )}
                  {admin && (
                    <Button
                      small
                      variant="ghost"
                      disabled={!!busy || uploading}
                      onClick={() => void command('context.remove', { id: attachment.id })}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      Remove
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <Empty icon={Paperclip} title="Add your first information">
                Add business information, a price list, or process documents. Items that need
                clarification appear under Questions.
              </Empty>
            )}
          </Panel>
          {admin ? (
            <Panel
              title="Add new information"
              description="Text, image, PDF, PowerPoint, Word, or link"
            >
              <div className="panel-body stack">
                <div className="row wrap">
                  <Button
                    small
                    variant={adding === 'file' ? 'primary' : ''}
                    onClick={() => setAdding('file')}
                    disabled={uploading}
                  >
                    Dosya
                  </Button>
                  <Button
                    small
                    variant={adding === 'text' ? 'primary' : ''}
                    onClick={() => setAdding('text')}
                    disabled={uploading}
                  >
                    Metin
                  </Button>
                  <Button
                    small
                    variant={adding === 'link' ? 'primary' : ''}
                    onClick={() => setAdding('link')}
                    disabled={uploading}
                  >
                    Link
                  </Button>
                </div>
                <form className="form-stack" key={adding} onSubmit={add}>
                  <Input
                    label="Title"
                    name="title"
                    required
                    maxLength={200}
                    placeholder="e.g. Appointment and cancellation policies"
                  />
                  {adding === 'file' && (
                    <Input
                      label="Choose a document"
                      name="file"
                      type="file"
                      accept=".txt,.md,.pdf,.pptx,.docx,.png,.jpg,.jpeg,.webp"
                      required
                      hint="PDF, PPTX, DOCX, text, and images. File-reading errors appear in the list."
                    />
                  )}
                  {adding === 'text' && (
                    <TextArea
                      label="Business information"
                      name="text"
                      required
                      rows={8}
                      maxLength={100000}
                    />
                  )}
                  {adding === 'link' && (
                    <Input label="Link" name="url" type="url" required placeholder="https://…" />
                  )}
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!!busy || uploading}
                    busy={uploading || busy === 'context.text.add' || busy === 'context.link.add'}
                  >
                    <Plus size={14} aria-hidden="true" />
                    Add information
                  </Button>
                </form>
                <p className="hint">
                  Added information does not grant permissions. Add an API connection on the AI
                  Providers page. Questions that need clarification update when documents change.
                </p>
              </div>
            </Panel>
          ) : (
            <Notice>Only business admins can add or edit documents.</Notice>
          )}
        </div>
      ) : (
        <div id="context-questions" role="tabpanel" aria-labelledby="context-questions-tab">
          <Panel
            title="Questions that need clarification"
            description="Conflicts and missing information are updated based on uploaded documents"
          >
            {context.questions.length ? (
              context.questions.map((question) => (
                <div
                  className="panel-body stack"
                  key={question.id}
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <div className="row between">
                    <h3>{question.prompt}</h3>
                    <Status value={question.status} />
                  </div>
                  <p className="muted" style={{ fontSize: 12 }}>
                    {question.reason}
                  </p>
                  <p className="hint">
                    Related information:{' '}
                    {question.sourceIds
                      .map(
                        (id) =>
                          context.attachments.find((attachment) => attachment.id === id)?.title ??
                          'Removed document',
                      )
                      .join(', ')}
                  </p>
                  {question.answer && <Notice>{question.answer}</Notice>}
                  {admin && question.status === 'open' && (
                    <form
                      className="form-stack"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (
                          await command('context.answer', {
                            id: question.id,
                            answer: answers[question.id] ?? '',
                          })
                        )
                          setAnswers((previous) => ({ ...previous, [question.id]: '' }));
                      }}
                    >
                      <TextArea
                        label="Your answer"
                        value={answers[question.id] ?? ''}
                        onChange={(event) =>
                          setAnswers((previous) => ({
                            ...previous,
                            [question.id]: event.target.value,
                          }))
                        }
                        rows={3}
                        required
                        maxLength={10000}
                      />
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={!!busy || !answers[question.id]?.trim()}
                      >
                        Save answer
                      </Button>
                    </form>
                  )}
                </div>
              ))
            ) : (
              <Empty icon={MessageCircleQuestion} title="No open questions">
                Track document reviews under Documents. Any new conflict or ambiguity will appear
                here.
              </Empty>
            )}
          </Panel>
        </div>
      )}
      <style jsx>{`
        .context-count {
          display: inline-flex;
          width: 21px;
          height: 21px;
          border-radius: 50%;
          align-items: center;
          justify-content: center;
          background: var(--surface);
          color: var(--ink);
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}
