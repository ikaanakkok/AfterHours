'use client';

import { useState, type FormEvent } from 'react';
import { Cpu, Globe, KeyRound, Plus, TestTube2 } from 'lucide-react';
import type { ConnectionView } from '@afterhours/core';
import { McpOAuthResult, McpSystemSetup, McpToolPermissions } from './mcp-system-setup';
import {
  Button,
  Checkbox,
  Empty,
  Input,
  Notice,
  Panel,
  Select,
  Status,
  TextArea,
  field,
  formatTime,
  type SectionProps,
} from '../ui';

export function BackofficeSystems({ data, command, busy }: SectionProps) {
  const [editing, setEditing] = useState<ConnectionView | null>(null);
  const [open, setOpen] = useState(false);
  const [systemKind, setSystemKind] = useState<'browser' | 'mcp'>('browser');
  const systems = data.connections.filter(
    (connection) => connection.kind === 'browser' || connection.kind === 'mcp',
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = field(form, 'username');
    const password = String(form.get('password') ?? '');
    if (
      await command('backoffice.save', {
        ...(editing ? { id: editing.id } : {}),
        name: field(form, 'name'),
        url: field(form, 'url'),
        description: field(form, 'description'),
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
      })
    ) {
      setOpen(false);
      setEditing(null);
    }
  }
  return (
    <div className="stack">
      <McpOAuthResult />
      <div className="row between wrap">
        <Notice>
          Use the system name in your workflow text. Failed sign-ins must be fixed and verified
          before the system will not be enabled.
        </Notice>
        <Button
          variant="primary"
          disabled={!!busy}
          onClick={() => {
            setEditing(null);
            setSystemKind('browser');
            setOpen(!open);
          }}
        >
          <Plus size={14} aria-hidden="true" />
          Add system
        </Button>
      </div>
      {open && (
        <Panel
          title={editing ? `${editing.name} · Edit` : 'Add back-office system'}
          action={
            <Button small disabled={!!busy} onClick={() => setOpen(false)}>
              Close
            </Button>
          }
        >
          <div className="panel-body stack">
            <Select
              label="Connection type"
              value={systemKind}
              disabled={!!editing || !!busy}
              onChange={(event) => setSystemKind(event.target.value === 'mcp' ? 'mcp' : 'browser')}
            >
              <option value="browser">Web · Sign in with browser</option>
              <option value="mcp">MCP · Server connection</option>
            </Select>
            {systemKind === 'mcp' ? (
              <McpSystemSetup
                key={editing?.id ?? 'new-mcp'}
                editing={editing}
                command={command}
                busy={busy}
                onSaved={() => {
                  setOpen(false);
                  setEditing(null);
                }}
              />
            ) : (
              <form className="form-stack" key={editing?.id ?? 'new'} onSubmit={save}>
                <Input
                  label="System name"
                  name="name"
                  defaultValue={editing?.name}
                  required
                  maxLength={200}
                  placeholder="e.g. Hotel ERP"
                />
                <Input
                  label="Sign-in URL"
                  name="url"
                  type="url"
                  defaultValue={String(editing?.config.startUrl ?? editing?.config.url ?? '')}
                  required
                  placeholder="https://…"
                />
                <div className="fields">
                  <Input
                    label="Username / email"
                    name="username"
                    autoComplete="off"
                    hint={
                      editing?.hasCredentials
                        ? 'Saved credentials are never displayed. Leave blank to keep them.'
                        : undefined
                    }
                  />
                  <Input
                    label="Parola"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                  />
                </div>
                <TextArea
                  label="Description · What is this system used for?"
                  name="description"
                  defaultValue={editing?.purpose}
                  required
                  rows={3}
                />
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!!busy}
                  busy={busy === 'backoffice.save'}
                >
                  <KeyRound size={14} aria-hidden="true" />
                  Save securely
                </Button>
              </form>
            )}
          </div>
        </Panel>
      )}
      <div className="integration-grid">
        {systems.map((system) => (
          <Panel
            key={system.id}
            title={system.name}
            action={<Globe size={19} aria-hidden="true" />}
          >
            <div className="panel-body stack">
              <div className="row between">
                <Status
                  value={system.status}
                  label={
                    system.lastError && system.status === 'needs_attention'
                      ? system.kind === 'mcp'
                        ? 'Connection failed · Inactive'
                        : 'Sign-in failed · Inactive'
                      : undefined
                  }
                />
                <span className="status">{system.kind === 'mcp' ? 'MCP' : 'Web'}</span>
              </div>
              <p style={{ fontSize: 12, lineHeight: 1.7 }}>{system.purpose}</p>
              <p className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                {String(system.config.startUrl ?? system.config.url ?? '')}
              </p>
              <p className="hint">
                {system.hasCredentials
                  ? 'Credentials stored securely'
                  : system.config.mode === 'demo'
                    ? 'Local test system · No sign-in required'
                    : system.kind === 'mcp'
                      ? 'Connected without a token'
                      : 'Waiting for credentials / session'}{' '}
                · Last tested: {formatTime(system.lastTestAt, true, data.config.timezone)}
              </p>
              {system.lastError && <Notice variant="error">{system.lastError}</Notice>}
              {system.config.mcpSetup === true && (
                <McpToolPermissions
                  key={`${system.id}:${system.config.mcpRevision}:${system.lastTestAt}:${system.permissions.join(',')}`}
                  system={system}
                  command={command}
                  busy={busy}
                />
              )}
              <div className="row wrap">
                <Button
                  small
                  disabled={!!busy}
                  onClick={() =>
                    void command(
                      system.config.mcpSetup === true
                        ? 'backoffice.mcp.test'
                        : system.config.backoffice === true
                          ? 'backoffice.test'
                          : 'connection.test',
                      { id: system.id },
                    )
                  }
                >
                  <TestTube2 size={13} aria-hidden="true" />
                  {system.config.backoffice === true ? 'Sign-in test' : 'Test connection'}
                </Button>
                {(system.kind === 'browser' || system.config.mcpSetup === true) && (
                  <Button
                    small
                    disabled={!!busy}
                    onClick={() => {
                      setEditing(system);
                      setSystemKind(system.kind === 'mcp' ? 'mcp' : 'browser');
                      setOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                )}
              </div>
            </div>
          </Panel>
        ))}
      </div>
      {!systems.length && (
        <Panel title="Backoffice sistemleri">
          <Empty icon={Globe} title="Add your first system">
            Add your web app or MCP server, give it a name, and verify the connection.
          </Empty>
        </Panel>
      )}
    </div>
  );
}

export function AiProviders({ data, command, busy, notify }: SectionProps) {
  const [editing, setEditing] = useState<ConnectionView | null>(null);
  const [open, setOpen] = useState(false);
  const providers = data.connections.filter((connection) => connection.kind === 'ai_provider');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const apiKey = String(form.get('apiKey') ?? '').trim();
    if (
      await command('provider.save', {
        ...(editing ? { id: editing.id } : {}),
        name: field(form, 'name'),
        provider: field(form, 'provider'),
        model: field(form, 'model'),
        enabled: form.has('enabled'),
        ...(apiKey ? { apiKey } : {}),
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
          API keys are encrypted in secure storage and never shown again. Document reviews use the
          provider you select.
        </Notice>
        <Button
          variant="primary"
          disabled={!!busy}
          onClick={() => {
            setEditing(null);
            setOpen(!open);
          }}
        >
          <Plus size={14} aria-hidden="true" />
          Add provider
        </Button>
      </div>
      {open && (
        <Panel
          title={editing ? `${editing.name} · Edit` : 'AI provider'}
          action={
            <Button small disabled={!!busy} onClick={() => setOpen(false)}>
              Close
            </Button>
          }
        >
          <form className="panel-body form-stack" key={editing?.id ?? 'new'} onSubmit={save}>
            <Input
              label="Connection name"
              name="name"
              defaultValue={editing?.name}
              required
              placeholder="e.g. Document assistant"
            />
            <Select
              label="Provider"
              name="provider"
              defaultValue={String(editing?.config.provider ?? 'opencode_go')}
            >
              <option value="opencode_go">OpenCode Go</option>
              <option value="openai">OpenAI / ChatGPT API</option>
            </Select>
            <Input
              label="Model"
              name="model"
              defaultValue={String(editing?.config.model ?? '')}
              required
              placeholder="Model name available in your account"
            />
            <Input
              label="API key"
              name="apiKey"
              type="password"
              autoComplete="new-password"
              required={!editing?.hasCredentials}
              hint={
                editing?.hasCredentials
                  ? 'Leave blank to keep the existing key.'
                  : 'The key is stored securely and never shown again.'
              }
            />
            <Checkbox
              label="Use this provider for Context and Workflow analysis"
              name="enabled"
              defaultChecked={editing ? editing.config.enabled === true : providers.length === 0}
            />
            <p className="hint">
              Only one provider can be selected at a time. Selecting a new provider deactivates the
              previous one; analysis will not start until the connection test succeeds.
            </p>
            <Button
              type="submit"
              variant="primary"
              disabled={!!busy}
              busy={busy === 'provider.save'}
            >
              Save
            </Button>
          </form>
        </Panel>
      )}
      <div className="integration-grid">
        {providers.map((provider) => (
          <Panel
            key={provider.id}
            title={provider.name}
            action={<Cpu size={19} aria-hidden="true" />}
          >
            <div className="panel-body stack">
              <div className="row between">
                <span className="status">
                  {provider.config.provider === 'opencode_go' ? 'OpenCode Go' : 'OpenAI'}
                </span>
                <Status value={provider.status} />
              </div>
              <Status
                value={
                  provider.config.enabled === true && provider.status === 'ready'
                    ? 'active'
                    : 'disabled'
                }
                label={
                  provider.config.enabled === true
                    ? provider.status === 'ready'
                      ? 'Active provider'
                      : 'Selected · Awaiting successful test'
                    : 'Not selected'
                }
              />
              <p style={{ fontSize: 12 }}>{String(provider.config.model ?? '')}</p>
              <p className="hint">
                {provider.hasCredentials ? 'API key stored securely' : 'API key missing'} · Last
                tested: {formatTime(provider.lastTestAt, true, data.config.timezone)}
              </p>
              {provider.lastError && <Notice variant="error">{provider.lastError}</Notice>}
              <div className="row wrap">
                <Button
                  small
                  disabled={!!busy || provider.config.enabled === true}
                  onClick={() =>
                    void command('provider.save', {
                      id: provider.id,
                      name: provider.name,
                      provider: provider.config.provider,
                      model: provider.config.model,
                      enabled: true,
                    })
                  }
                >
                  Use this provider
                </Button>
                <Button
                  small
                  disabled={!!busy}
                  onClick={async () => {
                    const result = await command('provider.test', { id: provider.id });
                    if (result?.data?.verified === false || result?.data?.success === false)
                      notify('Connection could not be verified. Check the error details.', true);
                  }}
                >
                  <TestTube2 size={13} aria-hidden="true" />
                  Test connection
                </Button>
                <Button
                  small
                  disabled={!!busy}
                  onClick={() => {
                    setEditing(provider);
                    setOpen(true);
                  }}
                >
                  Edit
                </Button>
              </div>
            </div>
          </Panel>
        ))}
      </div>
      {!providers.length && (
        <Panel title="AI Providers">
          <Empty icon={Cpu} title="No providers added yet">
            Add your OpenCode Go or OpenAI account. The provider is not ready until a live
            connection test succeeds.
          </Empty>
        </Panel>
      )}
    </div>
  );
}
