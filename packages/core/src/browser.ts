import { mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { BrowserExecutionResult, JsonObject, WorkflowDefinition, WorkflowStep } from './types';

const MAX_STEPS = 80;
const STEP_TIMEOUT = 8_000;
const EXECUTION_TIMEOUT = 90_000;
const profilesInUse = new Set<string>();

export class BrowserWorkflowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserWorkflowError';
  }
}

function approvedOrigins(origins: string[]): Set<string> {
  if (!origins.length)
    throw new BrowserWorkflowError(
      'no_origin',
      'Tarayıcı bağlantısında izin verilen adres bulunmuyor.',
    );
  return new Set(
    origins.map((value) => {
      const parsed = new URL(value);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.origin !== value.replace(/\/$/, '')
      ) {
        throw new BrowserWorkflowError(
          'invalid_origin',
          'İzin verilen adresler yalnızca http/https kök adresi içermeli.',
        );
      }
      return parsed.origin;
    }),
  );
}

function checkUrl(value: string, origins: Set<string>): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BrowserWorkflowError('invalid_url', 'İş akışındaki adres geçersiz.');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    !origins.has(parsed.origin)
  ) {
    throw new BrowserWorkflowError(
      'origin_denied',
      'İş akışı bağlantıda izin verilmemiş bir adrese erişmek istiyor.',
    );
  }
  return parsed.href;
}

function displayUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/token|password|secret|authorization|credential|api.?key|code/i.test(key))
      url.searchParams.set(key, '[redacted]');
  }
  if (/(?:^|[&#])(?:access_token|id_token|code|token|secret|password)=/i.test(url.hash))
    url.hash = '[redacted]';
  return url.href;
}

function interpolate(value: string, inputs: JsonObject, url = false): string {
  return value.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_match: string, key: string) => {
    const replacement = inputs[key];
    if (
      typeof replacement !== 'string' &&
      typeof replacement !== 'number' &&
      typeof replacement !== 'boolean'
    ) {
      throw new BrowserWorkflowError('missing_input', `İş akışında ${key} girdisi eksik.`);
    }
    const text = String(replacement);
    return url ? encodeURIComponent(text) : text;
  });
}

function checkSelector(selector: string): void {
  if (!selector || selector.length > 700 || selector.includes('{{')) {
    throw new BrowserWorkflowError(
      'invalid_selector',
      'Ekran öğesi için sabit ve geçerli bir seçici gerekli.',
    );
  }
}

function validateDefinition(
  definition: WorkflowDefinition,
  inputs: JsonObject,
  origins: Set<string>,
): void {
  if (!definition.steps.length || definition.steps.length > MAX_STEPS) {
    throw new BrowserWorkflowError('step_limit', `İş akışı 1–${MAX_STEPS} adım içermeli.`);
  }
  for (const input of definition.inputs) {
    const value = inputs[input.key];
    if (input.required && (value === undefined || value === null || String(value).trim() === '')) {
      throw new BrowserWorkflowError('missing_input', `${input.label} gerekli.`);
    }
  }
  for (const step of definition.steps) {
    if (step.action === 'goto') checkUrl(interpolate(step.url, inputs, true), origins);
    else checkSelector(step.selector);
    if ((step.action === 'fill' || step.action === 'select') && step.value.length > 10_000) {
      throw new BrowserWorkflowError('input_limit', 'İş akışı girdisi izin verilen boyutu aşıyor.');
    }
    if (
      step.action === 'read' &&
      (!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(step.output) ||
        ['constructor', '__proto__', 'prototype'].includes(step.output))
    ) {
      throw new BrowserWorkflowError(
        'invalid_output',
        'Okunan bilgi için geçerli bir çıktı adı gerekli.',
      );
    }
  }
  if (!definition.idempotency.lookupUrl.includes('{{reference}}')) {
    throw new BrowserWorkflowError(
      'missing_reference',
      'Yeniden deneme sorgusu {{reference}} içermeli.',
    );
  }
  checkUrl(interpolate(definition.idempotency.lookupUrl, inputs, true), origins);
  checkSelector(definition.idempotency.recordIdSelector);
  checkSelector(definition.verification.selector);
  checkSelector(definition.verification.recordIdSelector);
  const absence = definition.idempotency as WorkflowDefinition['idempotency'] & {
    absentSelector?: string;
  };
  if (absence.absentSelector) checkSelector(absence.absentSelector);
}

