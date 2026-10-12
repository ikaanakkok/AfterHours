import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getContext, HttpError } from '@afterhours/core';
import {
  uploadContextMaterial,
  MAX_CONTEXT_FILE_BYTES,
} from '../../../../../../../packages/core/src/context-materials';
import { assertSameOrigin, errorResponse } from '@/lib/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const candidate =
      new URL(request.url).searchParams.get('tenantId') ??
      (await cookies()).get('activeTenant')?.value;
    const ctx = await getContext(request.headers, candidate);
    const type = request.headers.get('content-type');
    if (!type?.startsWith('multipart/form-data'))
      throw new HttpError(400, 'VALIDATION_ERROR', 'Unsupported file format.');
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, 'VALIDATION_ERROR', 'File not found.');
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_CONTEXT_FILE_BYTES + 64_000) {
        await reader.cancel();
        throw new HttpError(413, 'FILE_TOO_LARGE', 'Dosya en fazla 6 MB olabilir.');
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    const form = await new Response(bytes, { headers: { 'Content-Type': type } }).formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a file.');
    const result = await uploadContextMaterial(ctx, {
      name: file.name,
      title: typeof form.get('title') === 'string' ? String(form.get('title')) : undefined,
      type: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
