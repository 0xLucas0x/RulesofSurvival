import { NextRequest, NextResponse } from 'next/server';
import { testConnectionServer } from '../../../../../lib/server/aiEngine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const success = await testConnectionServer(
      body.apiKey || '',
      body.baseUrl || '',
      body.provider || 'gemini',
      body.model,
    );
    return NextResponse.json({ success });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to test connection' }, { status: 500 });
  }
}
