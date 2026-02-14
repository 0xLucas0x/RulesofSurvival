import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/server/auth';
import { fetchOpenAIModelsServer } from '../../../../../lib/server/aiEngine';
import { HttpError } from '../../../../../lib/server/http';
import { getRuntimeConfig } from '../../../../../lib/server/runtimeConfig';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const runtime = await getRuntimeConfig();
    const models = await fetchOpenAIModelsServer(
      body.baseUrl || runtime.llmBaseUrl || '',
      body.apiKey || runtime.llmApiKey || '',
    );
    return NextResponse.json({ models });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to fetch models' }, { status });
  }
}
