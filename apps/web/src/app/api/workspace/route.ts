import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getWorkspace } from '@afterhours/core';
import { errorResponse } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const candidate =
      new URL(request.url).searchParams.get('tenant') ??
      (await cookies()).get('activeTenant')?.value;
    const workspace = await getWorkspace(request.headers, candidate);
    return NextResponse.json(workspace, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