async function lockProfile(profileDir: string): Promise<string> {
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const key = await realpath(resolve(profileDir));
  if (profilesInUse.has(key))
    throw new BrowserWorkflowError(
      'profile_busy',
      'Bu tarayıcıda başka bir işlem veya öğretim açık.',
    );
  profilesInUse.add(key);
  return key;
}

async function guardContext(context: BrowserContext, origins: Set<string>): Promise<void> {
  const redirectCounts = new Map<Page, number>();
  await context.route('**/*', async (route) => {
    try {
      checkUrl(route.request().url(), origins);
      // Intercept redirect responses before Chromium can follow them to an unapproved origin.
      let response = await route.fetch({ maxRedirects: 0, timeout: STEP_TIMEOUT });
      let location = response.headers().location;
      if (
        location &&
        response.status() >= 300 &&
        response.status() < 400 &&
        route.request().isNavigationRequest()
      ) {
        const target = checkUrl(new URL(location, route.request().url()).href, origins);
        const page = route.request().frame().page();
        const count = (redirectCounts.get(page) ?? 0) + 1;
        redirectCounts.set(page, count);
        if (
          count > 8 ||
          ([307, 308].includes(response.status()) &&
            !['GET', 'HEAD'].includes(route.request().method()))
        )
          throw new Error('Unsafe or excessive redirect');
        const escaped = target.replace(
          /[&<>"']/g,
          (char) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
        );
        const headers = { ...response.headers() };
        for (const key of ['location', 'content-length', 'content-encoding']) delete headers[key];
        // A normal HTTP redirect chain bypasses Playwright routing after its first request.
        // Each approved GET redirect becomes a fresh document navigation so every hop is inspected.
        await route.fulfill({
          status: 200,
          headers: {
            ...headers,
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
          body: `<!doctype html><meta http-equiv="refresh" content="0;url=${escaped}"><a href="${escaped}">İzin verilen sayfaya devam et</a>`,
        });
        return;
      }
      for (let hop = 0; location && response.status() >= 300 && response.status() < 400; hop += 1) {
        if (hop >= 8 || !['GET', 'HEAD'].includes(route.request().method()))
          throw new Error('Unsafe or excessive redirect');
        const target = checkUrl(new URL(location, response.url()).href, origins);
        response = await context.request.get(target, { maxRedirects: 0, timeout: STEP_TIMEOUT });
        location = response.headers().location;
      }
      if (route.request().isNavigationRequest())
        redirectCounts.delete(route.request().frame().page());
      await route.fulfill({ response });
    } catch {
      await route.abort('blockedbyclient').catch(() => undefined);
    }
  });
  // A website cannot open a second unrestricted window in the persistent session.
  const watchPage = (page: Page) => {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url() !== 'about:blank') {
        try {
          checkUrl(frame.url(), origins);
        } catch {
          void page.close();
        }
      }
    });
  };
  context.on('page', watchPage);
  for (const page of context.pages()) watchPage(page);
  await context.routeWebSocket('**/*', (socket) => {
    try {
      const url = new URL(socket.url());
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
      checkUrl(url.href, origins);
      socket.connectToServer();
    } catch {
      socket.close({ code: 1008, reason: 'Origin not approved' });
    }
  });
}

function workflowContextOptions(headless: boolean) {
  return {
    headless,
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block' as const,
    acceptDownloads: false,
  };
}

/** The CUA adapter shares profile exclusion and origin/redirect restrictions with taught jobs. */
export async function withApprovedBrowserPage<T>(
  args: { profileDir: string; allowedOrigins: string[]; startUrl: string; headless?: boolean },
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const origins = approvedOrigins(args.allowedOrigins);
  checkUrl(args.startUrl, origins);
  const profile = await lockProfile(args.profileDir);
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(
      profile,
      workflowContextOptions(args.headless ?? true),
    );
    await guardContext(context, origins);
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(STEP_TIMEOUT);
    const response = await page.goto(args.startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: STEP_TIMEOUT,
    });
    checkUrl(page.url(), origins);
    if (!response?.ok())
      throw new BrowserWorkflowError('page_unavailable', 'Sistem sayfası açılamadı.');
    return await fn(page);
  } finally {
    await context?.close().catch(() => undefined);
    profilesInUse.delete(profile);
  }
}

