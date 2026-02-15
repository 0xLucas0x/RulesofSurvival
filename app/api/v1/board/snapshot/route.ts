import { NextResponse } from 'next/server';
import { getBoardSnapshot } from '../../../../../lib/server/board';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await getBoardSnapshot();
    return NextResponse.json(snapshot, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load board snapshot' }, { status: 500 });
  }
}
