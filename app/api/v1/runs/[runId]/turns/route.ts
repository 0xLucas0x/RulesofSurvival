import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../../../lib/server/auth';
import { HttpError } from '../../../../../../lib/server/http';
import { listRunTurns } from '../../../../../../lib/server/runs';

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireAuth(request);
    const { runId } = await context.params;
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') || '1');
    const pageSize = Number(url.searchParams.get('pageSize') || '20');

    const result = await listRunTurns(runId, user, page, Math.min(pageSize, 100));
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to list turns' }, { status });
  }
}
