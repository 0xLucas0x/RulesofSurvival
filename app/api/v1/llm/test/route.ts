import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/server/auth';
import { testConnectionServer } from '../../../../../lib/server/aiEngine';
import { HttpError } from '../../../../../lib/server/http';
import { getRuntimeConfig } from '../../../../../lib/server/runtimeConfig';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const runtime = await getRuntimeConfig();
    const success = await testConnectionServer(
      body.apiKey || runtime.llmApiKey || '',
      body.baseUrl || runtime.llmBaseUrl || '',
      body.provider || runtime.llmProvider || 'gemini',
      body.model || runtime.llmModel || undefined,
    );
    return NextResponse.json({ success });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to test connection' }, { status });
  }
}
