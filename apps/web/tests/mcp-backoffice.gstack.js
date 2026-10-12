// Local UI journey against the real command API and a controlled MCP server on 4015.
return await (async () => {
  const wait = async (predicate) => {
    for (let i = 0; i < 150; i++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('MCP UI assertion timed out');
  };
  const button = (root, text) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  const fill = (name, value) => {
    const el = document.querySelector(`input[name="${name}"],textarea[name="${name}"]`);
    const proto =
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const name = 'Controlled MCP UI test';
  button(document, 'Sistem ekle').click();
  await wait(() =>
    [...document.querySelectorAll('select')].some((s) =>
      [...s.options].some((o) => o.value === 'mcp'),
    ),
  );
  const picker = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.value === 'mcp'),
  );
  picker.value = 'mcp';
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => document.querySelector('[name="accessToken"]'));
  fill('name', name);
  fill('url', 'http://127.0.0.1:4015/mcp');
  fill('description', 'Yerel kontrollü MCP doğrulaması');
  document.querySelector('[name="accessToken"]').value = '';
  button(document, 'Güvenle kaydet').click();
  const workspace = async () => await (await fetch('/api/workspace')).json();
  let conn;
  await wait(async () => {
    conn = (await workspace()).connections.find((c) => c.name === name);
    return !!conn;
  });
  if (conn.permissions.length || conn.status !== 'awaiting_test')
    throw new Error('Save granted early readiness or access');
  const card = () =>
    [...document.querySelectorAll('section')].find((s) =>
      s.querySelector('h2,h3')?.textContent.includes(name),
    ) ?? [...document.querySelectorAll('.panel')].find((s) => s.textContent.includes(name));
  await wait(
    () =>
      card() &&
      button(card(), 'Bağlantıyı test et') &&
      !button(card(), 'Bağlantıyı test et').disabled,
  );
  button(card(), 'Bağlantıyı test et').click();
  await wait(() => card()?.textContent.includes('read_stock'));
  conn = (await workspace()).connections.find((c) => c.name === name);
  if (conn.status !== 'ready' || conn.permissions.length || conn.realAccountVerified)
    throw new Error('Discovery granted access or claimed business identity');
  const readLabel = [...card().querySelectorAll('label')].find((l) =>
    l.textContent.includes('read_stock'),
  );
  readLabel.querySelector('input').click();
  button(card(), 'Araç izinlerini onayla').click();
  await wait(async () => {
    conn = (await workspace()).connections.find((c) => c.name === name);
    return conn.permissions.includes('mcp:read_stock');
  });
  if (conn.permissions.includes('mcp:write_stock') || conn.agents.join(',') !== 'admin')
    throw new Error('Unselected access granted');
  await wait(() => button(card(), 'Düzenle') && !button(card(), 'Düzenle').disabled);
  button(card(), 'Düzenle').click();
  await wait(() => document.querySelector('[name="accessToken"]'));
  if (document.querySelector('[name="accessToken"]').value !== '')
    throw new Error('Credential echoed into form');
  if (
    !picker.disabled &&
    ![...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'mcp'),
    ).disabled
  )
    throw new Error('Editing can change system type');
  button(document, 'Güvenle kaydet').click();
  await wait(async () => {
    conn = (await workspace()).connections.find((c) => c.name === name);
    return conn.config.mcpRevision === 2;
  });
  if (conn.status !== 'awaiting_test' || conn.permissions.length)
    throw new Error('Edit preserved stale test or permissions');
  return {
    passed: true,
    environment: 'real local API with controlled MCP fixture',
    connectionId: conn.id,
    scope: [
      'Web/MCP picker',
      'save',
      'discovery without grants',
      'explicit selected grant',
      'edit invalidates test',
    ],
    realBusinessAccountVerified: false,
  };
})();