async function lookup(
  page: Page,
  definition: WorkflowDefinition,
  inputs: JsonObject,
  origins: Set<string>,
): Promise<{ id: string | null; absent: boolean }> {
  const url = checkUrl(interpolate(definition.idempotency.lookupUrl, inputs, true), origins);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
  checkUrl(page.url(), origins);
  const record = page.locator(definition.idempotency.recordIdSelector);
  if ((await record.count()) === 1) {
    const id = (await record.innerText()).trim();
    if (id && id.length <= 256) return { id, absent: false };
  }
  const policy = definition.idempotency as WorkflowDefinition['idempotency'] & {
    absentSelector?: string;
  };
  // No record selector is not proof of absence (the page may have changed or be a login page).
  const absent = policy.absentSelector
    ? (await page.locator(policy.absentSelector).count()) === 1
    : false;
  return { id: null, absent };
}

async function verify(
  page: Page,
  definition: WorkflowDefinition,
  inputs: JsonObject,
  id: string,
): Promise<JsonObject> {
  const marker = page.locator(definition.verification.selector);
  await marker.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
  if ((await marker.count()) !== 1)
    throw new BrowserWorkflowError(
      'ambiguous_verification',
      'Başarı kanıtı tek bir kayda işaret etmiyor.',
    );
  const text = (await marker.innerText()).trim();
  const expected = definition.verification.expected
    ? interpolate(definition.verification.expected, inputs)
    : null;
  if (expected && !text.includes(expected))
    throw new BrowserWorkflowError(
      'verification_mismatch',
      'Oluşan kayıt beklenen bilgiyi içermiyor.',
    );
  const record = page.locator(definition.verification.recordIdSelector);
  if ((await record.count()) !== 1 || (await record.innerText()).trim() !== id) {
    throw new BrowserWorkflowError(
      'record_mismatch',
      'Kayıt kimliği yeniden sorgulamayla eşleşmiyor.',
    );
  }
  return {
    url: displayUrl(page.url()),
    recordId: id,
    checkedAt: new Date().toISOString(),
    expectedMatched: expected ? true : null,
  };
}

async function refuseSensitiveField(page: Page, selector: string): Promise<void> {
  const sensitive = await page.locator(selector).evaluate((element) => {
    const input = element as HTMLInputElement;
    return (
      input.type === 'password' ||
      /password|passwd|secret|token|credit.?card|card.?number|cvv|cvc|otp|one.?time|api.?key/i.test(
        `${input.name} ${input.id} ${input.autocomplete}`,
      )
    );
  });
  if (sensitive)
    throw new BrowserWorkflowError(
      'sensitive_input',
      'Şifre, oturum sırrı ve kart alanları otomasyon adımı olamaz. Girişi personel yapmalı.',
    );
}

export async function testBrowserConnection(args: {
  profileDir: string;
  allowedOrigins: string[];
  startUrl: string;
  headless?: boolean;
}): Promise<{ verified: boolean; evidence?: JsonObject; error?: string }> {
  const origins = approvedOrigins(args.allowedOrigins);
  checkUrl(args.startUrl, origins);
  const profile = await lockProfile(args.profileDir);
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(
      profile,
      workflowContextOptions(args.headless ?? true),
    );
    await guardContext(context, origins);
    const page = context.pages()[0] ?? (await context.newPage());
    const response = await page.goto(args.startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: STEP_TIMEOUT,
    });
    checkUrl(page.url(), origins);
    if (!response?.ok())
      return {
        verified: false,
        error: 'Bağlı sayfa erişim testini geçemedi. Adresi ve personel oturumunu kontrol edin.',
      };
    return {
      verified: true,
      evidence: {
        url: displayUrl(page.url()),
        title: (await page.title()).slice(0, 200),
        checkedAt: new Date().toISOString(),
        scope: 'read_only_connection_probe',
      },
    };
  } catch {
    return {
      verified: false,
      error: 'Tarayıcı bağlantısı doğrulanamadı. Adresi ve personel oturumunu kontrol edin.',
    };
  } finally {
    await context?.close().catch(() => undefined);
    profilesInUse.delete(profile);
  }
}

