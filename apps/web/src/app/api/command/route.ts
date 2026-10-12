import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getContext, runCommand } from '@afterhours/core';
import { assertSameOrigin, errorResponse, readBody } from '@/lib/http';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readBody(request);
    if (typeof body.action !== 'string' || body.action.length > 80)
      throw Object.assign(new Error('Invalid command'), { status: 400 });
    if (body.tenantId !== undefined && typeof body.tenantId !== 'string')
      throw Object.assign(new Error('Invalid business'), { status: 400 });
    const candidate =
      typeof body.tenantId === 'string'
        ? body.tenantId
        : (await cookies()).get('activeTenant')?.value;
    const context = await getContext(request.headers, candidate);
    const result = await runCommand(context, body.action, body.payload);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
