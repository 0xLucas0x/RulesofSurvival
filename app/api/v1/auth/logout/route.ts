import { NextRequest, NextResponse } from 'next/server';
import { clearAuthCookie, revokeTokenFromRequest } from '../../../../../lib/server/auth';

export async function POST(request: NextRequest) {
  try {
    await revokeTokenFromRequest(request, 'logout');
    const response = NextResponse.json({ success: true });
    clearAuthCookie(response);
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Logout failed' }, { status: 500 });
  }
}
