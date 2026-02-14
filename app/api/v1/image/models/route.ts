import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/server/auth';
import { fetchOpenAIImageModelsServer } from '../../../../../lib/server/aiEngine';
import { HttpError } from '../../../../../lib/server/http';
import { getRuntimeConfig } from '../../../../../lib/server/runtimeConfig';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const runtime = await getRuntimeConfig();
    const models = await fetchOpenAIImageModelsServer(
      body.baseUrl || runtime.imageBaseUrl || '',
      body.apiKey || runtime.imageApiKey || '',
    );
    return NextResponse.json({ models });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to fetch image models' }, { status });
  }
}
