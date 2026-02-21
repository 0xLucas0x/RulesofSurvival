import crypto from 'crypto';
import { UserRole } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { signAuthToken } from '../../../../../../lib/server/auth';
import { JWT_TTL_SECONDS } from '../../../../../../lib/server/appConfig';
import { db } from '../../../../../../lib/server/db';
import { HttpError } from '../../../../../../lib/server/http';
import { applyDualRateLimit } from '../../../../../../lib/server/rateLimit';

/**
 * POST /api/v1/auth/agent/register
 *
 * Register (or re-login) an AI agent without a wallet.
 * Accepts { agentName: string } and returns a JWT token.
 * The same agentName always maps to the same user (idempotent).
 */
export async function POST(request: NextRequest) {
    try {
        applyDualRateLimit(request, null, 'auth:agent-register', { ipMax: 10, windowMs: 60_000 });

        const body = await request.json();
        const agentName = typeof body?.agentName === 'string' ? body.agentName.trim() : '';
        if (!agentName || agentName.length < 2 || agentName.length > 64) {
            throw new HttpError(400, 'agentName is required (2-64 characters)');
        }

        // Generate a deterministic pseudo-wallet from the agent name.
        // Same agentName → same wallet → same user (idempotent, like SIWE upsert).
        const hash = crypto.createHash('sha256').update(`agent:${agentName}`).digest('hex');
        const walletAddress = `0xagent_${hash.slice(0, 34)}`.toLowerCase();

        const user = await db.user.upsert({
            where: { walletAddress },
            update: {
                lastLoginAt: new Date(),
            },
            create: {
                walletAddress,
                role: UserRole.PLAYER,
                lastLoginAt: new Date(),
            },
        });

        const token = await signAuthToken(user);
        const tokenExp = Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS;

        return NextResponse.json({
            token,
            user: {
                id: user.id,
                walletAddress: user.walletAddress,
                role: user.role.toLowerCase(),
                tokenExp,
            },
            agentName,
        });
    } catch (error: any) {
        const status = error instanceof HttpError ? error.status : 500;
        return NextResponse.json({ error: error?.message || 'Agent registration failed' }, { status });
    }
}
