import { DEFAULT_GAME_CONFIG } from '../../gameConfig';

export const AUTH_COOKIE_NAME = 'ros_auth';
export const JWT_TTL_SECONDS = 60 * 60 * 24 * 30;
export const SIWE_NONCE_TTL_SECONDS = 60 * 10;
export const MONAD_TESTNET_CHAIN_ID = 10143;

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long');
  }
  return secret;
};

export const getAdminWalletSet = (): Set<string> => {
  const raw = process.env.ADMIN_WALLET_ADDRESSES || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
};

export const getSiweDomain = (hostHeader?: string): string => {
  if (process.env.SIWE_DOMAIN) {
    return process.env.SIWE_DOMAIN;
  }

  const host = (hostHeader || '').trim();
  if (!host) {
    return 'localhost:3000';
  }
  return host;
};

export const getAppBaseUrl = (hostHeader?: string): string => {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL;
  }
  const host = (hostHeader || 'localhost:3000').trim();
  return `http${host.startsWith('localhost') ? '' : 's'}://${host}`;
};

export const getEncryptionKey = (): Buffer => {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('CONFIG_ENCRYPTION_KEY is required');
  }

  const maybeBase64 = Buffer.from(raw, 'base64');
  if (maybeBase64.length === 32) {
    return maybeBase64;
  }

  const maybeUtf8 = Buffer.from(raw, 'utf8');
  if (maybeUtf8.length === 32) {
    return maybeUtf8;
  }

  throw new Error('CONFIG_ENCRYPTION_KEY must be exactly 32 bytes (utf8 or base64)');
};

export const getRpcUrl = (): string => {
  return process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
};

export const getDefaultRuntimeGameConfig = () => DEFAULT_GAME_CONFIG;
