import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookie, signAuthToken } from '../../../../../lib/server/auth';
import { JWT_TTL_SECONDS } from '../../../../../lib/server/appConfig';
import { db } from '../../../../../lib/server/db';
import { HttpError } from '../../../../../lib/server/http';
import { applyDualRateLimit } from '../../../../../lib/server/rateLimit';
import { verifySiweAndUpsertUser } from '../../../../../lib/server/siwe';

export async function POST(request: NextRequest) {
  try {
    applyDualRateLimit(request, null, 'auth:verify', { ipMax: 20, windowMs: 60_000 });
    const body = await request.json();
    const user = await verifySiweAndUpsertUser(request, {
      message: body.message,
      signature: body.signature,
    });
    const hasRuns = await db.gameRun.count({ where: { userId: user.id } });

    const token = await signAuthToken(user);
    const tokenExp = Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS;
    const response = NextResponse.json({
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        role: user.role.toLowerCase(),
        tokenExp,
        isFirstHumanEntry: hasRuns === 0,
      },
    });
    setAuthCookie(response, token);
    return response;
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Verification failed' }, { status });
  }
}
