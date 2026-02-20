import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../../lib/server/auth';
import { HttpError } from '../../../../../../../lib/server/http';
import { listStoryVersionsAdmin } from '../../../../../../../lib/server/stories';

export async function GET(request: NextRequest, context: { params: Promise<{ storyId: string }> }) {
  try {
    await requireAdmin(request);
    const { storyId } = await context.params;
    const items = await listStoryVersionsAdmin(storyId);
    return NextResponse.json({ items });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to list story versions' }, { status });
  }
}
