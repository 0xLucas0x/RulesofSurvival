import { NftTokenStandard, UnlockLogic } from '@prisma/client';
import { createPublicClient, erc20Abi, erc721Abi, getAddress, http, isAddress } from 'viem';
import { db } from './db';
import { MONAD_TESTNET_CHAIN_ID, getRpcUrl } from './appConfig';
import { HttpError, normalizeAddress } from './http';

const erc1155Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const monadChain = {
  id: MONAD_TESTNET_CHAIN_ID,
  name: 'Monad Testnet',
  nativeCurrency: {
    name: 'Monad',
    symbol: 'MON',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [getRpcUrl()] },
    public: { http: [getRpcUrl()] },
  },
};

const client: any = createPublicClient({
  chain: monadChain,
  transport: http(getRpcUrl()),
});

const ttlCache = new Map<string, { expireAt: number; value: boolean }>();

const cacheGet = (key: string): boolean | null => {
  const found = ttlCache.get(key);
  if (!found) return null;
  if (found.expireAt < Date.now()) {
    ttlCache.delete(key);
    return null;
  }
  return found.value;
};

const cacheSet = (key: string, value: boolean): void => {
  ttlCache.set(key, { value, expireAt: Date.now() + 60_000 });
};

const checkNftRequirement = async (
  walletAddress: string,
  req: {
    tokenStandard: NftTokenStandard;
    contractAddress: string;
    tokenId: string | null;
    minBalance: string;
  },
): Promise<boolean> => {
  if (!isAddress(req.contractAddress)) {
    return false;
  }

  const contract = getAddress(req.contractAddress);
  const wallet = getAddress(walletAddress);
  const min = BigInt(req.minBalance || '1');

  try {
    if (req.tokenStandard === NftTokenStandard.ERC721) {
      if (req.tokenId) {
        const owner = await client.readContract({
          address: contract,
          abi: erc721Abi,
          functionName: 'ownerOf',
          args: [BigInt(req.tokenId)],
        });
        return normalizeAddress(String(owner)) === normalizeAddress(wallet);
      }

      const balance = await client.readContract({
        address: contract,
        abi: erc721Abi,
        functionName: 'balanceOf',
        args: [wallet],
      });
      return BigInt(balance) >= min;
    }

    if (!req.tokenId) {
      return false;
    }

    const balance = await client.readContract({
      address: contract,
      abi: erc1155Abi,
      functionName: 'balanceOf',
      args: [wallet, BigInt(req.tokenId)],
    });
    return BigInt(balance) >= min;
  } catch {
    return false;
  }
};

const checkTokenRequirement = async (
  walletAddress: string,
  req: {
    contractAddress: string;
    minBalanceRaw: string;
  },
): Promise<boolean> => {
  if (!isAddress(req.contractAddress)) {
    return false;
  }

  try {
    const balance = await client.readContract({
      address: getAddress(req.contractAddress),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [getAddress(walletAddress)],
    });

    return BigInt(balance) >= BigInt(req.minBalanceRaw);
  } catch {
    return false;
  }
};

export const getUnlockPolicyDetail = async () => {
  const [policy, whitelist, nftRequirements, tokenRequirements] = await Promise.all([
    db.imageUnlockPolicy.findUnique({ where: { id: 'default' } }),
    db.imageUnlockWhitelist.findMany({ orderBy: { createdAt: 'desc' } }),
    db.nftRequirement.findMany({ orderBy: { createdAt: 'desc' } }),
    db.tokenRequirement.findMany({ orderBy: { createdAt: 'desc' } }),
  ]);

  const resolvedPolicy =
    policy ||
    (await db.imageUnlockPolicy.create({
      data: {
        id: 'default',
        enabled: false,
        logic: UnlockLogic.ANY,
        chainId: MONAD_TESTNET_CHAIN_ID,
      },
    }));

  return {
    policy: resolvedPolicy,
    whitelist,
    nftRequirements,
    tokenRequirements,
  };
};

