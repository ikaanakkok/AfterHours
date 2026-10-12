// Controlled UI regression; provider reasoning is tested separately in vitest.
return await (async () => {
  const realFetch = window.fetch.bind(window);
  const fixture = await (await realFetch('/api/workspace')).json();
  const source = fixture.workflows.find((item) => item.mode === 'text');
  if (!source) throw new Error('A local text workflow is required for this journey.');
  const workflow = structuredClone(source);
  fixture.workflows = [workflow];
  workflow.enabled = false;
  workflow.status = 'awaiting_test';
  workflow.clarification = {
    status: 'needs_answers',
    version: workflow.version,
    analyzedVersion: workflow.version,
    error: null,
    analysisSource: 'provider',
    questions: [
      {
        id: 'qa-question-1',
        prompt: 'Hangi kayıtlar kontrol edilecek?',
        reason: 'Filtre belirtilmedi.',
        answer: null,
        status: 'open',
        workflowVersion: workflow.version,
      },
      {
        id: 'qa-question-2',
        prompt: 'Sonuç kime bildirilecek?',
        reason: 'Alıcı belirtilmedi.',
        answer: null,
        status: 'open',
        workflowVersion: workflow.version,
      },
    ],
  };
  const requests = [];
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('/api/workspace')) return Response.json(fixture);
    if (url === '/api/command') {
      const command = JSON.parse(init.body);
      if (command.tenantId !== fixture.tenant.id) throw new Error('Lost tenant binding');
      requests.push(command);
      if (command.action === 'workflow.questions.answer') {
        if (command.payload.version !== workflow.version) throw new Error('Stale answer');
        const question = workflow.clarification.questions.find(
          (q) => q.id === command.payload.questionId,
        );
        question.answer = command.payload.answer;
        question.status = 'answered';
        workflow.version++;
        workflow.clarification.version = workflow.version;
        workflow.clarification.analyzedVersion = workflow.version;
      }
      return Response.json({ message: 'Controlled answer saved.' });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const wait = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('UI assertion timed out');
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  const fill = (element, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
      element,
      value,
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  try {
    button('Yenile').click();
    await wait(() => document.querySelector('.workflow-question-count')?.textContent === '2');
    if (!button('Test').disabled) throw new Error('Unanswered workflow allows test');
    document.getElementById(`workflow-questions-${workflow.id}`).click();
    await wait(() => document.querySelectorAll('textarea[name="answer"]').length === 2);
    let answers = [...document.querySelectorAll('textarea[name="answer"]')];
    if (answers[0].maxLength !== 4000) throw new Error('Answer API limit not reflected');
    fill(answers[0], 'Yalnız yeni kayıtlar.');
    fill(answers[1], 'Kaybolmaması gereken diğer soru taslağı');
    answers[0].closest('form').requestSubmit();
    await wait(() => document.querySelector('.workflow-question-count')?.textContent === '1');
    answers = [...document.querySelectorAll('textarea[name="answer"]')];
    if (answers[1].value !== 'Kaybolmaması gereken diğer soru taslağı')
      throw new Error('Other answer draft lost');
    workflow.clarification.questions.push({
      id: 'qa-question-3',
      prompt: 'Hangi saatlerde?',
      reason: 'Çalışma saati eksik.',
      answer: null,
      status: 'open',
      workflowVersion: workflow.version,
    });
    button('Yenile').click();
    await wait(() => document.querySelector('.workflow-question-count')?.textContent === '2');
    document.getElementById(`workflow-details-${workflow.id}`).click();
    await wait(() => !!button('Test'));
    if (!button('Test').disabled || !button('Aktifleştir').disabled)
      throw new Error('Question gate missing');
    return {
      passed: true,
      environment: 'controlled UI responses',
      assertions: [
        'Questions separate tab',
        'badge 2 -> 1 -> 2',
        'answer revision + tenant',
        'other answer draft retained',
        'test and activation blocked',
      ],
      commands: requests.map((r) => r.action),
    };
  } finally {
    window.fetch = realFetch;
  }
})();
