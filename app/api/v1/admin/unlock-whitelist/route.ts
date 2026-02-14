import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/server/auth';
import { addWhitelistAddress, removeWhitelistAddress } from '../../../../../lib/server/entitlement';
import { HttpError } from '../../../../../lib/server/http';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const item = await addWhitelistAddress(body.walletAddress, body.note);
    return NextResponse.json(item);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to add whitelist address' }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const walletAddress = url.searchParams.get('walletAddress');
    if (!walletAddress) {
      throw new HttpError(400, 'walletAddress is required');
    }

    await removeWhitelistAddress(walletAddress);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to remove whitelist address' }, { status });
  }
}