export const updateUnlockPolicy = async (
  input: Partial<{ enabled: boolean; chainId: number }>,
  updatedBy: string,
) => {
  await db.imageUnlockPolicy.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      enabled: !!input.enabled,
      chainId: input.chainId || MONAD_TESTNET_CHAIN_ID,
      logic: UnlockLogic.ANY,
      updatedBy,
    },
    update: {
      enabled: input.enabled,
      chainId: input.chainId,
      updatedBy,
    },
  });

  return getUnlockPolicyDetail();
};

export const addWhitelistAddress = async (walletAddress: string, note?: string) => {
  const normalized = normalizeAddress(walletAddress);
  if (!isAddress(normalized)) {
    throw new HttpError(400, 'Invalid wallet address');
  }

  return db.imageUnlockWhitelist.upsert({
    where: { walletAddress: normalized },
    update: { enabled: true, note },
    create: { walletAddress: normalized, enabled: true, note },
  });
};

export const removeWhitelistAddress = async (walletAddress: string) => {
  const normalized = normalizeAddress(walletAddress);
  return db.imageUnlockWhitelist.delete({ where: { walletAddress: normalized } });
};

export const addNftRequirement = async (input: {
  chainId?: number;
  contractAddress: string;
  tokenStandard: 'erc721' | 'erc1155';
  tokenId?: string | null;
  minBalance?: string;
}) => {
  if (!isAddress(input.contractAddress)) {
    throw new HttpError(400, 'Invalid contract address');
  }

  return db.nftRequirement.create({
    data: {
      chainId: input.chainId || MONAD_TESTNET_CHAIN_ID,
      contractAddress: normalizeAddress(input.contractAddress),
      tokenStandard: input.tokenStandard === 'erc1155' ? NftTokenStandard.ERC1155 : NftTokenStandard.ERC721,
      tokenId: input.tokenId || null,
      minBalance: input.minBalance || '1',
      enabled: true,
    },
  });
};

export const removeNftRequirement = async (id: string) => {
  return db.nftRequirement.delete({ where: { id } });
};

export const addTokenRequirement = async (input: {
  chainId?: number;
  contractAddress: string;
  minBalanceRaw: string;
  decimals?: number;
}) => {
  if (!isAddress(input.contractAddress)) {
    throw new HttpError(400, 'Invalid contract address');
  }

  return db.tokenRequirement.create({
    data: {
      chainId: input.chainId || MONAD_TESTNET_CHAIN_ID,
      contractAddress: normalizeAddress(input.contractAddress),
      minBalanceRaw: input.minBalanceRaw,
      decimals: input.decimals || 18,
      enabled: true,
    },
  });
};

export const removeTokenRequirement = async (id: string) => {
  return db.tokenRequirement.delete({ where: { id } });
};

export const isWalletAllowedForImages = async (walletAddress: string): Promise<boolean> => {
  const normalized = normalizeAddress(walletAddress);
  if (!isAddress(normalized)) {
    return false;
  }

  const cacheKey = `image-unlock:${normalized}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const { policy, whitelist, nftRequirements, tokenRequirements } = await getUnlockPolicyDetail();

  if (!policy.enabled || policy.logic !== UnlockLogic.ANY) {
    cacheSet(cacheKey, false);
    return false;
  }

  const white = whitelist.find((w) => w.enabled && normalizeAddress(w.walletAddress) === normalized);
  if (white) {
    cacheSet(cacheKey, true);
    return true;
  }

  for (const req of nftRequirements) {
    if (!req.enabled) continue;
    // eslint-disable-next-line no-await-in-loop
    const matched = await checkNftRequirement(normalized, req);
    if (matched) {
      cacheSet(cacheKey, true);
      return true;
    }
  }

  for (const req of tokenRequirements) {
    if (!req.enabled) continue;
    // eslint-disable-next-line no-await-in-loop
    const matched = await checkTokenRequirement(normalized, req);
    if (matched) {
      cacheSet(cacheKey, true);
      return true;
    }
  }

  cacheSet(cacheKey, false);
  return false;
};
