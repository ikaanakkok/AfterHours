import { completeChannelOAuthFromHeaders } from '@afterhours/core/channel-setup';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const url = new URL(request.url);
  let result = 'failed';
  try {
    await completeChannelOAuthFromHeaders(request.headers, {
      state: url.searchParams.get('state') ?? '',
      ...(url.searchParams.has('code') ? { code: url.searchParams.get('code') ?? '' } : {}),
      ...(url.searchParams.has('error') ? { error: url.searchParams.get('error') ?? '' } : {}),
    });
    result = 'connected';
  } catch {
    /* Provider details, codes and state are never reflected in the response. */
  }
  const target = new URL(
    '/front-desk-channels',
    process.env.AFTERHOURS_APP_URL || 'http://127.0.0.1:3000',
  );
  target.searchParams.set('setup', result);
  return new Response(null, {
    status: 303,
    headers: {
      Location: target.href,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
