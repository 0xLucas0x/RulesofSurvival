import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/server/auth';
import { addTokenRequirement, removeTokenRequirement } from '../../../../../lib/server/entitlement';
import { HttpError } from '../../../../../lib/server/http';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();

    const item = await addTokenRequirement({
      chainId: body.chainId,
      contractAddress: body.contractAddress,
      minBalanceRaw: body.minBalanceRaw,
      decimals: body.decimals,
    });

    return NextResponse.json(item);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to add token requirement' }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      throw new HttpError(400, 'id is required');
    }

    await removeTokenRequirement(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to remove token requirement' }, { status });
  }
}
