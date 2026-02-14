import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../../../lib/server/auth';
import { HttpError } from '../../../../../../lib/server/http';
import { applyDualRateLimit } from '../../../../../../lib/server/rateLimit';
import { submitRunTurn } from '../../../../../../lib/server/runs';

export async function POST(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireAuth(request);
    applyDualRateLimit(request, user.walletAddress, 'runs:turn', { ipMax: 80, walletMax: 50, windowMs: 60_000 });
    const { runId } = await context.params;
    const body = await request.json();

    if (!body?.choice?.text || !body?.choice?.actionType || !body?.choice?.id) {
      throw new HttpError(400, 'choice with id/text/actionType is required');
    }

    const result = await submitRunTurn(runId, user, body.choice);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[api/v1/runs/:runId/turn] failed', error);
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to submit turn' }, { status });
  }
}
