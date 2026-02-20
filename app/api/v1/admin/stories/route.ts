import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/server/auth';
import { HttpError } from '../../../../../lib/server/http';
import { createStoryAdmin, listStoriesAdmin } from '../../../../../lib/server/stories';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const items = await listStoriesAdmin();
    return NextResponse.json({ items });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to list stories' }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json();
    const item = await createStoryAdmin(body, admin.id);
    return NextResponse.json(item);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to create story' }, { status });
  }
}
