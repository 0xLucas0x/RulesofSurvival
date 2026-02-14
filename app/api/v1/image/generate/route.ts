import { NextRequest, NextResponse } from 'next/server';
import { generateImageServer } from '../../../../../lib/server/aiEngine';
import { requireAuth } from '../../../../../lib/server/auth';
import { isWalletAllowedForImages } from '../../../../../lib/server/entitlement';
import { HttpError } from '../../../../../lib/server/http';
import { applyDualRateLimit } from '../../../../../lib/server/rateLimit';
import { getRuntimeConfig } from '../../../../../lib/server/runtimeConfig';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompt = body.prompt;
    if (!prompt) {
      throw new HttpError(400, 'prompt is required');
    }

    const user = await requireAuth(request);
    applyDualRateLimit(request, user.walletAddress, 'image:generate', { ipMax: 30, walletMax: 20, windowMs: 60_000 });

    if (user.role === 'ADMIN' && body.allowManualOverride) {
      const imageUrl = await generateImageServer(body);
      return NextResponse.json({ imageUrl, unlocked: true, source: 'admin-override' });
    }

    const unlocked = await isWalletAllowedForImages(user.walletAddress);
    if (!unlocked) {
      return NextResponse.json({
        imageUrl: '/hospital_corridor_blur.png',
        unlocked: false,
        reason: 'Image unlock conditions not met',
      });
    }

    const runtime = await getRuntimeConfig();
    const imageUrl = await generateImageServer({
      prompt,
      provider: runtime.imageProvider,
      model: runtime.imageModel || undefined,
      baseUrl: runtime.imageBaseUrl || undefined,
      apiKey: runtime.imageApiKey || undefined,
    });

    return NextResponse.json({ imageUrl, unlocked: true, source: 'runtime-config' });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Failed to generate image' }, { status });
  }
}
