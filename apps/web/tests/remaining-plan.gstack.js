// gstack eval on authenticated local management/email/agent-operations pages.
// All command responses are explicit UI fixtures. No provider/account mutations occur.
return await (async () => {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  assert(['127.0.0.1', 'localhost'].includes(location.hostname), 'Local QA only');
  const realFetch = window.fetch.bind(window);
  const fixture = await (await realFetch('/api/workspace')).json();
  assert(fixture.tenant, 'Authenticated workspace required');
  const wait = async (check) => {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('UI wait timed out');
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  const now = new Date().toISOString(),
    id = '70000000-0000-4000-8000-000000000001';
  const commands = [];
  if (location.pathname === '/management') {
    fixture.connections = fixture.connections.filter((c) => c.kind !== 'ai_provider');
    fixture.managementPlans = [
      {
        id,
        summary: 'Kontrollü QA: randevu süresi önerisi',
        status: 'pending',
        steps: [
          {
            command: 'config.update',
            payload: { baseVersion: fixture.config.version, patch: { appointmentDuration: 45 } },
            status: 'pending',
          },
        ],
        error: null,
        createdAt: now,
        updatedAt: now,
      },
    ];
  } else if (location.pathname === '/email') {
    fixture.connections = [
      ...fixture.connections.filter((c) => !['gmail', 'outlook'].includes(c.kind)),
      {
        id,
        name: 'Kontrollü QA Gmail',
        kind: 'gmail',
        purpose: 'Yerel UI testi',
        status: 'ready',
        config: { emailSync: { enabled: false, draftEnabled: false } },
        permissions: ['email.read', 'email.draft'],
        agents: ['admin'],
        hasCredentials: false,
        lastTestAt: null,
        lastError: null,
        realAccountVerified: false,
      },
    ];
    fixture.emailSync = [];
    fixture.drafts = [];
  } else if (location.pathname === '/calendar') {
    fixture.connections = [
      {
        id,
        name: 'Kontrollü QA Calendar',
        kind: 'google_calendar',
        purpose: 'Yerel UI testi',
        status: 'ready',
        config: { guidedSetup: true, setupRevision: 1 },
        permissions: ['calendar.query', 'calendar.create'],
        agents: ['admin'],
        hasCredentials: false,
        lastTestAt: null,
        lastError: null,
        realAccountVerified: false,
      },
    ];
    fixture.calendarEvents = [];
  } else if (location.pathname === '/agent-operations') {
    fixture.operations = [
      {
        id,
        capability: 'calendar.cancel',
        status: 'awaiting_approval',
        actor: { type: 'admin', id: fixture.user.id },
        inputs: { eventId: 'qa-control' },
        connectionId: null,
        result: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      },
    ];
    fixture.approvals = [
      {
        id: '70000000-0000-4000-8000-000000000002',
        kind: 'operation',
        title: 'Kontrollü QA iptal onayı',
        summary: 'UI testi, gerçek kayıt iptali yapılmaz.',
        status: 'pending',
        operationId: id,
        payload: { eventId: 'qa-control' },
        createdAt: now,
      },
    ];
    fixture.handoffs = [];
    fixture.audit = [];
  } else throw new Error('Unsupported QA page');
  window.fetch = async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin) return realFetch(input, options);
    if (url.pathname === '/api/workspace') return Response.json(structuredClone(fixture));
    if (url.pathname === '/api/command') {
      const value = JSON.parse(options.body);
      commands.push(value);
      if (value.action === 'proposal.apply') fixture.managementPlans[0].status = 'applied';
      return Response.json({ message: 'Kontrollü arayüz testi yanıtı; dış işlem yok.' });
    }
    if (options.method && options.method !== 'GET') throw new Error('Unexpected mutation blocked');
    return realFetch(input, options);
  };
  try {
    await wait(() => button('Yenile'));
    button('Yenile').click();
    if (location.pathname === '/management') {
      await wait(() => button('Öneriyi uygula'));
      assert(
        document.body.textContent.includes('AI sağlayıcısının kurulup test edilmesini bekliyor'),
        'Provider waiting not visible',
      );
      assert(
        document.body.textContent.includes('İşletme ayarlarını güncelle'),
        'Readable action missing',
      );
      button('Öneriyi uygula').click();
      await wait(() => commands.length === 1);
      assert(
        commands[0].action === 'proposal.apply' && commands[0].payload.id === id,
        'Proposal dispatch changed',
      );
    } else if (location.pathname === '/email') {
      await wait(() => document.body.textContent.includes('Kontrollü QA Gmail'));
      const enabled = document.querySelector('input[name="enabled"]'),
        draft = document.querySelector('input[name="draftEnabled"]');
      assert(!enabled.checked && !draft.checked, 'Email permissions not opt-in');
      enabled.click();
      draft.click();
      button('Eşitleme ayarlarını kaydet').click();
      await wait(() => commands.length === 1);
      const p = commands[0].payload;
      assert(
        commands[0].action === 'connection.update' &&
          p.config.emailSync.enabled &&
          p.config.emailSync.draftEnabled,
        'Sync config missing',
      );
      assert(
        p.agents.includes('customer') &&
          p.permissions.includes('email.draft') &&
          !p.permissions.includes('email.send'),
        'Draft config acquired send grant',
      );
      assert(!commands.some((c) => c.action === 'email.send'), 'Email sent in UI flow');
    } else if (location.pathname === '/calendar') {
      await wait(() => button('Takvim izinlerini kaydet'));
      const update = document.querySelector('input[name="update"]'),
        cancel = document.querySelector('input[name="cancel"]');
      assert(!update.checked && !cancel.checked, 'Mutation permissions not opt-in');
      update.click();
      cancel.click();
      button('Takvim izinlerini kaydet').click();
      await wait(() => commands.length === 1);
      assert(
        commands[0].action === 'connection.update' && commands[0].payload.id === id,
        'Calendar permission command changed',
      );
      assert(
        ['calendar.query', 'calendar.create', 'calendar.update', 'calendar.cancel'].every((p) =>
          commands[0].payload.permissions.includes(p),
        ),
        'Calendar grants omitted',
      );
      assert(
        !commands.some((c) => c.action === 'calendar.cancel' || c.action === 'calendar.update'),
        'Granting permissions changed an event',
      );
      fixture.connections[0].permissions = ['calendar.query', 'calendar.create', 'calendar.update'];
      button('Yenile').click();
      await wait(
        () =>
          document.querySelector('input[name="update"]').checked &&
          !document.querySelector('input[name="cancel"]').checked,
      );
      fixture.user.role = 'staff';
      button('Yenile').click();
      await wait(
        () =>
          button('Takvim izinlerini kaydet').disabled && button('Hesabı yeniden test et').disabled,
      );
      assert(
        document.querySelector('input[name="update"]').disabled,
        'Staff mutation option remains active',
      );
      fixture.user.role = 'admin';
      button('Yenile').click();
      await wait(() => !button('Takvim izinlerini kaydet').disabled);
    } else {
      await wait(() => document.body.textContent.includes('Kontrollü QA iptal onayı'));
      const check = () => {
        const cell = document.querySelector('tbody tr td');
        const time = cell.querySelector('time'),
          more = [...cell.querySelectorAll('button')].find((b) => b.textContent.includes('More'));
        assert(time && more, 'Time and More missing from first cell');
        if (innerWidth < 500) {
          assert(time.getBoundingClientRect().right <= innerWidth, 'Time outside mobile viewport');
          assert(more.getBoundingClientRect().right <= innerWidth, 'More outside mobile viewport');
        }
        more.click();
      };
      check();
      button('Agent activity').click();
      await wait(() => document.getElementById('activity-panel'));
      check();
      assert(commands.length === 0, 'Inspecting operations mutated state');
    }
    return JSON.stringify({
      pass: true,
      path: location.pathname,
      viewport: innerWidth,
      realMutations: false,
      commands: commands.map((c) => c.action),
    });
  } finally {
    // Keep this page's controlled workspace visible for screenshots. Navigation resets the shim.
    window.__afterhoursControlledQA = { path: location.pathname, realMutations: false };
  }
})();
