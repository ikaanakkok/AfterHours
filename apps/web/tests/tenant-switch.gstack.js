/*
 * Page-context network harness for gstack /browse. Load it with `browse eval`
 * after authenticating a local test account and opening /settings.
 *
 * Only this browser tab receives two controlled workspace responses. Tenant,
 * command and workspace API requests are intercepted; no mock mutation reaches
 * the backend. Other requests continue normally. Run `restore()` or close the
 * test tab afterwards. This is a UI race regression, not an authorization test.
 */
(() => {
  if (!['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
    throw new Error('This regression is restricted to a local test server.');
  }
  if (window.__afterhoursTenantRegression) {
    throw new Error('Close the previous regression tab before starting again.');
  }
  const originalFetch = window.fetch.bind(window);
  const tenantA = document.querySelector('#tenant-selector')?.value;
  if (!tenantA) throw new Error('Open the authenticated settings panel first.');
  const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const memberships = [
    { tenantId: tenantA, name: 'Test İşletme A', role: 'admin' },
    { tenantId: tenantB, name: 'Test İşletme B', role: 'admin' },
  ];
  const workspace = (tenantId, letter) => ({
    tenant: { id: tenantId, name: `Test İşletme ${letter}` },
    user: {
      id: 'ui-regression',
      name: 'Test Yönetici',
      email: 'test@example.test',
      role: 'admin',
    },
    memberships,
    config: {
      version: 7,
      businessName: `Test İşletme ${letter}`,
      description: `${letter} açıklaması`,
      timezone: 'Europe/Istanbul',
      language: letter === 'A' ? 'en' : 'tr',
      tone: `${letter} tonu`,
      automationEnabled: letter === 'A',
      activeHours: [
        {
          day: letter === 'A' ? 1 : 2,
          start: letter === 'A' ? '18:00' : '10:00',
          end: letter === 'A' ? '23:00' : '11:00',
        },
      ],
      knowledge: [{ title: `${letter} bilgisi`, content: `${letter} güncel politikası` }],
      requireApproval: letter === 'A' ? ['email.send'] : ['payment.link'],
      paymentsEnabled: false,
      appointmentDuration: letter === 'A' ? 45 : 30,
      appointmentBuffer: letter === 'A' ? 15 : 5,
      calendarHours: [
        {
          day: 1,
          start: letter === 'A' ? '09:00' : '12:00',
          end: letter === 'A' ? '18:00' : '17:00',
        },
      ],
    },
    connections: [],
    workflows: [],
    cronJobs: [],
    conversations: [],
    operations: [],
    approvals: [],
    handoffs: [],
    audit: [],
    drafts: [],
    calendarEvents: [],
    proposals: [],
    adminMessages: [],
    runtime: {
      mode: 'demo',
      workerLastSeen: null,
      workerOnline: false,
      voiceStatus: 'unverified',
      paymentsEnabled: false,
    },
  });
  const fixtures = new Map([
    [tenantA, workspace(tenantA, 'A')],
    [tenantB, workspace(tenantB, 'B')],
  ]);
  const state = { current: tenantA, holdA: false, delayed: [], commands: [] };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  window.fetch = async (input, options = {}) => {
    const target = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    if (target.origin !== window.location.origin) return originalFetch(input, options);
    if (target.pathname === '/api/workspace') {
      const tenantId = target.searchParams.get('tenant') || state.current;
      const value = fixtures.get(tenantId);
      if (!value) return json({ error: 'Unknown test tenant' }, 403);
      const snapshot = structuredClone(value);
      if (tenantId === tenantA && state.holdA) {
        // Intentionally finish even after AbortController cancellation. The UI
        // must also ignore a stale generation rather than relying on abort alone.
        return new Promise((resolve) => state.delayed.push(() => resolve(json(snapshot))));
      }
      return json(snapshot);
    }
    if (target.pathname === '/api/tenant') {
      const body = JSON.parse(String(options.body));
      if (!fixtures.has(body.tenantId)) return json({ error: 'Unknown test tenant' }, 403);
      state.current = body.tenantId;
      return json({ message: 'Test işletmesi seçildi.' });
    }
    if (target.pathname === '/api/command') {
      const body = JSON.parse(String(options.body));
      if (!fixtures.has(body.tenantId))
        return json({ error: 'Explicit tenant scope is required' }, 403);
      state.commands.push(structuredClone(body));
      if (body.action === 'config.update') {
        const current = fixtures.get(body.tenantId);
        if (body.payload.baseVersion !== current.config.version)
          return json({ error: 'Version conflict' }, 409);
        current.config = {
          ...current.config,
          ...body.payload.patch,
          version: current.config.version + 1,
        };
      }
      return json({ message: 'Yalnızca test sekmesindeki veri güncellendi.' });
    }
    return originalFetch(input, options);
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const value = (name) =>
    document.querySelector(`input[name="${name}"], textarea[name="${name}"]`)?.value;
  const checkbox = (text) =>
    Array.from(document.querySelectorAll('label.checkbox'))
      .find((label) => label.textContent.trim() === text)
      ?.querySelector('input')?.checked;
  const hours = (legend) =>
    Array.from(document.querySelectorAll('fieldset')).find(
      (element) => element.querySelector('legend')?.textContent === legend,
    );
  window.__afterhoursTenantRegression = {
    tenantB,
    holdNextA() {
      state.holdA = true;
      return 'DELAY_ARMED';
    },
    delayedCount() {
      return state.delayed.length;
    },
    releaseA() {
      state.holdA = false;
      const pending = state.delayed.splice(0);
      for (const complete of pending) complete();
      return `RELEASED_OLD_RESPONSES=${pending.length}`;
    },
    assertFreshB() {
      assert(
        document.querySelector('#tenant-selector')?.value === tenantB,
        'Tenant selector reverted to A',
      );
      assert(value('businessName') === 'Test İşletme B', 'Unsaved A business name leaked into B');
      assert(value('description') === 'B açıklaması', 'A description leaked into B');
      assert(value('language') === 'tr', 'A language leaked into B');
      assert(value('tone') === 'B tonu', 'A tone leaked into B');
      assert(value('appointmentDuration') === '30', 'A appointment duration leaked into B');
      assert(value('appointmentBuffer') === '5', 'A appointment buffer leaked into B');
      assert(
        !document.querySelector('[name="automationEnabled"]')?.checked,
        'A automation toggle leaked into B',
      );
      assert(document.querySelector('input[value="B bilgisi"]'), 'A knowledge state leaked into B');
      assert(
        checkbox('Ödeme bağlantısı oluşturma') === true &&
          checkbox('Takvim kaydı iptali') === false,
        'A approval state leaked into B',
      );
      const active = hours('AI müşteri iletişim saatleri');
      assert(active?.querySelector('select')?.value === '2', 'A active day leaked into B');
      assert(active?.querySelector('input')?.value === '10:00', 'A active hours leaked into B');
      const calendar = hours('Takvim çalışma saatleri');
      assert(calendar?.querySelector('input')?.value === '12:00', 'A calendar hours leaked into B');
      return 'PASS: B has its own uncontrolled fields and React state at the same config version.';
    },
    assertCommandB() {
      const command = state.commands.at(-1);
      assert(command?.action === 'config.update', 'Settings command was not captured');
      assert(command.tenantId === tenantB, 'Settings command did not bind B explicitly');
      assert(
        command.payload.baseVersion === 7,
        'Settings command used the wrong configuration version',
      );
      assert(
        JSON.stringify(command.payload.patch) ===
          JSON.stringify({ description: 'B için yeni açıklama' }),
        'Settings command included stale A fields',
      );
      return 'PASS: only the intended B change was submitted with an explicit B tenant scope.';
    },
    restore() {
      window.fetch = originalFetch;
      this.releaseA();
      delete window.__afterhoursTenantRegression;
      return 'HARNESS_REMOVED';
    },
  };
  return 'TENANT_RACE_HARNESS_READY: click the panel refresh button to load fixture A.';
})();
