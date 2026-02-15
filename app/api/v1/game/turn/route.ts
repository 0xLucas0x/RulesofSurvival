import { NextRequest, NextResponse } from 'next/server';
import { generateNextTurnServer } from '../../../../../lib/server/aiEngine';
import { requireAuth } from '../../../../../lib/server/auth';
import { HttpError } from '../../../../../lib/server/http';
import { getRuntimeConfig } from '../../../../../lib/server/runtimeConfig';

export async function POST(request: NextRequest) {
  let debugPayload: Record<string, unknown> | null = null;

  try {
    const user = await requireAuth(request);
    if (user.role !== 'ADMIN') {
      throw new HttpError(403, 'Use /api/v1/runs/:runId/turn for player gameplay');
    }

    const body = await request.json();
    debugPayload = {
      provider: body?.provider,
      baseUrl: body?.baseUrl,
      model: body?.model,
      historyLength: Array.isArray(body?.history) ? body.history.length : 0,
      currentAction: body?.currentAction,
      currentSanity: body?.currentSanity,
      inventoryCount: Array.isArray(body?.inventory) ? body.inventory.length : 0,
      labMode: body?.labMode,
      isOvertime: body?.isOvertime,
    };

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
    console.error('[api/v1/game/turn] failed', {
      errorName: error?.name,
      errorMessage: error?.message,
      errorStack: error?.stack,
      request: debugPayload,
    });
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      {
        error: error?.message || 'Failed to generate next turn',
      },
      { status },
    );
  }
}
