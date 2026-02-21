import { GuestInviteStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/server/auth';
import { createGuestInviteCodesBatch, listGuestInviteCodes } from '../../../../../lib/server/guestInvites';
import { HttpError } from '../../../../../lib/server/http';

const parseInviteStatus = (value: string | null): GuestInviteStatus | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'ACTIVE') return GuestInviteStatus.ACTIVE;
  if (normalized === 'USED') return GuestInviteStatus.USED;
  if (normalized === 'REVOKED') return GuestInviteStatus.REVOKED;
  throw new HttpError(400, 'invite_status_invalid');
};

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') || '100');
    const status = parseInviteStatus(url.searchParams.get('status'));
    const items = await listGuestInviteCodes({ limit, status });
    return NextResponse.json({ items });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to list guest invites' }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const result = await createGuestInviteCodesBatch({
      count: body?.count ?? 1,
      expiresAt: body?.expiresAt,
      campaign: body?.campaign,
      createdBy: admin.id,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to create guest invites' }, { status });
  }
}
