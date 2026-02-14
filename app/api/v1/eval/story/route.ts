import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/server/auth';
import { evaluateStoryServer } from '../../../../../lib/server/aiEngine';
import { HttpError } from '../../../../../lib/server/http';
import { getRuntimeConfig } from '../../../../../lib/server/runtimeConfig';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const runtime = await getRuntimeConfig();
    const result = await evaluateStoryServer({
      ...body,
      provider: body.provider || runtime.llmProvider,
      baseUrl: body.baseUrl || runtime.llmBaseUrl || undefined,
      apiKey: body.apiKey || runtime.llmApiKey || undefined,
      model: body.model || runtime.llmModel || undefined,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      {
        error: error?.message || 'Failed to evaluate story',
      },
      { status },
    );
  }
}
