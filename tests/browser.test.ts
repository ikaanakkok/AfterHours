import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createFixtureServer } from '../scripts/fixture';
import { attachTeachingRecorder, executeBrowserWorkflow } from '../packages/core/src/browser';
import type { WorkflowDefinition, WorkflowStep } from '../packages/core/src/types';

describe('real browser request workflow', () => {
  let directory: string;
  let origin: string;
  let fixture: ReturnType<typeof createFixtureServer>;
  const definition = (): WorkflowDefinition => ({
    name: 'Talep kaydı',
    purpose: 'Müşteri talebini oluştur',
    connectionId: 'fixture',
    requiresApproval: false,
    inputs: ['customerName', 'customerAddress', 'description'].map((key) => ({
      key,
      label: key,
      required: true,
    })),
    steps: [
      { action: 'goto', url: origin },
      { action: 'fill', selector: '#customerName', value: '{{customerName}}' },
      { action: 'fill', selector: '#customerAddress', value: '{{customerAddress}}' },
      { action: 'fill', selector: '#description', value: '{{description}}' },
      { action: 'fill', selector: '#reference', value: '{{reference}}' },
      { action: 'click', selector: '#create-request' },
    ],
    verification: {
      selector: '#request-record',
      recordIdSelector: '#request-id',
      expected: '{{description}}',
    },
    idempotency: {
      lookupUrl: `${origin}/requests/by-reference/{{reference}}`,
      recordIdSelector: '#request-id',
      absentSelector: '[data-afterhours-lookup="absent"]',
    },
  });
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'afterhours-browser-test-'));
    fixture = createFixtureServer({ dataDir: join(directory, 'records'), testMode: true });
    await new Promise<void>((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
    const address = fixture.server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      fixture.server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  });
  it('creates a durable record, reads it back and recovers duplicate delivery', async () => {
    const args = {
      profileDir: join(directory, 'browser-1'),
      allowedOrigins: [origin],
      definition: definition(),
      inputs: {
        customerName: 'Deniz',
        customerAddress: 'demo@example.test',
        description: 'Klima için servis talebi',
      },
      reference: 'delivery-1',
    };
    const first = await executeBrowserWorkflow(args);
    expect(first.verified).toBe(true);
    expect(first.externalRecordId).toMatch(/^REQ-/);
    expect(first.evidence?.recordId).toBe(first.externalRecordId);
    const duplicate = await executeBrowserWorkflow(args);
    expect(duplicate).toMatchObject({
      verified: true,
      recovered: true,
      externalRecordId: first.externalRecordId,
    });
    expect((await fixture.records()).length).toBe(1);
  }, 30_000);
  it('does not write when record absence cannot be proven', async () => {
    const workflow = definition();
    workflow.idempotency.absentSelector = '#missing-absence-marker';
    const result = await executeBrowserWorkflow({
      profileDir: join(directory, 'browser-2'),
      allowedOrigins: [origin],
      definition: workflow,
      inputs: { customerName: 'Ece', customerAddress: 'ece@example.test', description: 'Talep' },
      reference: 'absence-unknown',
    });
    expect(result).toMatchObject({
      verified: false,
      evidence: { outcome: 'unknown', safeToRetry: false },
    });
    expect((await fixture.records()).some((record) => record.reference === 'absence-unknown')).toBe(
      false,
    );
  }, 30_000);
  it('blocks an unapproved website before the browser writes', async () => {
    const workflow = definition();
    workflow.steps[0] = { action: 'goto', url: 'https://not-approved.example.test' };
    await expect(
      executeBrowserWorkflow({
        profileDir: join(directory, 'browser-3'),
        allowedOrigins: [origin],
        definition: workflow,
        inputs: { customerName: 'Ece', customerAddress: 'ece@example.test', description: 'Talep' },
        reference: 'origin-denied',
      }),
    ).rejects.toThrow('izin verilmemiş');
  });
  it('blocks unapproved redirects before issuing an external request', async () => {
    let requests = 0;
    const outside = createServer((_request, response) => {
      requests += 1;
      response.end('unapproved');
    });
    await new Promise<void>((resolve) => outside.listen(0, '127.0.0.1', resolve));
    try {
      const address = outside.address();
      if (!address || typeof address === 'string') throw new Error('Outside server not available');
      const outsideUrl = `http://127.0.0.1:${address.port}`;
      const workflow = definition();
      const inner = `${origin}/__test/redirect?to=${encodeURIComponent(outsideUrl)}`;
      workflow.steps = [
        { action: 'goto', url: `${origin}/__test/redirect?to=${encodeURIComponent(inner)}` },
      ];
      const result = await executeBrowserWorkflow({
        profileDir: join(directory, 'browser-redirect'),
        allowedOrigins: [origin],
        definition: workflow,
        inputs: { customerName: 'Ece', customerAddress: 'ece@example.test', description: 'Talep' },
        reference: 'redirect-blocked',
      });
      expect(result.verified).toBe(false);
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve) => outside.close(() => resolve()));
    }
  }, 30_000);
  it('rejects missing inputs and selectors derived from customer values', async () => {
    const args = {
      profileDir: join(directory, 'browser-4'),
      allowedOrigins: [origin],
      definition: definition(),
      inputs: { customerAddress: 'ece@example.test', description: 'Talep' },
      reference: 'missing-data',
    };
    await expect(executeBrowserWorkflow(args)).rejects.toThrow('gerekli');
    const workflow = definition();
    workflow.steps[1] = { action: 'fill', selector: '{{customerName}}', value: 'untrusted' };
    await expect(
      executeBrowserWorkflow({
        ...args,
        definition: workflow,
        inputs: { ...args.inputs, customerName: 'Ece' },
      }),
    ).rejects.toThrow('sabit');
  });
  it('returns unknown outcome when a write cannot be verified', async () => {
    const workflow = definition();
    workflow.verification.expected = 'a value that is not in the record';
    const result = await executeBrowserWorkflow({
      profileDir: join(directory, 'browser-5'),
      allowedOrigins: [origin],
      definition: workflow,
      inputs: { customerName: 'Ece', customerAddress: 'ece@example.test', description: 'Talep' },
      reference: 'verification-fails',
    });
    expect(result).toMatchObject({
      verified: false,
      evidence: { outcome: 'unknown', safeToRetry: false },
    });
    expect(
      (await fixture.records()).filter((record) => record.reference === 'verification-fails'),
    ).toHaveLength(1);
  }, 30_000);
  it('recovers a lost connection after the durable create without replaying a write', async () => {
    const workflow = definition();
    workflow.steps.splice(5, 0, {
      action: 'select',
      selector: '#fixture-failure',
      value: 'timeout-after-create',
    });
    workflow.steps.push({ action: 'assert', selector: '#request-record' });
    const result = await executeBrowserWorkflow({
      profileDir: join(directory, 'browser-6'),
      allowedOrigins: [origin],
      definition: workflow,
      inputs: {
        customerName: 'Mert',
        customerAddress: 'mert@example.test',
        description: 'Yanıt kaybı testi',
      },
      reference: 'lost-response',
    });
    expect(result).toMatchObject({ verified: true, recovered: true });
    expect(
      (await fixture.records()).filter((record) => record.reference === 'lost-response'),
    ).toHaveLength(1);
  }, 30_000);
  it('records real browser interactions but omits password fields and forged sensitive events', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const steps: WorkflowStep[] = [];
      const warnings: string[] = [];
      await attachTeachingRecorder(context, {
        allowedOrigins: [origin],
        onStep: (step) => steps.push(step),
        onWarning: (warning) => warnings.push(warning),
      });
      const page = await context.newPage();
      await page.goto(origin);
      await page.evaluate(() => {
        const field = document.createElement('input');
        field.id = 'demoPassword';
        field.type = 'password';
        field.setAttribute('aria-label', 'Test parolası');
        document.body.appendChild(field);
      });
      await page.locator('#demoPassword').fill('do-not-record-test-secret');
      await page.locator('#customerName').fill('Deniz');
      await page.locator('#customerAddress').fill('deniz@example.test');
      await page.evaluate(async () => {
        const bridge = window as unknown as {
          __afterhoursRecord(event: {
            action: string;
            selector: string;
            value: string;
          }): Promise<void>;
          __afterhoursFlush(): Promise<void>;
        };
        await bridge.__afterhoursRecord({
          action: 'fill',
          selector: '#demoPassword',
          value: 'forged-test-secret',
        });
        await bridge.__afterhoursFlush();
      });
      expect(steps).toContainEqual({ action: 'fill', selector: '#customerName', value: 'Deniz' });
      expect(steps).toContainEqual({
        action: 'fill',
        selector: '#customerAddress',
        value: 'deniz@example.test',
      });
      expect(JSON.stringify(steps)).not.toContain('secret');
      expect(JSON.stringify(steps)).not.toContain('demoPassword');
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 30_000);
});
