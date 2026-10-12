// Run with gstack `eval` on the authenticated local /context page.
// Uses a scoped fetch shim; no real document, provider or business mutation is made.
return await (async () => {
  const realFetch = window.fetch.bind(window);
  const workspace = await (await realFetch('/api/workspace')).json();
  const tenantId = workspace.tenant.id;
  const fixture = structuredClone(workspace);
  const now = new Date().toISOString();
  fixture.context = {
    version: 1,
    analyzedVersion: 1,
    status: 'ready',
    error: null,
    attachments: [
      {
        id: 'context-fixture-1',
        title: 'Randevu kuralları PDF',
        kind: 'pdf',
        status: 'ready',
        summary: 'Randevu ve iptal politikası.',
        error: null,
        createdAt: now,
      },
    ],
    questions: [
      {
        id: 'question-1',
        prompt: 'Randevu süresi 30 mu 45 dakika mı?',
        reason: 'İki farklı süre belirtiliyor.',
        sourceIds: ['context-fixture-1'],
        status: 'open',
        createdAt: now,
      },
      {
        id: 'question-2',
        prompt: 'İptal için kaç saat önce haber verilmeli?',
        reason: 'İptal süresi açıklanmamış.',
        sourceIds: ['context-fixture-1'],
        status: 'open',
        createdAt: now,
      },
    ],
  };
  const commands = [];
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('/api/workspace'))
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    if (url === '/api/command') {
      const payload = JSON.parse(init.body);
      if (payload.tenantId !== tenantId) throw new Error('Command lost its tenant binding.');
      commands.push(payload);
      if (payload.action === 'context.answer') {
        const question = fixture.context.questions.find((item) => item.id === payload.payload.id);
        question.status = 'answered';
        question.answer = payload.payload.answer;
      } else if (payload.action === 'context.text.add') {
        fixture.context.attachments.push({
          id: 'context-fixture-2',
          title: payload.payload.title,
          kind: 'text',
          status: 'ready',
          summary: payload.payload.text,
          error: null,
          createdAt: now,
        });
        fixture.context.questions.push({
          id: 'question-3',
          prompt: 'Yeni politikanın geçerlilik tarihi nedir?',
          reason: 'Tarih netleşmeli.',
          sourceIds: ['context-fixture-2'],
          status: 'open',
          createdAt: now,
        });
      }
      return new Response(JSON.stringify({ message: 'Test fixture updated.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected test request: ${url}`);
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (check) => {
    for (let index = 0; index < 100; index++) {
      if (check()) return;
      await sleep(50);
    }
    throw new Error('UI assertion timed out.');
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === text);
  const fill = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    ).set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  try {
    button('Yenile').click();
    await wait(() => document.body.textContent.includes('Randevu kuralları PDF'));
    if (document.querySelector('.context-count').textContent !== '2')
      throw new Error('Initial unanswered badge must be 2.');
    document.getElementById('context-questions-tab').click();
    await wait(() => document.querySelector('#context-questions textarea'));
    if (document.querySelector('#context-questions input[type=file]'))
      throw new Error('Document upload leaked into Questions tab.');
    fill(document.querySelector('#context-questions textarea'), '45 dakika');
    await sleep(100);
    button('Yanıtı kaydet').click();
    await wait(() => document.querySelector('.context-count').textContent === '1');
    document.getElementById('context-documents-tab').click();
    await wait(() => button('Metin'));
    button('Metin').click();
    await wait(() => document.querySelector('textarea[name=text]'));
    fill(document.querySelector('input[name=title]'), 'Yeni politika');
    fill(document.querySelector('textarea[name=text]'), 'Randevu süresi 45 dakika.');
    await sleep(100);
    button('Bilgiyi ekle').click();
    await wait(
      () =>
        fixture.context.attachments.length === 2 &&
        document.querySelector('.context-count').textContent === '2',
    );
    if (commands.map((item) => item.action).join(',') !== 'context.answer,context.text.add')
      throw new Error('Unexpected commands were submitted.');
    return JSON.stringify({
      pass: true,
      assertions: [
        'Documents and Questions separated',
        'Unanswered badge 2→1→2 after answer/new document',
        'Tenant bound answer and document commands',
      ],
      realMutations: false,
    });
  } finally {
    window.fetch = realFetch;
  }
})();
