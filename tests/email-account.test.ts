import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from '../packages/core/src/integrations/email.js';
afterEach(() => vi.unstubAllGlobals());
describe('email sender account binding', () => {
  for (const kind of ['gmail', 'outlook'] as const)
    it(`refuses ${kind} credentials from a different authenticated account before writing`, async () => {
      const methods: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: unknown, options?: RequestInit) => {
          methods.push(options?.method ?? 'GET');
          return Response.json(
            kind === 'gmail'
              ? { emailAddress: 'changed@example.test' }
              : { mail: 'changed@example.test' },
          );
        }),
      );
      await expect(
        sendEmail(
          kind,
          { accountEmail: 'approved@example.test' },
          { accessToken: 'controlled-token' },
          {
            to: 'customer@example.test',
            subject: 'Controlled account test',
            body: 'Local test',
            reference: 'account-test',
          },
        ),
      ).rejects.toMatchObject({ code: 'email_account_changed' });
      expect(methods).toEqual(['GET']);
    });
});
