import { completeMcpOAuthFromHeaders } from '@afterhours/core/mcp-oauth';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const url = new URL(request.url);
  let result = 'failed';
  try {
    await completeMcpOAuthFromHeaders(request.headers, {
      state: url.searchParams.get('state') ?? '',
      ...(url.searchParams.has('code') ? { code: url.searchParams.get('code') ?? '' } : {}),
      ...(url.searchParams.has('error') ? { error: url.searchParams.get('error') ?? '' } : {}),
    });
    result = 'connected';
  } catch {
    /* Never reflect provider codes, state or errors. */
  }
  const target = new URL(
    '/backoffice-systems',
    process.env.AFTERHOURS_APP_URL || 'http://127.0.0.1:3000',
  );
  target.searchParams.set('oauth', result);
  return new Response(null, {
    status: 303,
    headers: {
      Location: target.href,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
