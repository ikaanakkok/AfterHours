'use client';

import { useState, useSyncExternalStore, type FormEvent } from 'react';
import type { ConnectionView } from '@afterhours/core';
import { Button, Checkbox, Input, Notice, Select, TextArea, field, type SectionProps } from '../ui';

const subscribeLocation = () => () => {};
export function McpOAuthResult() {
  const result = useSyncExternalStore(
    subscribeLocation,
    () => new URLSearchParams(window.location.search).get('oauth'),
    () => null,
  );
  if (result === 'connected')
    return (
      <Notice>
        Account connected. Test the MCP connection, then confirm which tools it may use.
      </Notice>
    );
  if (result === 'failed')
    return (
      <Notice variant="error">
        The account connection failed or the sign-in request expired. Select Connect account to try
        again.
      </Notice>
    );
  return null;
}

export function McpSystemSetup({
  editing,
  command,
  busy,
  onSaved,
}: {
  editing: ConnectionView | null;
  command: SectionProps['command'];
  busy: SectionProps['busy'];
  onSaved: () => void;
}) {
  const [authMode, setAuthMode] = useState(
    (editing?.config.authMode ?? 'oauth') === 'oauth' ? 'oauth' : 'bearer',
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accessToken = String(form.get('accessToken') ?? '').trim();
    const result = await command('backoffice.mcp.save', {
      ...(editing ? { id: editing.id } : {}),
      name: field(form, 'name'),
      url: field(form, 'url'),
      description: field(form, 'description'),
      authMode,
      ...(accessToken ? { accessToken } : {}),
      clearToken: form.has('clearToken'),
    });
    if (result) onSaved();
  }
  return (
    <form className="form-stack" onSubmit={save}>
      <Notice>
        Enter your MCP server URL. After saving, test the connection and confirm which tools it may
        use. Saving changes requires a new connection test and tool permissions.
      </Notice>
      <Input
        label="System name"
        name="name"
        defaultValue={editing?.name}
        required
        maxLength={120}
        disabled={!!busy}
        placeholder="e.g. Inventory MCP"
      />
      <Input
        label="MCP server URL"
        name="url"
        type="url"
        defaultValue={String(editing?.config.url ?? '')}
        required
        disabled={!!busy}
        placeholder="https://…/mcp"
        hint="Streamable HTTP · HTTPS or a local HTTP server on this Mac"
      />
      <Select
        label="Authentication"
        value={authMode}
        disabled={!!busy}
        onChange={(event) => setAuthMode(event.target.value)}
      >
        <option value="oauth">OAuth · Sign in with my account</option>
        <option value="bearer">Token · or no authentication</option>
      </Select>
      {authMode === 'oauth' && (
        <Notice>
          For Notion, use https://mcp.notion.com/mcp. Save, then select Connect account on the
          system card. No token is needed.
        </Notice>
      )}
      {authMode === 'bearer' && (
        <Input
          label="Access token · optional"
          name="accessToken"
          type="password"
          autoComplete="new-password"
          disabled={!!busy}
          maxLength={4000}
          hint={
            editing?.hasCredentials
              ? 'Leave blank to keep the current token for the same endpoint. Enter a new token if the endpoint changes.'
              : 'Your bearer token is encrypted in secure storage and is never displayed again.'
          }
        />
      )}
      {authMode === 'bearer' && editing?.hasCredentials && (
        <Checkbox
          label="Remove saved token · connect without authentication"
          name="clearToken"
          disabled={!!busy}
        />
      )}
      <TextArea
        label="Description · What is this system used for?"
        name="description"
        defaultValue={editing?.purpose}
        required
        rows={3}
        maxLength={8000}
        disabled={!!busy}
      />
      <Button
        type="submit"
        variant="primary"
        disabled={!!busy}
        busy={busy === 'backoffice.mcp.save'}
      >
        Save securely
      </Button>
    </form>
  );
}

export function McpToolPermissions({
  system,
  command,
  busy,
}: {
  system: ConnectionView;
  command: SectionProps['command'];
  busy: SectionProps['busy'];
}) {
  const tools = Array.isArray(system.config.discoveredTools)
    ? system.config.discoveredTools.filter((name): name is string => typeof name === 'string')
    : [];
  const [selected, setSelected] = useState<string[]>(
    system.permissions.filter((p) => p.startsWith('mcp:')).map((p) => p.slice(4)),
  );
  const connect =
    system.config.authMode === 'oauth' ? (
      <Button
        disabled={!!busy || system.status === 'disabled'}
        busy={busy === 'backoffice.mcp.oauth.start'}
        onClick={async () => {
          const result = await command('backoffice.mcp.oauth.start', { id: system.id });
          if (typeof result?.data?.url === 'string') window.location.assign(result.data.url);
        }}
      >
        Connect account · OAuth
      </Button>
    ) : null;
  if (system.status !== 'ready')
    return (
      <div className="stack">
        {connect}
        <p className="hint">
          Test the current connection to view its tools. A successful connection test does not
          verify the identity of the business account.
        </p>
      </div>
    );
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        await command('backoffice.mcp.authorize', {
          id: system.id,
          revision: system.config.mcpRevision,
          tools: selected,
        });
      }}
    >
      {connect}
      <p className="hint">
        {tools.length} tools found. Check with your server administrator that the tools you select
        are read-only. Access is granted only to the administrator. Write tools require separate
        result verification.
      </p>
      {tools.map((name) => (
        <Checkbox
          key={name}
          label={`${name} · I confirmed this tool is read-only`}
          checked={selected.includes(name)}
          disabled={!!busy}
          onChange={(event) =>
            setSelected((current) =>
              event.target.checked ? [...current, name] : current.filter((value) => value !== name),
            )
          }
        />
      ))}
      <Button small type="submit" disabled={!!busy} busy={busy === 'backoffice.mcp.authorize'}>
        Confirm tool permissions
      </Button>
    </form>
  );
}
