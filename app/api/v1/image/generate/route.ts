import { NextRequest, NextResponse } from 'next/server';
import { generateImageServer } from '../../../../../lib/server/aiEngine';
import { requireAuth } from '../../../../../lib/server/auth';
import { isWalletAllowedForImages } from '../../../../../lib/server/entitlement';
import { HttpError } from '../../../../../lib/server/http';
import { applyDualRateLimit } from '../../../../../lib/server/rateLimit';
import { getRuntimeConfig } from '../../../../../lib/server/runtimeConfig';

const maskWallet = (walletAddress: string | null | undefined): string => {
  if (!walletAddress) {
    return 'unknown';
  }
  if (walletAddress.length <= 10) {
    return walletAddress;
  }
  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
};

export async function POST(request: NextRequest) {
  const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const logContext: Record<string, unknown> = {
    traceId,
    route: '/api/v1/image/generate',
    userId: 'unknown',
    walletMasked: 'unknown',
    role: 'unknown',
    manualOverride: false,
    unlocked: null,
    runtimeImageProvider: null,
    runtimeHasImageBaseUrl: null,
    runtimeHasImageApiKey: null,
  };

  try {
    const body = await request.json();
    const prompt = body.prompt;
    logContext.manualOverride = Boolean(body.allowManualOverride);
    if (!prompt) {
      throw new HttpError(400, 'prompt is required');
    }

    const user = await requireAuth(request);
    logContext.userId = user.id;
    logContext.walletMasked = maskWallet(user.walletAddress);
    logContext.role = user.role;
    applyDualRateLimit(request, user.walletAddress, 'image:generate', { ipMax: 30, walletMax: 20, windowMs: 60_000 });

    if (user.role === 'ADMIN' && body.allowManualOverride) {
      const imageUrl = await generateImageServer(body);
      console.info('[api/v1/image/generate] admin manual override success', logContext);
      return NextResponse.json({ imageUrl, unlocked: true, source: 'admin-override' });
    }

    const unlocked = await isWalletAllowedForImages(user.walletAddress);
    logContext.unlocked = unlocked;
    if (!unlocked) {
      console.warn('[api/v1/image/generate] image locked by entitlement', logContext);
      return NextResponse.json({
        imageUrl: '/hospital_corridor_blur.png',
        unlocked: false,
        reason: 'Image unlock conditions not met',
      });
    }

    const runtime = await getRuntimeConfig();
    logContext.runtimeImageProvider = runtime.imageProvider;
    logContext.runtimeHasImageBaseUrl = Boolean(runtime.imageBaseUrl && runtime.imageBaseUrl.trim());
    logContext.runtimeHasImageApiKey = Boolean(runtime.imageApiKey && runtime.imageApiKey.trim());
    const imageUrl = await generateImageServer({
      prompt,
      provider: runtime.imageProvider,
      model: runtime.imageModel || undefined,
      baseUrl: runtime.imageBaseUrl || undefined,
      apiKey: runtime.imageApiKey || undefined,
    });

    console.info('[api/v1/image/generate] runtime image generation success', logContext);
    return NextResponse.json({ imageUrl, unlocked: true, source: 'runtime-config' });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error('[api/v1/image/generate] failed', {
      ...logContext,
      status,
      errorMessage: error?.message || 'unknown',
      errorName: error?.name || 'Error',
      stack: error?.stack,
    });
    return NextResponse.json({ error: error?.message || 'Failed to generate image' }, { status });
  }
}
