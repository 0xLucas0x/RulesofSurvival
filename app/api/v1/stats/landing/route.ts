import { NextResponse } from 'next/server';
import { getLandingStats } from '../../../../../lib/server/stats';

export async function GET() {
  try {
    const stats = await getLandingStats();
    return NextResponse.json(stats);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load stats' }, { status: 500 });
  }
}
