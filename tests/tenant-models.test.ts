import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../packages/core/src/policy.js';
import { planCustomerReply } from '../packages/core/src/integrations/models.js';

const provider = vi.hoisted(() => vi.fn());
vi.mock('../packages/core/src/ai-providers.js', () => ({ generateTenantProviderJson: provider }));
afterEach(() => vi.clearAllMocks());

describe('tenant-selected customer model', () => {
  it('uses the tenant provider for a real channel even in a local demo installation', async () => {
    provider.mockResolvedValue({
      reply: 'Hangi hizmeti istiyorsunuz?',
      inputs: {},
      action: 'collect',
      newRequest: true,
    });
    const result = await planCustomerReply({
      tenantId: 'd60b2213-1c6c-4b35-9263-91d2c67cd69e',
      config: defaultConfig('Test'),
      mode: 'live',
      messages: [{ role: 'customer', body: 'Randevu istiyorum' }],
      availableInputs: [{ key: 'description', label: 'Hizmet', required: true }],
    });
    expect(provider).toHaveBeenCalledWith(
      'd60b2213-1c6c-4b35-9263-91d2c67cd69e',
      'customer_request',
      expect.any(String),
      expect.objectContaining({ messages: expect.any(Array) }),
    );
    expect(result.model).toBe('configured');
    expect(result.action).toBe('collect');
  });
  it('does not replace an unavailable tenant provider with a controlled response', async () => {
    provider.mockRejectedValue(
      Object.assign(new Error('Sağlayıcı bekleniyor'), { code: 'AI_PROVIDER_REQUIRED' }),
    );
    await expect(
      planCustomerReply({
        tenantId: 'tenant',
        config: defaultConfig('Test'),
        mode: 'live',
        messages: [],
        availableInputs: [{ key: 'description', label: 'Talep', required: true }],
      }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_REQUIRED' });
  });
  it('keeps controlled responses explicit and rejects authority fields from a provider', async () => {
    provider.mockResolvedValue({
      reply: 'Tamam',
      inputs: {},
      action: 'reply',
      newRequest: false,
      tenantId: 'victim',
    });
    await expect(
      planCustomerReply({
        tenantId: 'tenant',
        config: defaultConfig('Test'),
        mode: 'live',
        messages: [],
        availableInputs: [{ key: 'description', label: 'Talep', required: true }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_model_output' });
    const demo = await planCustomerReply({
      config: defaultConfig('Test'),
      mode: 'demo',
      messages: [{ role: 'customer', body: 'Servis talebi' }],
      availableInputs: [{ key: 'description', label: 'Talep', required: true }],
    });
    expect(demo.model).toBe('demo');
  });
});
