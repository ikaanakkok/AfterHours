import Stripe from 'stripe';
import type { JsonObject } from '../types.js';
import { ExternalOutcomeUnknown, ProviderError, textField } from './http.js';
import type { VerifiedResult } from './email.js';

export interface PaymentLinkInput {
  connectedAccount: string;
  recordId: string;
  amount: number;
  currency: string;
  reference: string;
}
export interface PaymentWebhook {
  id: string;
  type: string;
  account: string | null;
  livemode: boolean;
  data: JsonObject;
}

function stripeClient(config: JsonObject, secrets: JsonObject): Stripe {
  const apiKey = textField(secrets, 'apiKey');
  const live = config.environment === 'live';
  if (!new RegExp(`^(?:sk|rk)_${live ? 'live' : 'test'}_`).test(apiKey))
    throw new ProviderError(
      'Stripe anahtarı seçilen test/canlı ortamıyla eşleşmiyor.',
      422,
      'payment_environment_mismatch',
    );
  return new Stripe(apiKey, { timeout: 20_000, maxNetworkRetries: 0 });
}

/** amount is an integer in the currency's minor units from an authoritative business record. */
export async function createPaymentLink(
  config: JsonObject,
  secrets: JsonObject,
  input: PaymentLinkInput,
): Promise<VerifiedResult> {
  if (
    !Number.isSafeInteger(input.amount) ||
    input.amount <= 0 ||
    input.amount > 100_000_000 ||
    !/^[a-z]{3}$/.test(input.currency)
  )
    throw new ProviderError('Güvenilir ödeme tutarı veya para birimi geçerli değil.', 422);
  if (
    !/^acct_[A-Za-z0-9]+$/.test(input.connectedAccount) ||
    config.connectedAccount !== input.connectedAccount
  )
    throw new ProviderError(
      'Ödeme hesabı onaylı işletme hesabıyla eşleşmiyor.',
      403,
      'payment_account_mismatch',
    );
  if (
    !input.recordId ||
    !input.reference ||
    input.recordId.length > 200 ||
    input.reference.length > 200
  )
    throw new ProviderError('Ödeme kayıt referansı geçerli değil.', 422);
  const stripe = stripeClient(config, secrets);
  const options = { stripeAccount: input.connectedAccount };
  let writeStarted = false;
  try {
    const account = await stripe.accounts.retrieve(input.connectedAccount);
    if (account.charges_enabled !== true)
      throw new ProviderError('İşletmenin Stripe hesabı ödeme almaya hazır değil.', 422);
    writeStarted = true;
    const product = await stripe.products.create(
      {
        name: `AfterHours kayıt ${input.recordId}`,
        metadata: { afterhoursRecordId: input.recordId, afterhoursReference: input.reference },
      },
      { ...options, idempotencyKey: `ah-product-${input.reference}` },
    );
    const price = await stripe.prices.create(
      {
        product: product.id,
        currency: input.currency,
        unit_amount: input.amount,
        metadata: { afterhoursRecordId: input.recordId, afterhoursReference: input.reference },
      },
      { ...options, idempotencyKey: `ah-price-${input.reference}` },
    );
    const created = await stripe.paymentLinks.create(
      {
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: { afterhoursRecordId: input.recordId, afterhoursReference: input.reference },
        payment_intent_data: {
          metadata: { afterhoursRecordId: input.recordId, afterhoursReference: input.reference },
        },
        allow_promotion_codes: false,
      },
      { ...options, idempotencyKey: `ah-link-${input.reference}` },
    );
    const link = await stripe.paymentLinks.retrieve(created.id, options);
    const items = await stripe.paymentLinks.listLineItems(
      created.id,
      { limit: 2, expand: ['data.price'] },
      options,
    );
    const actualPrice = items.data[0]?.price;
    const verifiedPrice = actualPrice && typeof actualPrice !== 'string' ? actualPrice : null;
    if (
      items.data.length !== 1 ||
      items.has_more ||
      items.data[0]?.quantity !== 1 ||
      !verifiedPrice ||
      verifiedPrice.unit_amount !== input.amount ||
      verifiedPrice.currency !== input.currency ||
      link.metadata.afterhoursRecordId !== input.recordId ||
      link.metadata.afterhoursReference !== input.reference ||
      !link.active ||
      link.livemode !== (config.environment === 'live') ||
      !link.url.startsWith('https://buy.stripe.com/')
    )
      throw new ExternalOutcomeUnknown('Ödeme bağlantısı güvenilir kayıt ve tutarla eşleşmedi.');
    return {
      verified: true,
      externalRecordId: link.id,
      evidence: {
        provider: 'stripe',
        paymentLinkId: link.id,
        url: link.url,
        connectedAccount: input.connectedAccount,
        recordId: input.recordId,
        amount: input.amount,
        currency: input.currency,
        livemode: link.livemode,
        readBackVerified: true,
      },
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (writeStarted)
      throw new ExternalOutcomeUnknown(
        'Stripe ödeme bağlantısının sonucu doğrulanamadı; aynı işlem tekrar gönderilmedi.',
      );
    throw new ProviderError(
      'Stripe hesabı doğrulanamadı. Bağlantıyı kontrol edin.',
      422,
      'stripe_unavailable',
    );
  }
}

/** The application enforces tenant/account binding, environment and unique event.id before applying. */
export function verifyPaymentWebhook(
  raw: string | Buffer,
  signature: string,
  secrets: JsonObject,
): PaymentWebhook {
  if (
    Buffer.byteLength(raw) > 2_000_000 ||
    typeof signature !== 'string' ||
    signature.length > 2000
  )
    throw new ProviderError('Ödeme bildirimi geçerli değil.', 400, 'invalid_webhook');
  let event: Stripe.Event;
  try {
    const stripe = new Stripe('sk_test_webhook_verifier');
    event = stripe.webhooks.constructEvent(
      raw,
      signature,
      textField(secrets, 'webhookSecret'),
      300,
    );
  } catch {
    throw new ProviderError(
      'Ödeme bildiriminin imzası doğrulanamadı.',
      400,
      'invalid_webhook_signature',
    );
  }
  return {
    id: event.id,
    type: event.type,
    account: event.account ?? null,
    livemode: event.livemode,
    data: event.data.object as unknown as JsonObject,
  };
}
