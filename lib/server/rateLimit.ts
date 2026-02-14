import { NextRequest } from 'next/server';
import { HttpError } from './http';

const buckets = new Map<string, { count: number; resetAt: number }>();

type LimitOptions = {
  key: string;
  max: number;
  windowMs: number;
};

const consume = ({ key, max, windowMs }: LimitOptions): void => {
  const now = Date.now();
  const hit = buckets.get(key);

  if (!hit || hit.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (hit.count >= max) {
    throw new HttpError(429, 'Rate limit exceeded');
  }

  hit.count += 1;
  buckets.set(key, hit);
};

export const applyDualRateLimit = (
  request: NextRequest,
  walletAddress: string | null | undefined,
  tag: string,
  options?: { ipMax?: number; walletMax?: number; windowMs?: number },
): void => {
  const windowMs = options?.windowMs || 60_000;
  const ipMax = options?.ipMax || 30;
  const walletMax = options?.walletMax || 40;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  consume({ key: `${tag}:ip:${ip}`, max: ipMax, windowMs });

  if (walletAddress) {
    consume({ key: `${tag}:wallet:${walletAddress.toLowerCase()}`, max: walletMax, windowMs });
  }
};
