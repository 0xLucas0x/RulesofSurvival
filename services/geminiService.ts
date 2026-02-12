import { DEFAULT_GAME_CONFIG, type GameConfig } from '../gameConfig';
import type { Evidence, GeminiResponse } from '../types';

const postJson = async <T>(url: string, payload: Record<string, unknown>): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }

  return data as T;
};

export const generateNextTurn = async (
  history: string[],
  currentAction: string,
  currentRules: string[],
  apiKey?: string,
  baseUrl?: string,
  provider: 'gemini' | 'openai' = 'gemini',
  model?: string,
  currentSanity: number = 100,
  inventory: Evidence[] = [],
  gameConfig: GameConfig = DEFAULT_GAME_CONFIG,
): Promise<GeminiResponse> => {
  return postJson<GeminiResponse>('/api/v1/game/turn', {
    history,
    currentAction,
    currentRules,
    apiKey,
    baseUrl,
    provider,
    model,
    currentSanity,
    inventory,
    gameConfig,
  });
};

export const fetchOpenAIModels = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  const data = await postJson<{ models: string[] }>('/api/v1/llm/models', {
    baseUrl,
    apiKey,
  });
  return data.models || [];
};

export const testConnection = async (
  apiKey: string,
  baseUrl: string,
  provider: 'gemini' | 'openai' = 'gemini',
  model?: string,
): Promise<boolean> => {
  const data = await postJson<{ success: boolean }>('/api/v1/llm/test', {
    apiKey,
    baseUrl,
    provider,
    model,
  });
  return !!data.success;
};

export const fetchOpenAIImageModels = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  const data = await postJson<{ models: string[] }>('/api/v1/image/models', {
    baseUrl,
    apiKey,
  });
  return data.models || [];
};

export const generateSceneImage = async (
  prompt: string,
  provider: 'pollinations' | 'openai',
  options: {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    pollinationsApiKey?: string;
    pollinationsModel?: string;
  },
): Promise<string> => {
  const data = await postJson<{ imageUrl: string }>('/api/v1/image/generate', {
    prompt,
    provider,
    ...options,
  });
  return data.imageUrl;
};
