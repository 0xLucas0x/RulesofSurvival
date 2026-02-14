import { NextRequest, NextResponse } from 'next/server';
import { generateNextTurnServer } from '../../../../../lib/server/aiEngine';
import { requireAuth } from '../../../../../lib/server/auth';
import { HttpError } from '../../../../../lib/server/http';
import { getRuntimeConfig } from '../../../../../lib/server/runtimeConfig';

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (user.role !== 'ADMIN') {
      throw new HttpError(403, 'Use /api/v1/runs/:runId/turn for player gameplay');
    }

    const body = await request.json();
    const runtime = await getRuntimeConfig();
    const result = await generateNextTurnServer({
      ...body,
      provider: body.provider || runtime.llmProvider,
      baseUrl: body.baseUrl || runtime.llmBaseUrl || undefined,
      apiKey: body.apiKey || runtime.llmApiKey || undefined,
      model: body.model || runtime.llmModel || undefined,
      gameConfig: body.gameConfig || runtime.gameConfig,
      labMode: true,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      {
        error: error?.message || 'Failed to generate next turn',
      },
      { status },
    );
  }
}
