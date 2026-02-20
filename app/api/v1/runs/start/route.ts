import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../../lib/server/auth';
import { parseActorTypeInput } from '../../../../../lib/server/board';
import { HttpError } from '../../../../../lib/server/http';
import { startOrGetActiveRun } from '../../../../../lib/server/runs';

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const actorType = parseActorTypeInput(body?.actorType);
    if (body?.storyId && user.role !== 'ADMIN') {
      throw new HttpError(403, 'Only admin can specify storyId');
    }

    const result = await startOrGetActiveRun(
      {
        id: user.id,
        walletAddress: user.walletAddress,
      },
      actorType,
      {
        storyId: typeof body?.storyId === 'string' ? body.storyId : undefined,
        outputLocale: typeof body?.outputLocale === 'string' ? body.outputLocale : undefined,
      },
    );
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to start run' }, { status });
  }
}
