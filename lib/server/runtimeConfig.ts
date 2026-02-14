import { ImageProvider, LlmProvider, Prisma, RuntimeConfig } from '@prisma/client';
import { DEFAULT_GAME_CONFIG, GameConfig } from '../../gameConfig';
import { decryptSecret, encryptSecret } from './crypto';
import { db } from './db';

export type RuntimeConfigResolved = {
  llmProvider: 'gemini' | 'openai';
  llmBaseUrl?: string | null;
  llmApiKey?: string | null;
  llmModel?: string | null;
  imageProvider: 'pollinations' | 'openai';
  imageBaseUrl?: string | null;
  imageApiKey?: string | null;
  imageModel?: string | null;
  gameConfig: GameConfig;
};

type RuntimeConfigUpdateInput = Partial<{
  llmProvider: 'gemini' | 'openai';
  llmBaseUrl: string | null;
  llmApiKey: string | null;
  llmModel: string | null;
  imageProvider: 'pollinations' | 'openai';
  imageBaseUrl: string | null;
  imageApiKey: string | null;
  imageModel: string | null;
  gameConfig: Partial<GameConfig>;
}>;

const toLlmProvider = (v: string | null | undefined): LlmProvider => {
  return v?.toLowerCase() === 'openai' ? LlmProvider.OPENAI : LlmProvider.GEMINI;
};

const toImageProvider = (v: string | null | undefined): ImageProvider => {
  return v?.toLowerCase() === 'openai' ? ImageProvider.OPENAI : ImageProvider.POLLINATIONS;
};

const parseGameConfig = (jsonValue: Prisma.JsonValue): GameConfig => {
  const raw = (jsonValue || {}) as Record<string, unknown>;
  return {
    ...DEFAULT_GAME_CONFIG,
    ...(raw as Partial<GameConfig>),
  };
};

const serialize = (row: RuntimeConfig): RuntimeConfigResolved => {
  return {
    llmProvider: row.llmProvider === LlmProvider.OPENAI ? 'openai' : 'gemini',
    llmBaseUrl: row.llmBaseUrl,
    llmApiKey: decryptSecret(row.llmApiKeyEnc),
    llmModel: row.llmModel,
    imageProvider: row.imageProvider === ImageProvider.OPENAI ? 'openai' : 'pollinations',
    imageBaseUrl: row.imageBaseUrl,
    imageApiKey: decryptSecret(row.imageApiKeyEnc),
    imageModel: row.imageModel,
    gameConfig: parseGameConfig(row.gameConfigJson),
  };
};

const ensureRuntimeConfigRow = async (): Promise<RuntimeConfig> => {
  const found = await db.runtimeConfig.findUnique({ where: { id: 'default' } });
  if (found) {
    return found;
  }

  return db.runtimeConfig.create({
    data: {
      id: 'default',
      llmProvider: LlmProvider.GEMINI,
      imageProvider: ImageProvider.POLLINATIONS,
      gameConfigJson: DEFAULT_GAME_CONFIG as unknown as Prisma.JsonObject,
    },
  });
};

export const getRuntimeConfig = async (): Promise<RuntimeConfigResolved> => {
  const row = await ensureRuntimeConfigRow();
  return serialize(row);
};

export const updateRuntimeConfig = async (
  input: RuntimeConfigUpdateInput,
  updatedBy: string,
): Promise<RuntimeConfigResolved> => {
  const current = await ensureRuntimeConfigRow();
  const currentGameConfig = parseGameConfig(current.gameConfigJson);

  const mergedGameConfig = {
    ...currentGameConfig,
    ...(input.gameConfig || {}),
  };

  const next = await db.runtimeConfig.update({
    where: { id: 'default' },
    data: {
      llmProvider: input.llmProvider ? toLlmProvider(input.llmProvider) : undefined,
      llmBaseUrl: input.llmBaseUrl !== undefined ? input.llmBaseUrl : undefined,
      llmApiKeyEnc: input.llmApiKey !== undefined ? encryptSecret(input.llmApiKey) : undefined,
      llmModel: input.llmModel !== undefined ? input.llmModel : undefined,
      imageProvider: input.imageProvider ? toImageProvider(input.imageProvider) : undefined,
      imageBaseUrl: input.imageBaseUrl !== undefined ? input.imageBaseUrl : undefined,
      imageApiKeyEnc: input.imageApiKey !== undefined ? encryptSecret(input.imageApiKey) : undefined,
      imageModel: input.imageModel !== undefined ? input.imageModel : undefined,
      gameConfigJson: mergedGameConfig as unknown as Prisma.JsonObject,
      updatedBy,
    },
  });

  return serialize(next);
};
