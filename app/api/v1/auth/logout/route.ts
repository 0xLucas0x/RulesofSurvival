import { NextRequest, NextResponse } from 'next/server';
import { revokeTokenFromRequest } from '../../../../../lib/server/auth';

export async function POST(request: NextRequest) {
  try {
    await revokeTokenFromRequest(request, 'logout');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Logout failed' }, { status: 500 });
  }
}
