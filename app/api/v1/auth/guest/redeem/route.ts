import { NextRequest, NextResponse } from 'next/server';
import { signAuthToken } from '../../../../../../lib/server/auth';
import { JWT_TTL_SECONDS } from '../../../../../../lib/server/appConfig';
import { redeemGuestInviteCode } from '../../../../../../lib/server/guestInvites';
import { HttpError } from '../../../../../../lib/server/http';
import { applyDualRateLimit } from '../../../../../../lib/server/rateLimit';

export async function POST(request: NextRequest) {
  try {
    applyDualRateLimit(request, null, 'auth:guest:redeem', { ipMax: 20, windowMs: 60_000 });

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const user = await redeemGuestInviteCode(body?.inviteCode);
    const token = await signAuthToken(user);
    const tokenExp = Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS;

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        role: user.role.toLowerCase(),
        tokenExp,
        isFirstHumanEntry: true,
        authProvider: user.authProvider.toLowerCase(),
      },
    });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Guest invite redeem failed' }, { status });
  }
}
