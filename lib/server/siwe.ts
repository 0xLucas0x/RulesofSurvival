import { UserRole } from '@prisma/client';
import { SiweMessage, generateNonce } from 'siwe';
import { NextRequest } from 'next/server';
import { MONAD_TESTNET_CHAIN_ID, SIWE_NONCE_TTL_SECONDS, getAdminWalletSet, getSiweDomain } from './appConfig';
import { db } from './db';
import { HttpError, normalizeAddress } from './http';

export const createSiweNonce = async (request: NextRequest): Promise<string> => {
  const nonce = generateNonce();
  const now = Date.now();

  await db.siweNonce.create({
    data: {
      nonce,
      createdIp: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      expiresAt: new Date(now + SIWE_NONCE_TTL_SECONDS * 1000),
    },
  });

  return nonce;
};

const ensureDomainAccepted = (messageDomain: string, hostHeader: string | null): void => {
  const expected = getSiweDomain(hostHeader);

  if (messageDomain === expected) {
    return;
  }

  // tolerate localhost without explicit port or with same host prefix
  if (expected.startsWith('localhost') && messageDomain.startsWith('localhost')) {
    return;
  }

  throw new HttpError(400, `SIWE domain mismatch: expected ${expected}`);
};

export const verifySiweAndUpsertUser = async (
  request: NextRequest,
  payload: { message: string; signature: string },
): Promise<{ id: string; walletAddress: string; role: UserRole }> => {
  const { message, signature } = payload;
  if (!message || !signature) {
    throw new HttpError(400, 'message and signature are required');
  }

  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(message);
  } catch {
    throw new HttpError(400, 'Invalid SIWE message');
  }

  const nonceRecord = await db.siweNonce.findUnique({ where: { nonce: siwe.nonce } });
  if (!nonceRecord || nonceRecord.usedAt || nonceRecord.expiresAt < new Date()) {
    throw new HttpError(400, 'Nonce invalid or expired');
  }

  ensureDomainAccepted(siwe.domain, request.headers.get('host'));

  const verified = await siwe.verify({
    signature,
    nonce: siwe.nonce,
  });

  if (!verified.success) {
    throw new HttpError(400, String((verified as any).error || 'SIWE verification failed'));
  }

  if (siwe.chainId !== MONAD_TESTNET_CHAIN_ID) {
    throw new HttpError(400, `Unsupported chain: ${siwe.chainId}`);
  }

  const walletAddress = normalizeAddress(siwe.address);
  const adminSet = getAdminWalletSet();
  const role = adminSet.has(walletAddress) ? UserRole.ADMIN : UserRole.PLAYER;

  const user = await db.user.upsert({
    where: { walletAddress },
    update: {
      role,
      lastLoginAt: new Date(),
    },
    create: {
      walletAddress,
      role,
      lastLoginAt: new Date(),
    },
  });

  await db.siweNonce.update({
    where: { id: nonceRecord.id },
    data: {
      usedAt: new Date(),
      walletAddr: walletAddress,
      userId: user.id,
    },
  });

  return {
    id: user.id,
    walletAddress: user.walletAddress,
    role: user.role,
  };
};
