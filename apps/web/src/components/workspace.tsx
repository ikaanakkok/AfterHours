'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  CircleCheck,
  Info,
  LoaderCircle,
  LogOut,
  Menu,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { CommandResult, WorkspaceView } from '@afterhours/core';
import { sections, sectionInfo, type Section } from '@/lib/sections';
import { Button, Notice, type SectionProps } from './ui';
import { Overview } from './sections/overview';
import { Inbox, Email, Calendar } from './sections/communication';
import { Context } from './sections/context';
import { Workflows } from './sections/workflows';
import { BackofficeSystems, AiProviders } from './sections/systems';
import { AgentOperations } from './sections/agent-operations';
import { Integrations } from './sections/integrations';
import { Management } from './sections/management';
import { Settings } from './sections/settings';
import { Voice } from './sections/channels';

export function Workspace({ section }: { section: Section }) {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandError, setCommandError] = useState('');
  const tenantGeneration = useRef(0);
  const activeTenantId = useRef<string | null>(null);
  const switchingTenant = useRef(false);
  const activeAction = useRef<string | null>(null);
  const refreshSequence = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const notify = useCallback(
    (message: string, isError = false) => setToast({ message, error: isError }),
    [],
  );
  const info = sectionInfo(section);

  const refresh = useCallback(async () => {
    if (switchingTenant.current) return false;
    const generation = tenantGeneration.current;
    const sequence = ++refreshSequence.current;
    const expectedTenant = activeTenantId.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const current = () =>
      generation === tenantGeneration.current && sequence === refreshSequence.current;
    try {
      const response = await fetch(
        expectedTenant
          ? `/api/workspace?tenant=${encodeURIComponent(expectedTenant)}`
          : '/api/workspace',
        { cache: 'no-store', signal: controller.signal },
      );
      if (!current()) return false;
      if (response.status === 401) {
        router.replace('/login');
        return false;
      }
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? 'Could not load the workspace.');
      }
      const workspace = (await response.json()) as WorkspaceView;
      if (!current()) return false;
      if (expectedTenant && workspace.tenant.id !== expectedTenant)
        throw new Error('The business response does not match the expected workspace.');
      activeTenantId.current = workspace.tenant.id;
      setData(workspace);
      setError('');
      return true;
    } catch (cause) {
      if (!current() || controller.signal.aborted) return false;
      setError(cause instanceof Error ? cause.message : 'Could not reach the workspace.');
      return false;
    } finally {
      if (current()) setRefreshing(false);
      if (refreshController.current === controller) refreshController.current = null;
    }
  }, [router]);

  const invalidateRequests = useCallback(() => {
    tenantGeneration.current++;
    refreshSequence.current++;
    refreshController.current?.abort();
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 6000);
    return () => {
      window.clearInterval(timer);
      invalidateRequests();
    };
  }, [invalidateRequests, refresh]);
  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(null), 6500);
      return () => window.clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (!mobileOpen) return;
    const navigation = document.getElementById('workspace-navigation');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.getElementById('workspace-menu-close')?.focus();
    const media = window.matchMedia('(max-width: 760px)');
    const resize = () => {
      if (!media.matches) setMobileOpen(false);
    };
    media.addEventListener('change', resize);
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        requestAnimationFrame(() => document.getElementById('workspace-menu-toggle')?.focus());
      }
      if (event.key === 'Tab') {
        const items = navigation?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)');
        const first = items?.[0];
        const last = items?.[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
      media.removeEventListener('change', resize);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  const command = useCallback(
    async (action: string, payload: unknown): Promise<CommandResult | null> => {
      const targetTenant = data?.tenant.id;
      if (
        !targetTenant ||
        targetTenant !== activeTenantId.current ||
        activeAction.current ||
        switchingTenant.current
      )
        return null;
      const generation = tenantGeneration.current;
      activeAction.current = action;
      setBusy(action);
      setCommandError('');
      try {
        const response = await fetch('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, payload, tenantId: targetTenant }),
        });
        const body = (await response.json()) as CommandResult & {
          error?: string;
        };
        if (generation !== tenantGeneration.current) return null;
        if (!response.ok) {
          if (response.status === 401) router.replace('/login');
          throw new Error(body.error ?? 'The action could not be completed.');
        }
        notify(body.message);
        await refresh();
        return body;
      } catch (cause) {
        if (generation !== tenantGeneration.current) return null;
        const message = cause instanceof Error ? cause.message : 'Could not reach the server.';
        setCommandError(message);
        notify(message, true);
        return null;
      } finally {
        if (generation === tenantGeneration.current) {
          activeAction.current = null;
          setBusy(null);
        }
      }
    },
    [data?.tenant.id, notify, refresh, router],
  );

  async function changeTenant(tenantId: string) {
    if (switchingTenant.current || activeAction.current || tenantId === data?.tenant.id) return;
    const previous = data;
    const generation = ++tenantGeneration.current;
    refreshSequence.current++;
    refreshController.current?.abort();
    switchingTenant.current = true;
    activeAction.current = 'tenant';
    activeTenantId.current = tenantId;
    setData(null);
    setError('');
    setToast(null);
    setCommandError('');
    setBusy('tenant');
    let cookieChanged = false;
    try {
      const response = await fetch('/api/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (!response.ok) throw new Error('Could not switch to this business.');
      cookieChanged = true;
      switchingTenant.current = false;
      if (await refresh()) notify('Business workspace switched.');
    } catch (cause) {
      if (generation !== tenantGeneration.current) return;
      if (!cookieChanged) {
        activeTenantId.current = previous?.tenant.id ?? null;
        setData(previous);
      }
      notify(cause instanceof Error ? cause.message : 'Could not switch businesses.', true);
    } finally {
      if (generation === tenantGeneration.current) {
        switchingTenant.current = false;
        activeAction.current = null;
        setBusy(null);
      }
    }
  }
  async function signOut() {
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (response.ok) router.replace('/login');
    else notify('Could not sign out. Please try again.', true);
  }

  if (!data)
    return (
      <main className="screen-state">
        <div className="panel screen-state-card stack">
          <div className="micro">AFTERHOURS</div>
          {error ? (
            <>
              <Notice variant="error">{error}</Notice>
              <Button
                onClick={() => {
                  setRefreshing(true);
                  void refresh();
                }}
                busy={refreshing}
              >
                Yeniden dene
              </Button>
            </>
          ) : (
            <div className="loading" role="status">
              <LoaderCircle className="spin" size={19} aria-hidden="true" /> Loading workspace…
            </div>
          )}
        </div>
      </main>
    );
  const isAdmin = data.user.role === 'admin';
  const adminPage = 'admin' in info && info.admin;
  const pending =
    data.approvals.filter((item) => item.status === 'pending').length +
    data.handoffs.filter((item) => item.status !== 'resolved').length;
  const props: SectionProps = { data, command, busy, notify, refresh };

  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside
        id="workspace-navigation"
        className={`sidebar ${mobileOpen ? 'open' : ''}`}
        aria-label="Workspace navigation"
      >
        <button
          id="workspace-menu-close"
          className="icon-button mobile-menu sidebar-close"
          aria-label="Close menu"
          onClick={() => {
            setMobileOpen(false);
            requestAnimationFrame(() => document.getElementById('workspace-menu-toggle')?.focus());
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <Link href="/overview" className="brand" onClick={() => setMobileOpen(false)}>
          <span className="brand-mark" aria-hidden="true" />
          AfterHours
        </Link>
        <nav>
          {sections
            .filter((item) => !('admin' in item && item.admin) || isAdmin)
            .map((item, index, filtered) => {
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  {index === 0 || filtered[index - 1]?.group !== item.group ? (
                    <div className="sidebar-caption">{item.group}</div>
                  ) : null}
                  <Link
                    className="nav-link"
                    href={`/${item.id}`}
                    onClick={() => setMobileOpen(false)}
                    aria-current={section === item.id ? 'page' : undefined}
                  >
                    <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
                    {item.label}
                    {item.id === 'agent-operations' && pending > 0 && (
                      <span className="count">{pending}</span>
                    )}
                    {item.id === 'context' &&
                      data.context?.questions.some((question) => question.status === 'open') && (
                        <span className="count" aria-label="Questions awaiting answers">
                          {
                            data.context.questions.filter((question) => question.status === 'open')
                              .length
                          }
                        </span>
                      )}
                  </Link>
                </div>
              );
            })}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-runtime">
            <div className="row" style={{ gap: 7 }}>
              <span className={`dot ${data.runtime.workerOnline ? '' : 'offline'}`} />
              <strong>
                {data.runtime.workerOnline ? 'Running on this Mac' : 'Worker offline'}
              </strong>
            </div>
            <p>
              {data.runtime.mode === 'demo'
                ? 'Controlled test environment'
                : 'Live account environment'}{' '}
              · {data.config.timezone}
            </p>
          </div>
          <div className="sidebar-bottom">AFTERHOURS · BUILT FOR YOUR BUSINESS</div>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="sidebar-dismiss"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => {
            setMobileOpen(false);
            requestAnimationFrame(() => document.getElementById('workspace-menu-toggle')?.focus());
          }}
        />
      )}
      <div className="main" inert={mobileOpen}>
        <header className="topbar">
          <div className="row">
            <button
              id="workspace-menu-toggle"
              className="icon-button mobile-menu"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              aria-controls="workspace-navigation"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
            <div className="breadcrumb">
              <span className="muted">Workspace</span>
              <ChevronRight size={12} aria-hidden="true" />
              <strong>{info.label}</strong>
            </div>
          </div>
          <div className="row">
            <label className="sr-only" htmlFor="tenant-selector">
              Select a business
            </label>
            <select
              id="tenant-selector"
              className="tenant-selector"
              value={data.tenant.id}
              disabled={!!busy}
              onChange={(event) => void changeTenant(event.target.value)}
            >
              {data.memberships.map((membership) => (
                <option key={membership.tenantId} value={membership.tenantId}>
                  {membership.name}
                </option>
              ))}
            </select>
            <div className="avatar" aria-hidden="true">
              {data.user.name
                .split(' ')
                .slice(0, 2)
                .map((part) => part.charAt(0))
                .join('')
                .toUpperCase()}
            </div>
            <div>
              <div className="user-name">{data.user.name}</div>
              <div className="user-role">{isAdmin ? 'Business admin' : 'Staff'}</div>
            </div>
            <button
              className="icon-button"
              onClick={() => void signOut()}
              aria-label="Oturumu kapat"
              title="Oturumu kapat"
            >
              <LogOut size={15} aria-hidden="true" />
            </button>
          </div>
        </header>
        <main id="main-content" className="content" key={data.tenant.id}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {section === 'overview'
                  ? new Intl.DateTimeFormat('tr-TR', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      timeZone: data.config.timezone,
                    }).format(new Date())
                  : data.tenant.name}
              </div>
              <h1>{info.label}</h1>
              <p>{info.description}</p>
            </div>
            <div className="page-actions">
              <span className={`status ${data.runtime.mode === 'demo' ? 'orange' : 'blue'}`}>
                {data.runtime.mode === 'demo' ? 'Test environment' : 'Live environment'}
              </span>
              <Button
                small
                busy={refreshing}
                onClick={() => {
                  setRefreshing(true);
                  void refresh();
                }}
                aria-label="Refresh data"
              >
                <RefreshCw size={13} aria-hidden="true" />
                Refresh
              </Button>
            </div>
          </div>
          {error && (
            <div style={{ marginBottom: 20 }} role="alert">
              <Notice variant="error">{error} Showing the most recently loaded information.</Notice>
            </div>
          )}
          {commandError && (
            <div className="command-error" role="alert">
              <Notice variant="error">{commandError}</Notice>
            </div>
          )}
          {adminPage && !isAdmin ? (
            <Notice variant="orange">
              <ShieldCheck size={16} style={{ verticalAlign: 'middle', marginRight: 7 }} />
              This area is available to business admins only. Staff can use the inbox and permitted
              operations.
            </Notice>
          ) : (
            <>
              {section === 'overview' && <Overview {...props} />}
              {section === 'inbox' && <Inbox {...props} />}
              {section === 'agent-operations' && <AgentOperations {...props} />}
              {section === 'context' && <Context {...props} />}
              {section === 'workflows' && <Workflows {...props} />}
              {section === 'front-desk-channels' && <Integrations {...props} />}
              {section === 'backoffice-systems' && <BackofficeSystems {...props} />}
              {section === 'ai-providers' && <AiProviders {...props} />}
              {section === 'email' && <Email {...props} />}
              {section === 'calendar' && <Calendar {...props} />}
              {section === 'management' && <Management {...props} />}
              {section === 'settings' && <Settings {...props} />}
              {section === 'voice' && <Voice {...props} />}
            </>
          )}
        </main>
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
          aria-live={toast.error ? 'assertive' : 'polite'}
        >
          {toast.error ? (
            <Info size={17} aria-hidden="true" />
          ) : (
            <CircleCheck size={17} color="#4f784e" aria-hidden="true" />
          )}
          <span>{toast.message}</span>
          <button
            className="icon-button"
            style={{ border: 0, width: 23, height: 23 }}
            onClick={() => setToast(null)}
            aria-label="Bildirimi kapat"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
