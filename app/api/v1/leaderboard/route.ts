import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboard } from '../../../../lib/server/stats';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const board = (url.searchParams.get('board') || 'composite') as 'composite' | 'clear' | 'active';
    const window = (url.searchParams.get('window') || 'all') as '7d' | 'all';
    const limit = Number(url.searchParams.get('limit') || '50');

    const data = await getLeaderboard(board, window, Math.min(Math.max(limit, 1), 100));
    return NextResponse.json({ board, window, items: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load leaderboard' }, { status: 500 });
  }
}
