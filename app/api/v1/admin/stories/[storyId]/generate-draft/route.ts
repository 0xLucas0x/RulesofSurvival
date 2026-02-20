import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../../lib/server/auth';
import { HttpError } from '../../../../../../../lib/server/http';
import { generateStoryDraftVersionAdmin } from '../../../../../../../lib/server/stories';

export async function POST(request: NextRequest, context: { params: Promise<{ storyId: string }> }) {
  let adminId = 'unknown';
  let storyId = 'unknown';
  try {
    const admin = await requireAdmin(request);
    adminId = admin.id;
    ({ storyId } = await context.params);
    const body = await request.json();
    const created = await generateStoryDraftVersionAdmin(storyId, body, admin.id);
    return NextResponse.json(created);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error('[api/v1/admin/stories/:storyId/generate-draft] failed', {
      storyId,
      adminId,
      status,
      message: error?.message || 'Failed to generate story draft',
      stack: error?.stack,
    });
    return NextResponse.json({ error: error?.message || 'Failed to generate story draft' }, { status });
  }
}
