/*
 * Load with gstack `browse eval` in an authenticated local /overview tab, then
 * refresh and navigate to /inbox. The browser fetch shim supplies two controlled
 * human conversations. All mutating API calls stay in this test tab. This tests
 * UI selection/draft ownership, not provider delivery or API authorization.
 */
(() => {
  if (!['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
    throw new Error('This regression is restricted to a local test server.');
  }
  if (window.__afterhoursInboxRegression)
    throw new Error('Close the previous regression tab first.');
  const originalFetch = window.fetch.bind(window);
  const tenantId = document.querySelector('#tenant-selector')?.value;
  if (!tenantId) throw new Error('Open the authenticated overview panel first.');
  const now = new Date().toISOString();
  const conversation = (id, letter) => ({
    id,
    channel: 'demo',
    customerName: `Test müşteri ${letter}`,
    customerAddress: `test-${letter}@example.test`,
    mode: 'human',
    lastMessage: `${letter} müşterisinin talebi`,
    updatedAt: now,
    messages: [
      {
        id: `${id}-inbound`,
        direction: 'inbound',
        body: `${letter} müşterisinin talebi`,
        status: 'received',
        createdAt: now,
      },
    ],
  });
  const a = conversation('ui-conversation-a', 'A');
  const b = conversation('ui-conversation-b', 'B');
  const workspace = {
    tenant: { id: tenantId, name: 'Gelen kutusu testi' },
    user: { id: 'ui-regression', name: 'Test Yönetici', email: 'test@example.test', role: 'admin' },
    memberships: [{ tenantId, name: 'Gelen kutusu testi', role: 'admin' }],
    config: {
      version: 17,
      businessName: 'Gelen kutusu testi',
      description: 'Kontrollü UI testi',
      timezone: 'Europe/Istanbul',
      language: 'tr',
      tone: 'Kısa',
      automationEnabled: false,
      activeHours: [],
      knowledge: [],
      requireApproval: [],
      paymentsEnabled: false,
      appointmentDuration: 30,
      appointmentBuffer: 5,
      calendarHours: [],
    },
    connections: [],
    workflows: [],
    cronJobs: [],
    conversations: [a, b],
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
  };
  const state = { commands: [], pendingReplies: [] };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (input, options = {}) => {
    const target = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    if (target.origin !== window.location.origin) return originalFetch(input, options);
    if (target.pathname === '/api/workspace') return json(structuredClone(workspace));
    if (target.pathname === '/api/command') {
      const command = JSON.parse(String(options.body));
      if (command.action !== 'conversation.reply' || command.tenantId !== tenantId)
        return json({ error: 'Unsupported test command' }, 403);
      state.commands.push(structuredClone(command));
      return new Promise((resolve) =>
        state.pendingReplies.push(() =>
          resolve(json({ message: 'Yanıt yalnızca test sekmesinde kaydedildi.' })),
        ),
      );
    }
    if (target.pathname === '/api/tenant')
      return json({ error: 'Tenant switch is outside this regression' }, 403);
    return originalFetch(input, options);
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const draft = () => document.querySelector('.composer textarea')?.value;
  const selected = () =>
    document.querySelector('.conversation-button[aria-pressed="true"] strong')?.textContent;
  const waitForSendCompletion = async () => {
    const deadline = Date.now() + 5000;
    while (document.querySelector('.composer button[aria-busy="true"]') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert(
      !document.querySelector('.composer button[aria-busy="true"]'),
      'Send command never completed',
    );
  };
  window.__afterhoursInboxRegression = {
    reorder() {
      workspace.conversations = [b, a];
      return 'B_REORDERED_FIRST';
    },
    pendingCount() {
      return state.pendingReplies.length;
    },
    releaseSend() {
      const pending = state.pendingReplies.splice(0);
      for (const complete of pending) complete();
      return `RELEASED_SENDS=${pending.length}`;
    },
    assertAAfterReorder() {
      assert(
        selected() === 'Test müşteri A',
        'Polling changed the selected conversation from A to B',
      );
      assert(draft() === 'A için taslak', 'A draft was lost or assigned to B after polling');
      return 'PASS: reordering the inbox preserves the selected conversation and its draft.';
    },
    async assertBCompletion() {
      await waitForSendCompletion();
      assert(selected() === 'Test müşteri B', 'Explicit selection of B was lost');
      assert(draft() === 'B için yeni taslak', 'Completion of A send cleared B draft');
      const first = state.commands[0];
      assert(
        first?.payload.id === a.id && first.payload.body === 'A için taslak',
        'A reply was submitted to another customer',
      );
      return 'PASS: A send targets A and its delayed completion preserves B draft.';
    },
    async assertNewADraft() {
      await waitForSendCompletion();
      assert(selected() === 'Test müşteri A', 'A was not selected for the second send');
      assert(draft() === 'A daha yeni taslak', 'Completion cleared newer text typed for A');
      const second = state.commands[1];
      assert(
        second?.payload.id === a.id && second.payload.body === 'A ilk gönderim',
        'Second send did not use its captured A body',
      );
      return 'PASS: completion clears only the unchanged submitted text, preserving newer A text.';
    },
    restore() {
      window.fetch = originalFetch;
      this.releaseSend();
      delete window.__afterhoursInboxRegression;
      return 'HARNESS_REMOVED';
    },
  };
  return 'INBOX_DRAFT_HARNESS_READY: refresh overview, then navigate to the inbox.';
})();
