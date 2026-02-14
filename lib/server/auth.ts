import crypto from 'crypto';
import { UserRole, UserStatus } from '@prisma/client';
import { JWTPayload, SignJWT, jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, JWT_TTL_SECONDS, getJwtSecret } from './appConfig';
import { db } from './db';
import { HttpError } from './http';

export type AuthUser = {
  id: string;
  walletAddress: string;
  role: UserRole;
  tokenExp: number;
  jti: string;
};

type TokenClaims = JWTPayload & {
  wallet: string;
  role: UserRole;
};

const secret = () => new TextEncoder().encode(getJwtSecret());

const verifyAndDecode = async (token: string): Promise<{ payload: TokenClaims; jti: string; exp: number; sub: string }> => {
  const verified = await jwtVerify(token, secret());
  const payload = verified.payload as TokenClaims;

  if (!payload.sub || !payload.exp || !payload.jti || !payload.wallet || !payload.role) {
    throw new Error('Invalid auth token payload');
  }

  return {
    payload,
    jti: payload.jti,
    exp: payload.exp,
    sub: payload.sub,
  };
};

export const signAuthToken = async (user: { id: string; walletAddress: string; role: UserRole }): Promise<string> => {
  const jti = crypto.randomUUID();
  return new SignJWT({ wallet: user.walletAddress, role: user.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setSubject(user.id)
    .setJti(jti)
    .setExpirationTime(`${JWT_TTL_SECONDS}s`)
    .sign(secret());
};

export const setAuthCookie = (response: NextResponse, token: string): void => {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: JWT_TTL_SECONDS,
  });
};

export const clearAuthCookie = (response: NextResponse): void => {
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
};

export const getAuthUserFromToken = async (token: string): Promise<AuthUser | null> => {
  const { jti, exp, sub } = await verifyAndDecode(token);

  const revoked = await db.jwtRevocation.findUnique({ where: { jti } });
  if (revoked) {
    return null;
  }

  const user = await db.user.findUnique({ where: { id: sub } });
  if (!user || user.status === UserStatus.BANNED) {
    return null;
  }

  return {
    id: user.id,
    walletAddress: user.walletAddress,
    role: user.role,
    tokenExp: exp,
    jti,
  };
};

export const getAuthUserFromRequest = async (request: NextRequest): Promise<AuthUser | null> => {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  try {
    return await getAuthUserFromToken(token);
  } catch {
    return null;
  }
};

export const requireAuth = async (request: NextRequest): Promise<AuthUser> => {
  const user = await getAuthUserFromRequest(request);
  if (!user) {
    throw new HttpError(401, 'Unauthorized');
  }
  return user;
};

export const requireAdmin = async (request: NextRequest): Promise<AuthUser> => {
  const user = await requireAuth(request);
  if (user.role !== UserRole.ADMIN) {
    throw new HttpError(403, 'Forbidden');
  }
  return user;
};

export const revokeTokenFromRequest = async (request: NextRequest, reason = 'logout'): Promise<void> => {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return;
  }

  try {
    const { jti, exp, sub } = await verifyAndDecode(token);
    await db.jwtRevocation.upsert({
      where: { jti },
      update: { reason, expiresAt: new Date(exp * 1000) },
      create: {
        jti,
        userId: sub,
        reason,
        expiresAt: new Date(exp * 1000),
      },
    });
  } catch {
    // ignore invalid token on logout
  }
};
