import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/server/auth';
import { addNftRequirement, removeNftRequirement } from '../../../../../lib/server/entitlement';
import { HttpError } from '../../../../../lib/server/http';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();

    const item = await addNftRequirement({
      chainId: body.chainId,
      contractAddress: body.contractAddress,
      tokenStandard: body.tokenStandard,
      tokenId: body.tokenId,
      minBalance: body.minBalance,
    });

    return NextResponse.json(item);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to add nft requirement' }, { status });
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

    await removeNftRequirement(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to remove nft requirement' }, { status });
  }
}
