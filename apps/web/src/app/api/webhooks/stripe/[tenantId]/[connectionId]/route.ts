import { NextResponse } from 'next/server';

// Old provider endpoints cannot reactivate the retired payment module.
export async function POST() {
  return NextResponse.json(
    { error: 'The payments module has been removed.', code: 'PAYMENTS_REMOVED' },
    { status: 410 },
  );
}
