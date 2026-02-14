import { NextRequest, NextResponse } from 'next/server';
import { applyDualRateLimit } from '../../../../../lib/server/rateLimit';
import { createSiweNonce } from '../../../../../lib/server/siwe';

export async function GET(request: NextRequest) {
  try {
    applyDualRateLimit(request, null, 'auth:nonce', { ipMax: 20, windowMs: 60_000 });
    const nonce = await createSiweNonce(request);
    return NextResponse.json({ nonce, chainId: 10143 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to create nonce' }, { status: 500 });
  }
}
