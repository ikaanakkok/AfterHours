import { NextResponse } from 'next/server';
import { HttpError } from '@afterhours/core';

export function assertSameOrigin(request: Request) {
  const expected = new URL(process.env.AFTERHOURS_APP_URL ?? 'http://127.0.0.1:3000').origin;
  const origin = request.headers.get('origin');
  if (!origin || origin !== expected) {
    throw Object.assign(new Error('This request did not come from an allowed workspace.'), {
      status: 403,
      code: 'ORIGIN_DENIED',
    });
  }
}

const messages: Record<string, string> = {
  UNAUTHENTICATED: 'Sign in to access your workspace.',
  UNAUTHORIZED: 'Sign in to access your workspace.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  TENANT_ACCESS_DENIED: 'You do not have access to this business workspace.',
  ORIGIN_DENIED: 'This request did not come from an allowed workspace.',
  NOT_FOUND: 'The requested record could not be found.',
  CONFLICT: 'This record may have changed. Refresh the page and try again.',
  VALIDATION_ERROR: 'Check the information you entered.',
};

export function errorResponse(error: unknown) {
  const candidate =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const rawStatus = candidate.status ?? candidate.statusCode;
  const status =
    typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 500 ? rawStatus : 500;
  const code = typeof candidate.code === 'string' ? candidate.code : 'UNKNOWN';
  const message =
    error instanceof HttpError && status < 500
      ? error.message
      : (messages[code] ??
        (status === 401
          ? messages.UNAUTHENTICATED
          : status === 403
            ? messages.FORBIDDEN
            : status === 400
              ? 'Some information was not accepted. Check the fields and try again.'
              : status === 409
                ? messages.CONFLICT
                : 'The action could not be completed. Check your connection and try again.'));
  return NextResponse.json({ error: message, code }, { status });
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type');
  if (!contentType?.includes('application/json'))
    throw Object.assign(new Error('JSON gerekli'), { status: 400 });
  let body: unknown;
  try {
    const maximum = 2 * 1024 * 1024;
    const declared = request.headers.get('content-length');
    if (declared && Number(declared) > maximum)
      throw Object.assign(new Error('The request is too large.'), { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) throw new Error('The request is empty.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) {
          await reader.cancel();
          throw Object.assign(new Error('The request is too large.'), { status: 413 });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 413)
      throw error;
    throw Object.assign(new Error('Invalid JSON.'), { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw Object.assign(new Error('Invalid request.'), { status: 400 });
  return body as Record<string, unknown>;
}
