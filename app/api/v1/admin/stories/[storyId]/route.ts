import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/server/auth';
import { HttpError } from '../../../../../../lib/server/http';
import { getStoryAdmin, updateStoryAdmin } from '../../../../../../lib/server/stories';

export async function GET(request: NextRequest, context: { params: Promise<{ storyId: string }> }) {
  try {
    await requireAdmin(request);
    const { storyId } = await context.params;
    const item = await getStoryAdmin(storyId);
    return NextResponse.json(item);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to load story' }, { status });
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ storyId: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { storyId } = await context.params;
    const body = await request.json();
    const updated = await updateStoryAdmin(storyId, body, admin.id);
    return NextResponse.json(updated);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to update story' }, { status });
  }
}