export async function executeBrowserWorkflow(args: {
  profileDir: string;
  allowedOrigins: string[];
  definition: WorkflowDefinition;
  inputs: JsonObject;
  reference: string;
  headless?: boolean;
}): Promise<BrowserExecutionResult> {
  if (!args.reference || args.reference.length > 256)
    throw new BrowserWorkflowError('invalid_reference', 'Kalıcı işlem referansı gerekli.');
  const origins = approvedOrigins(args.allowedOrigins);
  const inputs = { ...args.inputs, reference: args.reference };
  validateDefinition(args.definition, inputs, origins);
  const profile = await lockProfile(args.profileDir);
  let context: BrowserContext | undefined;
  let possibleWrite = false;
  let stepCount = 0;
  let lookupId: string | null = null;
  try {
    context = await chromium.launchPersistentContext(
      profile,
      workflowContextOptions(args.headless ?? true),
    );
    await guardContext(context, origins);
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(STEP_TIMEOUT);
    const existing = await lookup(page, args.definition, inputs, origins);
    if (existing.id) {
      const evidence = await verify(page, args.definition, inputs, existing.id);
      return {
        verified: true,
        externalRecordId: existing.id,
        recovered: true,
        evidence: { ...evidence, reference: args.reference },
      };
    }
    if (!existing.absent)
      return {
        verified: false,
        evidence: {
          reason: 'Kayıt yokluğu doğrulanamadı; personel incelemesi gerekli.',
          outcome: 'unknown',
          safeToRetry: false,
        },
      };
    const started = Date.now();
    const outputs: JsonObject = {};
    for (const step of args.definition.steps) {
      if (Date.now() - started > EXECUTION_TIMEOUT)
        throw new BrowserWorkflowError('workflow_timeout', 'İş akışı zaman sınırını aştı.');
      switch (step.action) {
        case 'goto':
          await page.goto(checkUrl(interpolate(step.url, inputs, true), origins), {
            waitUntil: 'domcontentloaded',
            timeout: STEP_TIMEOUT,
          });
          checkUrl(page.url(), origins);
          break;
        case 'fill':
          await refuseSensitiveField(page, step.selector);
          possibleWrite = true; // Some systems save on typing; do not assume fills are side-effect-free.
          await page.locator(step.selector).fill(interpolate(step.value, inputs));
          break;
        case 'select':
          await refuseSensitiveField(page, step.selector);
          possibleWrite = true;
          await page.locator(step.selector).selectOption(interpolate(step.value, inputs));
          break;
        case 'click':
          possibleWrite = true;
          await page.locator(step.selector).click();
          break;
        case 'read':
          outputs[step.output] = (await page.locator(step.selector).innerText()).slice(0, 2000);
          break;
        case 'assert': {
          await page.locator(step.selector).waitFor({ state: 'visible' });
          if (
            step.contains &&
            !(await page.locator(step.selector).innerText()).includes(
              interpolate(step.contains, inputs),
            )
          ) {
            throw new BrowserWorkflowError('assertion_failed', 'Ekran beklenen bilgiyi içermiyor.');
          }
          break;
        }
        default:
          throw new BrowserWorkflowError(
            'unsupported_step',
            'İş akışında desteklenmeyen bir adım var.',
          );
      }
      stepCount += 1;
    }
    // Read the durable record through a fresh lookup, not merely the submit button's success toast.
    const readBack = await lookup(page, args.definition, inputs, origins);
    lookupId = readBack.id;
    if (!readBack.id)
      throw new BrowserWorkflowError(
        'readback_failed',
        'İşlem sonrasında kalıcı kayıt doğrulanamadı.',
      );
    const evidence = await verify(page, args.definition, inputs, readBack.id);
    return {
      verified: true,
      externalRecordId: readBack.id,
      evidence: { ...evidence, reference: args.reference, completedSteps: stepCount, outputs },
    };
  } catch (error) {
    // A request may have reached the remote server even when navigation timed out.
    if (context && possibleWrite) {
      try {
        const fresh = await context.newPage();
        const recovered = await lookup(fresh, args.definition, inputs, origins);
        if (recovered.id) {
          lookupId = recovered.id;
          const evidence = await verify(fresh, args.definition, inputs, recovered.id);
          return {
            verified: true,
            externalRecordId: recovered.id,
            recovered: true,
            evidence: { ...evidence, reference: args.reference, completedSteps: stepCount },
          };
        }
      } catch {
        /* Preserve the unknown outcome below instead of repeating a write. */
      }
    }
    return {
      verified: false,
      externalRecordId: lookupId ?? undefined,
      evidence: {
        outcome: possibleWrite ? 'unknown' : 'known_failure',
        reason:
          error instanceof BrowserWorkflowError
            ? error.message
            : 'Tarayıcı adımı tamamlanamadı. Oturum veya ekran personel tarafından kontrol edilmeli.',
        code: error instanceof BrowserWorkflowError ? error.code : 'browser_step_failed',
        completedSteps: stepCount,
        safeToRetry: false,
      },
    };
  } finally {
    await context?.close().catch(() => undefined);
    profilesInUse.delete(profile);
  }
}

