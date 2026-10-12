// Controlled UI responses; no phone pairing or external OAuth consent occurs.
return await (async () => {
  const realFetch = window.fetch.bind(window);
  const fixture = await (await realFetch('/api/workspace')).json();
  const seed = fixture.connections.find((item) => item.kind === 'whatsapp');
  if (!seed) throw new Error('Local WhatsApp fixture missing');
  const connection = {
    ...seed,
    id: '88888888-8888-4888-8888-888888888888',
    name: 'QA QR ekranı',
    status: 'awaiting_test',
    realAccountVerified: false,
    config: { mode: 'live', linkRequested: true, linkAttempt: 1 },
  };
  fixture.connections = [connection];
  fixture.runtime.workerOnline = true;
  const image =
    'data:image/png;base64,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';
  let expiresAt = Date.now() + 1200;
  const requests = [];
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('/api/workspace')) return Response.json(fixture);
    if (url.startsWith('/api/channels/whatsapp/qr')) {
      const target = new URL(url, window.location.origin);
      if (
        target.searchParams.get('tenantId') !== fixture.tenant.id ||
        target.searchParams.get('id') !== connection.id
      )
        throw new Error('QR lost tenant or connection binding');
      return Response.json({
        data: {
          qr: expiresAt > Date.now() ? image : null,
          expiresAt: new Date(expiresAt).toISOString(),
          status: connection.status,
        },
      });
    }
    if (url === '/api/command') {
      const request = JSON.parse(init.body);
      if (request.tenantId !== fixture.tenant.id) throw new Error('Command lost tenant binding');
      requests.push(request);
      if (request.action === 'channel.setup.status')
        return Response.json({ data: { google: false, microsoft: false } });
      return Response.json({ message: 'Controlled channel command.' });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const wait = async (check) => {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('UI assertion timed out');
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === text);
  try {
    button('Yenile').click();
    await wait(() => document.body.textContent.includes(connection.name));
    button('Kuruluma devam et').click();
    await wait(() => !!document.querySelector('img.qr-image'));
    if (document.querySelector('img.qr-image').getAttribute('src') !== image)
      throw new Error('QR PNG re-encoded instead of rendered');
    await wait(() => !document.querySelector('img.qr-image'));
    expiresAt = Date.now() + 30000;
    await wait(() => !!document.querySelector('img.qr-image'));
    const qr = document.querySelector('img.qr-image');
    if (qr.getBoundingClientRect().width > qr.parentElement.getBoundingClientRect().width)
      throw new Error('QR exceeds container');
    connection.status = 'ready';
    button('Yenile').click();
    await wait(() => document.body.textContent.includes('QR eşleştirmesi tamamlandı.'));
    if (document.querySelector('img.qr-image'))
      throw new Error('Connected channel still displays QR');
    button('Kanal ekle').click();
    await wait(() => document.querySelectorAll('.service-choice').length === 9);
    const gmail = [...document.querySelectorAll('.service-choice')].find(
      (item) => item.querySelector('strong').textContent === 'Gmail',
    );
    gmail.click();
    await wait(() => !!document.querySelector('input[name="name"]'));
    if (!document.body.textContent.includes('Hesabınızla bağlan'))
      throw new Error('Service instructions absent');
    if (
      document.querySelector('input[type="password"]') ||
      document.querySelector('[name="config"]') ||
      /JSON|client_secret|Access Token/.test(document.querySelector('main').textContent)
    )
      throw new Error('Technical credential form exposed');
    button('Hizmeti değiştir').click();
    await wait(() => document.querySelectorAll('.service-choice').length === 9);
    [...document.querySelectorAll('.service-choice')]
      .find((item) => item.querySelector('strong').textContent === 'Google Calendar')
      .click();
    await wait(() => document.body.textContent.includes('ana takvimi kullanılacak'));
    if (document.querySelector('input[name="calendarId"]'))
      throw new Error('Raw calendar ID exposed');
    return {
      passed: true,
      environment: 'controlled QR and workspace responses',
      assertions: [
        'service-specific instructions',
        'no JSON/token forms',
        'QR PNG rendered directly',
        'QR expires',
        'connected QR hidden',
        'explicit tenant binding',
        'calendar guided default',
      ],
    };
  } finally {
    window.fetch = realFetch;
  }
})();
