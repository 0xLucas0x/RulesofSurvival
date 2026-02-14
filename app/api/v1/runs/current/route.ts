import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../../lib/server/auth';
import { HttpError } from '../../../../../lib/server/http';
import { getCurrentRun } from '../../../../../lib/server/runs';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const current = await getCurrentRun(user.id);
    if (!current) {
      return NextResponse.json({ run: null });
    }
    return NextResponse.json({ run: current });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to get current run' }, { status });
  }
}
