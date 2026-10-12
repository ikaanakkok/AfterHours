import type { JsonObject } from '../types.js';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
    public readonly code = 'provider_error',
    public readonly providerStatus?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** A write may have reached the provider. The worker must reconcile or request review. */
export class ExternalOutcomeUnknown extends ProviderError {
  constructor(
    message = 'Dış sistemdeki işlemin sonucu doğrulanamadı. İnsan incelemesi gerekiyor.',
  ) {
    super(message, 409, 'external_outcome_unknown');
    this.name = 'ExternalOutcomeUnknown';
  }
}

export function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProviderError('Sağlayıcı yanıtı beklenen biçimde değil.');
  return value as JsonObject;
}

export function textField(data: JsonObject, key: string, required = true): string {
  const value = data[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (!required) return '';
  throw new ProviderError(`Bağlantıda ${key} bilgisi eksik.`, 422, 'missing_credentials');
}

export function assertSafeText(value: string, label: string, max = 100_000): void {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new ProviderError(`${label} geçerli değil.`, 422, 'invalid_input');
  }
}

export async function requestJson(
  url: string | URL,
  init: RequestInit = {},
  options: { write?: boolean; allowEmpty?: boolean } = {},
): Promise<JsonObject> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    if (options.write) throw new ExternalOutcomeUnknown();
    throw new ProviderError(
      'Sağlayıcıya ulaşılamadı. Bağlantıyı kontrol edin.',
      503,
      'provider_unavailable',
    );
  }
  if (!response.ok) {
    if (options.write && response.status >= 500) throw new ExternalOutcomeUnknown();
    throw new ProviderError(
      response.status === 401 || response.status === 403
        ? 'Hesap bağlantısı veya izinleri yenilenmeli.'
        : `Sağlayıcı işlemi reddetti (${response.status}).`,
      response.status === 401 || response.status === 403 ? 422 : 502,
      'provider_rejected',
      response.status,
    );
  }
  if (response.status === 204 && options.allowEmpty) return {};
  try {
    const body = await response.text();
    if (options.allowEmpty && body.trim() === '') return {};
    if (body.length > 2_000_000) throw new Error('Response too large');
    return object(JSON.parse(body));
  } catch {
    if (options.write) throw new ExternalOutcomeUnknown();
    throw new ProviderError('Sağlayıcı yanıtı okunamadı.');
  }
}

export type OAuthKind = 'gmail' | 'outlook' | 'google_calendar' | 'microsoft_calendar';

/** The caller persists rotated credentials in the encrypted vault, never in an operation result. */
export async function refreshOAuthCredentials(
  kind: OAuthKind,
  config: JsonObject,
  secrets: JsonObject,
): Promise<JsonObject> {
  const google = kind === 'gmail' || kind === 'google_calendar';
  const tenant = typeof config.directoryTenant === 'string' ? config.directoryTenant : 'common';
  if (!/^[a-zA-Z0-9.-]+$/.test(tenant))
    throw new ProviderError('Microsoft dizin bilgisi geçerli değil.', 422);
  const url = google
    ? 'https://oauth2.googleapis.com/token'
    : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: textField(secrets, 'clientId'),
    refresh_token: textField(secrets, 'refreshToken'),
  });
  if (typeof secrets.clientSecret === 'string') body.set('client_secret', secrets.clientSecret);
  const result = await requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const accessToken = textField(result, 'access_token');
  const expiresIn = typeof result.expires_in === 'number' ? result.expires_in : 3600;
  return {
    ...secrets,
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    ...(typeof result.refresh_token === 'string' ? { refreshToken: result.refresh_token } : {}),
  };
}

export async function authHeaders(
  kind: OAuthKind,
  config: JsonObject,
  secrets: JsonObject,
): Promise<Record<string, string>> {
  const expiresAt =
    typeof secrets.expiresAt === 'string'
      ? Date.parse(secrets.expiresAt)
      : Number.POSITIVE_INFINITY;
  if ((!secrets.accessToken || expiresAt < Date.now() + 60_000) && secrets.refreshToken) {
    // Updating the supplied vault value lets the trusted caller persist a rotated refresh token.
    Object.assign(secrets, await refreshOAuthCredentials(kind, config, secrets));
  }
  return {
    Authorization: `Bearer ${textField(secrets, 'accessToken')}`,
    'Content-Type': 'application/json',
  };
}
