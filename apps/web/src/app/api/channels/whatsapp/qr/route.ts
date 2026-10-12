import { getContext, runCommand } from '@afterhours/core';
import { errorResponse } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ctx = await getContext(request.headers, url.searchParams.get('tenantId') ?? undefined);
    const result = await runCommand(ctx, 'whatsapp.qr', { id: url.searchParams.get('id') });
    return Response.json(result, {
      headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
