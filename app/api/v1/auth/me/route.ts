import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '../../../../../lib/server/auth';
import { db } from '../../../../../lib/server/db';

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    const hasRuns = await db.gameRun.count({ where: { userId: user.id } });

    return NextResponse.json({
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        role: user.role.toLowerCase(),
        tokenExp: user.tokenExp,
        isFirstHumanEntry: hasRuns === 0,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load session' }, { status: 500 });
  }
}
