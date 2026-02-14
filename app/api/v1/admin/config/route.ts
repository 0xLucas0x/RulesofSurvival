import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/server/auth';
import { HttpError } from '../../../../../lib/server/http';
import { getRuntimeConfig, updateRuntimeConfig } from '../../../../../lib/server/runtimeConfig';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const config = await getRuntimeConfig();
    return NextResponse.json(config);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to load config' }, { status });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json();

    const updated = await updateRuntimeConfig(
      {
        llmProvider: body.llmProvider,
        llmBaseUrl: body.llmBaseUrl,
        llmApiKey: body.llmApiKey,
        llmModel: body.llmModel,
        imageProvider: body.imageProvider,
        imageBaseUrl: body.imageBaseUrl,
        imageApiKey: body.imageApiKey,
        imageModel: body.imageModel,
        gameConfig: body.gameConfig,
      },
      admin.id,
    );

    return NextResponse.json(updated);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to update config' }, { status });
  }
}
