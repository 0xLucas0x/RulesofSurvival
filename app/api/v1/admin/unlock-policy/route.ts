import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/server/auth';
import { getUnlockPolicyDetail, updateUnlockPolicy } from '../../../../../lib/server/entitlement';
import { HttpError } from '../../../../../lib/server/http';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const detail = await getUnlockPolicyDetail();
    return NextResponse.json(detail);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to load unlock policy' }, { status });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json();
    const detail = await updateUnlockPolicy(
      {
        enabled: body.enabled,
        chainId: body.chainId,
      },
      admin.id,
    );
    return NextResponse.json(detail);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to update unlock policy' }, { status });
  }
}