export interface TeachingSessionView {
  tenantId: string;
  connectionId: string;
  workflowId?: string;
  status: 'recording' | 'needs_attention' | 'stopped';
  steps: WorkflowStep[];
  warnings: string[];
  startedAt: string;
  currentUrl: string;
}

interface TeachingSession extends TeachingSessionView {
  context: BrowserContext;
  profile: string;
  lastInteractionAt: number;
}
const teachingSessions = new Map<string, TeachingSession>();
const sessionKey = (tenantId: string, connectionId: string) => `${tenantId}:${connectionId}`;

function publicSession(session: TeachingSession): TeachingSessionView {
  return {
    tenantId: session.tenantId,
    connectionId: session.connectionId,
    workflowId: session.workflowId,
    status: session.status,
    steps: structuredClone(session.steps),
    warnings: [...session.warnings],
    startedAt: session.startedAt,
    currentUrl: session.currentUrl,
  };
}

export function getTeachingSession(
  tenantId: string,
  connectionId: string,
): TeachingSessionView | null {
  const session = teachingSessions.get(sessionKey(tenantId, connectionId));
  return session ? publicSession(session) : null;
}

/** Attach the same fixed recorder to a tenant session or a browser verification harness. */
export async function attachTeachingRecorder(
  context: BrowserContext,
  options: {
    allowedOrigins: string[];
    onStep(step: WorkflowStep): void;
    onWarning(warning: string): void;
  },
): Promise<void> {
  const origins = approvedOrigins(options.allowedOrigins);
  let eventQueue: Promise<void> = Promise.resolve();
  let eventCount = 0;
  await context.exposeBinding('__afterhoursRecord', (source, event: unknown) => {
    eventCount += 1;
    if (eventCount > 256) {
      if (eventCount === 257)
        options.onWarning(
          'Gösterim çok fazla ekran olayı içeriyor; kaydı durdurup taslağı sadeleştirin.',
        );
      return Promise.resolve();
    }
    const next = eventQueue.then(async () => {
      if (typeof event !== 'object' || event === null) return;
      try {
        checkUrl(source.frame.url(), origins);
      } catch {
        return;
      }
      if (source.frame !== source.page.mainFrame()) {
        options.onWarning('İç çerçevedeki adım desteklenmiyor; taslağı personel gözden geçirmeli.');
        return;
      }
      const data = event as Record<string, unknown>;
      if (data.warning === 'sensitive') {
        options.onWarning(
          'Şifre, oturum sırrı veya kart alanı kayda alınmadı. Girişi personel yapmalı.',
        );
        return;
      }
      if (
        !['fill', 'click', 'select'].includes(String(data.action)) ||
        typeof data.selector !== 'string'
      )
        return;
      try {
        checkSelector(data.selector);
        await refuseSensitiveField(source.page, data.selector);
      } catch {
        options.onWarning(
          'Güvenli veya kararlı biçimde tanımlanamayan bir ekran öğesi kayda alınmadı.',
        );
        return;
      }
      const action = data.action as 'fill' | 'click' | 'select';
      if (action !== 'click' && (typeof data.value !== 'string' || data.value.length > 10_000))
        return;
      options.onStep(
        action === 'click'
          ? { action, selector: data.selector }
          : { action, selector: data.selector, value: String(data.value) },
      );
    });
    eventQueue = next.catch(() => undefined);
    return next;
  });
  await context.addInitScript(teachingRecorderScript);
}

