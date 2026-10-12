import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getContext } from '@afterhours/core';
import { assertSameOrigin, errorResponse, readBody } from '@/lib/http';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readBody(request);
    if (body.tenantId !== null && typeof body.tenantId !== 'string')
      throw Object.assign(new Error('A business is required.'), { status: 400 });
    const context = await getContext(
      request.headers,
      body.tenantId === null ? undefined : (body.tenantId as string),
    );
    (await cookies()).set('activeTenant', context.tenantId, {
      httpOnly: true,
      sameSite: 'strict',
      secure:
        process.env.NODE_ENV === 'production' &&
        (process.env.AFTERHOURS_APP_URL ?? '').startsWith('https:'),
      path: '/',
    });
    return NextResponse.json({ message: 'Business switched.' });
  } catch (error) {
    return errorResponse(error);
  }
}
