import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/server/auth';
import { HttpError } from '../../../../../../lib/server/http';
import { getCurrentStoryAdmin, setCurrentStoryAdmin } from '../../../../../../lib/server/stories';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const current = await getCurrentStoryAdmin();
    return NextResponse.json(current);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to load current story' }, { status });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json();
    if (!body?.storyId || typeof body.storyId !== 'string') {
      throw new HttpError(400, 'storyId is required');
    }
    const updated = await setCurrentStoryAdmin(body.storyId, admin.id);
    return NextResponse.json(updated);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to set current story' }, { status });
  }
}