// Only this fixed recorder is injected. Website/model content never becomes executable code.
function teachingRecorderScript() {
  type RecordEvent = { action?: string; selector?: string; value?: string; warning?: string };
  const sending = new Set<Promise<void>>();
  const send = (event: RecordEvent) => {
    const binding = (
      window as unknown as { __afterhoursRecord?: (event: RecordEvent) => Promise<void> }
    ).__afterhoursRecord;
    const promise = binding?.(event).catch(() => undefined);
    if (promise) {
      sending.add(promise);
      void promise.finally(() => sending.delete(promise));
    }
  };
  const sensitive = (element: Element): boolean => {
    const input = element as HTMLInputElement;
    return (
      input.type === 'password' ||
      /password|passwd|secret|token|credit.?card|card.?number|cvv|cvc|otp|one.?time|api.?key/i.test(
        `${input.name} ${input.id} ${input.autocomplete}`,
      )
    );
  };
  const selectorFor = (element: Element): string => {
    const unique = (selector: string) => {
      try {
        return document.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    };
    const id = element.id;
    if (id && id.length < 120 && unique(`#${CSS.escape(id)}`)) return `#${CSS.escape(id)}`;
    for (const attr of ['data-testid', 'name', 'aria-label']) {
      const value = element.getAttribute(attr);
      const candidate = value
        ? `${element.tagName.toLowerCase()}[${attr}=${JSON.stringify(value)}]`
        : '';
      if (candidate && unique(candidate)) return candidate;
    }
    const parts: string[] = [];
    let current: Element | null = element;
    for (let depth = 0; current && depth < 7; depth += 1) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter(
            (child) => child.tagName === current?.tagName,
          )
        : [current];
      const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
      parts.unshift(`${tag}${suffix}`);
      const result = parts.join(' > ');
      if (unique(result)) return result;
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const pending = new Map<Element, ReturnType<typeof setTimeout>>();
  const recordValue = (element: Element) => {
    if (sensitive(element)) {
      send({ warning: 'sensitive' });
      return;
    }
    if (!(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ))
      return;
    if (
      element instanceof HTMLInputElement &&
      ['hidden', 'file', 'checkbox', 'radio'].includes(element.type)
    )
      return;
    send({
      action: element instanceof HTMLSelectElement ? 'select' : 'fill',
      selector: selectorFor(element),
      value: element.value,
    });
  };
  (window as unknown as { __afterhoursFlush: () => Promise<void> }).__afterhoursFlush =
    async () => {
      for (const [element, timer] of pending) {
        clearTimeout(timer);
        recordValue(element);
      }
      pending.clear();
      await Promise.all([...sending]);
    };
  document.addEventListener(
    'input',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const element = event.target;
      const previous = pending.get(element);
      if (previous) clearTimeout(previous);
      pending.set(
        element,
        setTimeout(() => {
          pending.delete(element);
          recordValue(element);
        }, 400),
      );
    },
    true,
  );
  document.addEventListener(
    'change',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const timer = pending.get(event.target);
      if (timer) clearTimeout(timer);
      pending.delete(event.target);
      recordValue(event.target);
    },
    true,
  );
  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const element = event.target.closest('button, a, [role="button"], input[type="submit"]');
      if (!element) return;
      for (const [input, timer] of pending) {
        clearTimeout(timer);
        recordValue(input);
      }
      pending.clear();
      if (sensitive(element)) {
        send({ warning: 'sensitive' });
        return;
      }
      send({ action: 'click', selector: selectorFor(element) });
    },
    true,
  );
}

