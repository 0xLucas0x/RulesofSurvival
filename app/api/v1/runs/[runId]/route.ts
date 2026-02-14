import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../../lib/server/auth';
import { HttpError } from '../../../../../lib/server/http';
import { getRunWithState } from '../../../../../lib/server/runs';

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireAuth(request);
    const { runId } = await context.params;
    const run = await getRunWithState(runId, user);
    return NextResponse.json(run);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to get run' }, { status });
  }
}
