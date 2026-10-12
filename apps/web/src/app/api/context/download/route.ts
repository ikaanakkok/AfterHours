import { cookies } from 'next/headers';
import { getContext, HttpError } from '@afterhours/core';
import { getContextDownload } from '../../../../../../../packages/core/src/context-materials';
import { errorResponse } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const ctx = await getContext(
      request.headers,
      query.get('tenantId') ?? (await cookies()).get('activeTenant')?.value,
    );
    const id = query.get('id');
    if (!id) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a document.');
    const document = await getContextDownload(ctx, id);
    return new Response(new Uint8Array(document.bytes), {
      headers: {
        'Content-Type': document.mime,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.name.replace(/[\r\n]/g, ''))}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
