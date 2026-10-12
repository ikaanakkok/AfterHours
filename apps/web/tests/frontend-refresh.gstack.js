// Run with gstack `eval` in an authenticated local /settings tab.
// Scoped workspace/command fixtures verify UI behavior, never account/device delivery.
return await (async () => {
  if (!['127.0.0.1', 'localhost'].includes(location.hostname) || location.pathname !== '/settings')
    throw new Error('Open the local authenticated settings page first.');
  const realFetch = window.fetch.bind(window);
  const workspace = await (await realFetch('/api/workspace')).json();
  if (!workspace.tenant) throw new Error('Workspace is unavailable.');
  const fixture = structuredClone(workspace);
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const wait = async (check) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('UI assertion timed out.');
  };
  const button = (label) =>
    [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
  const input = () => document.querySelector('input[name="businessName"]');
  let commandCount = 0;
  window.fetch = async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin) return realFetch(input, options);
    if (url.pathname === '/api/workspace') return Response.json(structuredClone(fixture));
    if (url.pathname === '/api/command') {
      const command = JSON.parse(options.body);
      assert(command.tenantId === fixture.tenant.id, 'Command lost tenant scope.');
      commandCount++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return Response.json(
        { error: 'Kontrollü arayüz hatası; taslak korunmalı.' },
        { status: 409 },
      );
    }
    if (options.method && options.method !== 'GET')
      throw new Error('Unexpected mutation was blocked.');
    return realFetch(input, options);
  };
  try {
    const field = input();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(field, 'Korunacak işletme taslağı');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
    fixture.config.version++;
    fixture.config.businessName = 'Güncel kontrollü işletme';
    button('Yenile').click();
    await wait(() => button('Güncel ayarları yükle'));
    assert(input().value === 'Korunacak işletme taslağı', 'Polling discarded the draft.');
    assert(document.activeElement === field, 'Polling lost input focus.');
    button('Güncel ayarları yükle').click();
    await wait(() => input().value === 'Güncel kontrollü işletme');
    const save = document.querySelector('form button[type="submit"]');
    save.click();
    save.click();
    await wait(() => document.querySelector('.command-error'));
    assert(commandCount === 1, 'Duplicate command was submitted.');
    assert(input().value === 'Güncel kontrollü işletme', 'Failed command discarded the form.');
    if (matchMedia('(max-width: 760px)').matches) {
      document.getElementById('workspace-menu-toggle').click();
      await wait(() => document.getElementById('workspace-menu-close') === document.activeElement);
      assert(document.querySelector('.main').inert, 'Background remains keyboard accessible.');
      document
        .getElementById('workspace-menu-close')
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      assert(
        document.activeElement === [...document.querySelectorAll('.sidebar a')].at(-1),
        'Drawer focus did not wrap.',
      );
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(() => !document.querySelector('.main').inert);
      assert(
        document.activeElement.id === 'workspace-menu-toggle',
        'Escape did not restore menu focus.',
      );
    }
    return JSON.stringify({
      pass: true,
      realMutations: false,
      commandCount,
      assertions: [
        'Version refresh preserves draft/focus',
        'Explicit reload uses latest settings',
        'Failed command retains form and shows inline error',
        'Double submit is blocked',
        'Mobile drawer focus, Escape and inert background',
      ],
    });
  } finally {
    window.fetch = realFetch;
  }
})();
