import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../../lib/server/auth';
import { HttpError } from '../../../../../../../lib/server/http';
import { createStoryDraftVersionAdmin } from '../../../../../../../lib/server/stories';

export async function POST(request: NextRequest, context: { params: Promise<{ storyId: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { storyId } = await context.params;
    const body = await request.json();
    const created = await createStoryDraftVersionAdmin(storyId, body, admin.id);
    return NextResponse.json(created);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to create story draft' }, { status });
  }
}
