import crypto from 'crypto';
import { AuthProvider, GuestInviteStatus, Prisma, UserRole } from '@prisma/client';
import { db } from './db';
import { HttpError } from './http';

const INVITE_SEGMENTS = 3;
const INVITE_SEGMENT_LENGTH = 4;
const INVITE_CODE_LENGTH = INVITE_SEGMENTS * INVITE_SEGMENT_LENGTH;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_INVITE_BATCH_SIZE = 500;
const MAX_CODE_RETRY_PER_ITEM = 20;

const randomCodeChunk = (length: number): string => {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const index = crypto.randomInt(0, INVITE_ALPHABET.length);
    out += INVITE_ALPHABET[index];
  }
  return out;
};

const generateInviteCode = (): string => {
  const chunks: string[] = [];
  for (let i = 0; i < INVITE_SEGMENTS; i += 1) {
    chunks.push(randomCodeChunk(INVITE_SEGMENT_LENGTH));
  }
  return chunks.join('-');
};

const normalizeInviteCode = (value: string): string => {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
};

const hashInviteCode = (normalizedCode: string): string => {
  return crypto.createHash('sha256').update(normalizedCode).digest('hex');
};

const maskInviteCode = (value: string): string => {
  if (!value) return '';
  const compact = normalizeInviteCode(value);
  if (compact.length <= 4) return compact;
  return `${compact.slice(0, 4)}...${compact.slice(-4)}`;
};

const parseInviteExpiry = (value: unknown): Date | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invite_expiry_invalid');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'invite_expiry_invalid');
  }
  return parsed;
};

const assertInviteCodeInput = (inviteCode: unknown): string => {
  if (typeof inviteCode !== 'string' || !inviteCode.trim()) {
    throw new HttpError(400, 'invite_code_required');
  }
  const normalized = normalizeInviteCode(inviteCode);
  if (normalized.length !== INVITE_CODE_LENGTH) {
    throw new HttpError(400, 'invite_code_invalid');
  }
  return normalized;
};

const createGuestUser = async (tx: Prisma.TransactionClient, now: Date) => {
  const id = crypto.randomUUID();
  const syntheticWallet = `guest_${id.replace(/-/g, '').slice(0, 20)}`;
  return tx.user.create({
    data: {
      id,
      walletAddress: syntheticWallet,
      role: UserRole.PLAYER,
      authProvider: AuthProvider.GUEST,
      lastLoginAt: now,
    },
  });
};

export const redeemGuestInviteCode = async (
  inviteCodeInput: unknown,
): Promise<{ id: string; walletAddress: string; role: UserRole; authProvider: AuthProvider }> => {
  const normalizedCode = assertInviteCodeInput(inviteCodeInput);
  const codeHash = hashInviteCode(normalizedCode);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const invite = await tx.guestInviteCode.findUnique({
      where: { codeHash },
    });

    if (!invite) {
      throw new HttpError(404, 'invite_code_not_found');
    }
    if (invite.status === GuestInviteStatus.USED || invite.usedAt) {
      throw new HttpError(409, 'invite_code_used');
    }
    if (invite.expiresAt && invite.expiresAt <= now) {
      throw new HttpError(410, 'invite_code_expired');
    }
    if (invite.status === GuestInviteStatus.REVOKED) {
      throw new HttpError(409, 'invite_code_revoked');
    }

    const user = await createGuestUser(tx, now);

    const updated = await tx.guestInviteCode.updateMany({
      where: {
        id: invite.id,
        status: GuestInviteStatus.ACTIVE,
        usedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        status: GuestInviteStatus.USED,
        usedAt: now,
        usedByUserId: user.id,
      },
    });

    if (updated.count !== 1) {
      throw new HttpError(409, 'invite_code_used');
    }

    return {
      id: user.id,
      walletAddress: user.walletAddress,
      role: user.role,
      authProvider: user.authProvider,
    };
  });
};

export const createGuestInviteCodesBatch = async (params: {
  count: number;
  expiresAt?: unknown;
  campaign?: unknown;
  createdBy?: string;
}) => {
  const count = Number(params.count);
  if (!Number.isInteger(count) || count <= 0 || count > MAX_INVITE_BATCH_SIZE) {
    throw new HttpError(400, 'invite_count_invalid');
  }

  const expiresAt = parseInviteExpiry(params.expiresAt);
  if (expiresAt && expiresAt <= new Date()) {
    throw new HttpError(400, 'invite_expiry_past');
  }

  const campaign = typeof params.campaign === 'string' ? params.campaign.trim() : '';
  const rows: Array<{ id: string; code: string; campaign: string | null; expiresAt: Date | null; createdAt: Date }> = [];

  for (let i = 0; i < count; i += 1) {
    let created = false;
    for (let attempt = 0; attempt < MAX_CODE_RETRY_PER_ITEM; attempt += 1) {
      const code = generateInviteCode();
      const normalized = normalizeInviteCode(code);
      const codeHash = hashInviteCode(normalized);

      try {
        const row = await db.guestInviteCode.create({
          data: {
            codeHash,
            status: GuestInviteStatus.ACTIVE,
            campaign: campaign || null,
            expiresAt,
            createdBy: params.createdBy || null,
          },
        });
        rows.push({
          id: row.id,
          code,
          campaign: row.campaign,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
        });
        created = true;
        break;
      } catch (error: any) {
        if (error?.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      throw new HttpError(500, 'invite_generation_failed');
    }
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      code: row.code,
      codeMasked: maskInviteCode(row.code),
      campaign: row.campaign,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    })),
  };
};

export const listGuestInviteCodes = async (params?: {
  limit?: number;
  status?: GuestInviteStatus;
}) => {
  const limit = Math.min(Math.max(Number(params?.limit || 100), 1), 500);
  const items = await db.guestInviteCode.findMany({
    where: params?.status ? { status: params.status } : undefined,
    include: {
      usedByUser: {
        select: {
          id: true,
          walletAddress: true,
        },
      },
      creator: {
        select: {
          id: true,
          walletAddress: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return items.map((item) => ({
    id: item.id,
    status: item.status.toLowerCase(),
    campaign: item.campaign,
    expiresAt: item.expiresAt,
    usedAt: item.usedAt,
    createdAt: item.createdAt,
    usedBy: item.usedByUser
      ? {
          id: item.usedByUser.id,
          walletAddress: item.usedByUser.walletAddress,
        }
      : null,
    createdBy: item.creator
      ? {
          id: item.creator.id,
          walletAddress: item.creator.walletAddress,
        }
      : null,
  }));
};