export async function startTeachingSession(args: {
  tenantId: string;
  connectionId: string;
  workflowId?: string;
  profileDir: string;
  allowedOrigins: string[];
  startUrl: string;
}): Promise<TeachingSessionView> {
  const key = sessionKey(args.tenantId, args.connectionId);
  const prior = teachingSessions.get(key);
  if (prior) {
    if (prior.workflowId !== args.workflowId)
      throw new BrowserWorkflowError(
        'session_workflow_mismatch',
        'Bu bağlantıda başka bir işin öğretimi açık. Önce o öğretimi durdurun.',
      );
    return publicSession(prior);
  }
  const origins = approvedOrigins(args.allowedOrigins);
  checkUrl(args.startUrl, origins);
  if (displayUrl(args.startUrl) !== new URL(args.startUrl).href) {
    throw new BrowserWorkflowError(
      'sensitive_url',
      'Öğretimi şifre veya erişim kodu içermeyen ana sayfadan başlatın.',
    );
  }
  const profile = await lockProfile(args.profileDir);
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, workflowContextOptions(false));
    await guardContext(context, origins);
    const session: TeachingSession = {
      tenantId: args.tenantId,
      connectionId: args.connectionId,
      workflowId: args.workflowId,
      status: 'recording',
      steps: [{ action: 'goto', url: args.startUrl }],
      warnings: [],
      startedAt: new Date().toISOString(),
      currentUrl: args.startUrl,
      context,
      profile,
      lastInteractionAt: 0,
    };
    await attachTeachingRecorder(context, {
      allowedOrigins: args.allowedOrigins,
      onWarning: (warning) => {
        if (!session.warnings.includes(warning)) session.warnings.push(warning);
      },
      onStep: (step) => {
        if (session.status !== 'recording') return;
        if (session.steps.length >= MAX_STEPS) {
          session.status = 'needs_attention';
          session.warnings.push('Adım sınırına ulaşıldı; kaydı durdurup taslağı sadeleştirin.');
          return;
        }
        const last = session.steps.at(-1);
        if (
          step.action !== 'click' &&
          last &&
          'selector' in last &&
          'selector' in step &&
          last.action === step.action &&
          last.selector === step.selector
        )
          session.steps[session.steps.length - 1] = step;
        else session.steps.push(step);
        session.lastInteractionAt = Date.now();
      },
    });
    const observePage = (page: Page) => {
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame() || frame.url() === 'about:blank') return;
        session.currentUrl = displayUrl(frame.url());
        try {
          checkUrl(frame.url(), origins);
          if (session.currentUrl !== new URL(frame.url()).href) {
            if (!session.warnings.includes('Erişim kodu içeren geçici adres kayda alınmadı.'))
              session.warnings.push('Erişim kodu içeren geçici adres kayda alınmadı.');
            return;
          }
          if (
            Date.now() - session.lastInteractionAt > 2500 &&
            session.steps.at(-1)?.action !== 'goto' &&
            session.steps.length < MAX_STEPS
          )
            session.steps.push({ action: 'goto', url: frame.url() });
        } catch {
          session.status = 'needs_attention';
          session.warnings.push('İzin verilen adres dışına çıkıldı; gösterim durduruldu.');
        }
      });
      page.on('close', () => {
        if (session.status === 'recording' && context?.pages().length === 0) {
          session.status = 'needs_attention';
          session.warnings.push(
            'Tarayıcı kapatıldı; kaydı panelden durdurup taslağı gözden geçirin.',
          );
        }
      });
    };
    for (const page of context.pages()) observePage(page);
    context.on('page', observePage);
    teachingSessions.set(key, session);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(args.startUrl, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
    await page.bringToFront();
    return publicSession(session);
  } catch (error) {
    await context?.close().catch(() => undefined);
    profilesInUse.delete(profile);
    teachingSessions.delete(key);
    throw error;
  }
}

export async function stopTeachingSession(
  tenantId: string,
  connectionId: string,
  expectedWorkflowId?: string,
): Promise<{
  steps: WorkflowStep[];
  warnings: string[];
  startedAt: string;
  endedAt: string;
}> {
  const key = sessionKey(tenantId, connectionId);
  const session = teachingSessions.get(key);
  if (!session)
    throw new BrowserWorkflowError('session_missing', 'Bu bağlantıda açık bir öğretim bulunmuyor.');
  if (expectedWorkflowId !== session.workflowId)
    throw new BrowserWorkflowError(
      'session_workflow_mismatch',
      'Açık öğretim başka bir işe ait. Bu işin taslağı değiştirilemez.',
    );
  for (const page of session.context.pages()) {
    await page
      .evaluate(async () => {
        const flush = (window as unknown as { __afterhoursFlush?: () => Promise<void> })
          .__afterhoursFlush;
        await flush?.();
      })
      .catch(() => {
        session.warnings.push('Son ekran adımı okunamadı; taslağı gözden geçirin.');
      });
  }
  session.status = 'stopped';
  const result = {
    steps: structuredClone(session.steps),
    warnings: [...session.warnings],
    startedAt: session.startedAt,
    endedAt: new Date().toISOString(),
  };
  await session.context.close().catch(() => undefined);
  profilesInUse.delete(session.profile);
  teachingSessions.delete(key);
  return result;
}

export async function closeTeachingSessions(): Promise<void> {
  for (const session of teachingSessions.values()) {
    session.status = 'stopped';
    await session.context.close().catch(() => undefined);
    profilesInUse.delete(session.profile);
  }
  teachingSessions.clear();
}
