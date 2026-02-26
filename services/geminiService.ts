import { DEFAULT_GAME_CONFIG, type GameConfig } from '../gameConfig';
import type {
  ActorType,
  AuthUser,
  BoardEvent,
  BoardRunSnapshot,
  Choice,
  Evidence,
  GenerateStoryDraftInput,
  GameState,
  GeminiResponse,
  LabModelConfig,
  LandingStats,
  LeaderboardEntry,
  RunSummary,
  StoryDetail,
  StoryEvaluation,
  StorySummary,
  StoryVersionPayload,
  StoryVersionSummary,
} from '../types';

const AUTH_TOKEN_STORAGE_KEY = 'ros_auth_token';

const readAuthToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim() || '';
  return token || null;
};

const writeAuthToken = (token: string): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const normalized = token.trim();
  if (!normalized) {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, normalized);
};

export const clearAuthToken = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

export const getAuthToken = (): string | null => {
  return readAuthToken();
};

const withAuthHeaders = (headers?: Record<string, string>): Record<string, string> => {
  const token = readAuthToken();
  if (!token) {
    return headers ? { ...headers } : {};
  }

  return {
    ...(headers || {}),
    Authorization: `Bearer ${token}`,
  };
};

const normalizeAuthUser = (input: any): AuthUser => {
  return {
    id: String(input?.id || ''),
    walletAddress: String(input?.walletAddress || ''),
    role: input?.role === 'admin' ? 'admin' : 'player',
    authProvider: input?.authProvider === 'guest' ? 'guest' : 'wallet',
    tokenExp: typeof input?.tokenExp === 'number' ? input.tokenExp : Math.floor(Date.now() / 1000),
    isFirstHumanEntry: Boolean(input?.isFirstHumanEntry),
  };
};

const readJsonOrText = async (
  response: Response,
): Promise<{ json: Record<string, unknown> | null; rawText: string }> => {
  const rawText = await response.text();
  if (!rawText) {
    return { json: null, rawText };
  }
  try {
    return { json: JSON.parse(rawText) as Record<string, unknown>, rawText };
  } catch {
    return { json: null, rawText };
  }
};

const extractErrorMessage = (status: number, json: Record<string, unknown> | null, rawText: string): string => {
  const fromJson = typeof json?.error === 'string' ? json.error : null;
  if (fromJson) {
    return fromJson;
  }

  if (rawText.trim().startsWith('<!DOCTYPE') || rawText.trim().startsWith('<html')) {
    return `Server returned HTML instead of JSON (HTTP ${status}). Check Next.js server logs for the real error.`;
  }

  if (rawText.trim()) {
    return rawText.trim().slice(0, 300);
  }

  return `Request failed: ${status}`;
};

const postJson = async <T>(url: string, payload: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: withAuthHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(payload),
  });

  const { json, rawText } = await readJsonOrText(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(response.status, json, rawText));
  }
  if (!json) {
    throw new Error(`Invalid JSON response from ${url} (HTTP ${response.status})`);
  }

  return json as T;
};

const putJson = async <T>(url: string, payload: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: 'PUT',
    headers: withAuthHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(payload),
  });

  const { json, rawText } = await readJsonOrText(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(response.status, json, rawText));
  }
  if (!json) {
    throw new Error(`Invalid JSON response from ${url} (HTTP ${response.status})`);
  }

  return json as T;
};

const getJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    headers: withAuthHeaders(),
  });
  const { json, rawText } = await readJsonOrText(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(response.status, json, rawText));
  }
  if (!json) {
    throw new Error(`Invalid JSON response from ${url} (HTTP ${response.status})`);
  }
  return json as T;
};

const deleteJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    method: 'DELETE',
    headers: withAuthHeaders(),
  });
  const { json, rawText } = await readJsonOrText(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(response.status, json, rawText));
  }
  if (!json) {
    throw new Error(`Invalid JSON response from ${url} (HTTP ${response.status})`);
  }
  return json as T;
};

const asNonEmptyString = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

export const readLabModelConfig = (): LabModelConfig | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem('test_lab_config');
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const providerRaw = asNonEmptyString(parsed.provider).toLowerCase();
    if (providerRaw !== 'gemini' && providerRaw !== 'openai') {
      return null;
    }

    const provider = providerRaw as LabModelConfig['provider'];
    const baseUrl = asNonEmptyString(parsed.baseUrl);
    const model = asNonEmptyString(parsed.model);
    const apiKey = asNonEmptyString(parsed.apiKey);

    if (!model || !apiKey) {
      return null;
    }
    if (provider === 'openai' && !baseUrl) {
      return null;
    }

    return {
      provider,
      baseUrl,
      model,
      apiKey,
    };
  } catch {
    return null;
  }
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

export const evaluateStory = async (payload: {
  provider?: 'gemini' | 'openai';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  session: {
    ending: string;
    turns: number;
    finalSanity: number;
    rulesCount: number;
    inventoryCount: number;
    timeline: Array<{
      turn: number;
      choiceText: string;
      choiceType: string;
      sanityAfter: number;
      newRulesCount: number;
      narrative: string;
    }>;
  };
}): Promise<StoryEvaluation> => {
  return postJson<StoryEvaluation>('/api/v1/eval/story', payload);
};

export const fetchAuthUser = async (): Promise<AuthUser | null> => {
  if (!readAuthToken()) {
    return null;
  }
  try {
    const data = await getJson<{ user: AuthUser | null }>('/api/v1/auth/me');
    if (!data.user) return null;
    return normalizeAuthUser(data.user);
  } catch {
    return null;
  }
};

export const fetchSiweNonce = async (): Promise<{ nonce: string; chainId: number }> => {
  return getJson<{ nonce: string; chainId: number }>('/api/v1/auth/nonce');
};

export const verifySiweLogin = async (message: string, signature: string): Promise<AuthUser> => {
  const data = await postJson<{ token: string; user: AuthUser }>('/api/v1/auth/verify', { message, signature });
  if (!data?.token) {
    throw new Error('Missing auth token in login response');
  }
  writeAuthToken(data.token);
  return normalizeAuthUser(data.user);
};

export const redeemGuestInvite = async (inviteCode: string): Promise<AuthUser> => {
  const data = await postJson<{ token: string; user: AuthUser }>('/api/v1/auth/guest/redeem', { inviteCode });
  if (!data?.token) {
    throw new Error('Missing auth token in guest login response');
  }
  writeAuthToken(data.token);
  return normalizeAuthUser(data.user);
};

export const logoutAuth = async (): Promise<void> => {
  try {
    await postJson('/api/v1/auth/logout', {});
  } finally {
    clearAuthToken();
  }
};

export const startRun = async (
  actorType: ActorType = 'human',
  options?: {
    storyId?: string;
    outputLocale?: string;
  },
): Promise<{
  summary: RunSummary;
  state: GameState;
  recovered: boolean;
}> => {
  const payload: Record<string, unknown> = actorType === 'human' ? {} : { actorType };
  if (options?.storyId) {
    payload.storyId = options.storyId;
  }
  if (options?.outputLocale) {
    payload.outputLocale = options.outputLocale;
  }
  return postJson('/api/v1/runs/start', payload);
};

export const getCurrentRun = async (): Promise<{
  run: {
    summary: RunSummary;
    state: GameState;
  } | null;
}> => {
  return getJson('/api/v1/runs/current');
};

export const getRunDetail = async (runId: string): Promise<{
  summary: RunSummary;
  state: GameState;
}> => {
  return getJson(`/api/v1/runs/${runId}`);
};

export const fetchBoardSnapshot = async (): Promise<{
  serverTime: string;
  activeRuns: BoardRunSnapshot[];
  completedRuns: BoardRunSnapshot[];
  recentEvents: BoardEvent[];
}> => {
  return getJson('/api/v1/board/snapshot');
};

export const submitRunTurn = async (runId: string, choice: Choice): Promise<{
  state: GameState;
  imageUnlocked: boolean;
}> => {
  return postJson(`/api/v1/runs/${runId}/turn`, { choice });
};

export const fetchLandingStats = async (): Promise<LandingStats> => {
  return getJson('/api/v1/stats/landing');
};

export const fetchLeaderboard = async (
  board: 'composite' | 'clear' | 'active',
  window: '7d' | 'all',
): Promise<LeaderboardEntry[]> => {
  const data = await getJson<{ items: LeaderboardEntry[] }>(`/api/v1/leaderboard?board=${board}&window=${window}`);
  return data.items || [];
};

export const fetchAdminConfig = async (): Promise<Record<string, unknown>> => {
  return getJson('/api/v1/admin/config');
};

export const updateAdminConfig = async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
  return putJson('/api/v1/admin/config', payload);
};

export const fetchUnlockPolicy = async (): Promise<Record<string, unknown>> => {
  return getJson('/api/v1/admin/unlock-policy');
};

export const updateUnlockPolicy = async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
  return putJson('/api/v1/admin/unlock-policy', payload);
};

export const addUnlockWhitelist = async (walletAddress: string, note?: string): Promise<Record<string, unknown>> => {
  return postJson('/api/v1/admin/unlock-whitelist', { walletAddress, note });
};

export const removeUnlockWhitelist = async (walletAddress: string): Promise<Record<string, unknown>> => {
  return deleteJson(`/api/v1/admin/unlock-whitelist?walletAddress=${encodeURIComponent(walletAddress)}`);
};

export const addNftRequirementAdmin = async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
  return postJson('/api/v1/admin/nft-requirements', payload);
};

export const removeNftRequirementAdmin = async (id: string): Promise<Record<string, unknown>> => {
  return deleteJson(`/api/v1/admin/nft-requirements?id=${encodeURIComponent(id)}`);
};

export const addTokenRequirementAdmin = async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
  return postJson('/api/v1/admin/token-requirements', payload);
};

export const removeTokenRequirementAdmin = async (id: string): Promise<Record<string, unknown>> => {
  return deleteJson(`/api/v1/admin/token-requirements?id=${encodeURIComponent(id)}`);
};

export const fetchStoriesAdmin = async (): Promise<StorySummary[]> => {
  const data = await getJson<{ items: StorySummary[] }>('/api/v1/admin/stories');
  return data.items || [];
};

export const createStoryAdminApi = async (payload: {
  slug: string;
  title: string;
  summary?: string;
  sourceLocale?: string;
  llmProvider?: 'gemini' | 'openai' | null;
  llmBaseUrl?: string | null;
  llmModel?: string | null;
  llmApiKey?: string | null;
}): Promise<StoryDetail> => {
  return postJson('/api/v1/admin/stories', payload);
};

export const fetchStoryAdmin = async (storyId: string): Promise<StoryDetail> => {
  return getJson(`/api/v1/admin/stories/${encodeURIComponent(storyId)}`);
};

export const updateStoryAdminApi = async (
  storyId: string,
  payload: {
    slug?: string;
    title?: string;
    summary?: string | null;
    sourceLocale?: string;
    llmProvider?: 'gemini' | 'openai' | null;
    llmBaseUrl?: string | null;
    llmModel?: string | null;
    llmApiKey?: string | null;
  },
): Promise<StoryDetail> => {
  return putJson(`/api/v1/admin/stories/${encodeURIComponent(storyId)}`, payload);
};

export const fetchStoryVersionsAdmin = async (storyId: string): Promise<StoryVersionSummary[]> => {
  const data = await getJson<{ items: StoryVersionSummary[] }>(`/api/v1/admin/stories/${encodeURIComponent(storyId)}/versions`);
  return data.items || [];
};

export const createStoryDraftAdmin = async (
  storyId: string,
  payload: StoryVersionPayload,
): Promise<StoryVersionSummary> => {
  return postJson(`/api/v1/admin/stories/${encodeURIComponent(storyId)}/draft`, payload);
};

export const generateStoryDraftAdmin = async (
  storyId: string,
  payload: GenerateStoryDraftInput,
): Promise<StoryVersionSummary> => {
  return postJson(
    `/api/v1/admin/stories/${encodeURIComponent(storyId)}/generate-draft`,
    payload,
  );
};

export const publishStoryAdminApi = async (
  storyId: string,
  versionId?: string,
): Promise<StoryDetail> => {
  return postJson(`/api/v1/admin/stories/${encodeURIComponent(storyId)}/publish`, versionId ? { versionId } : {});
};

export const archiveStoryAdminApi = async (storyId: string): Promise<StoryDetail> => {
  return postJson(`/api/v1/admin/stories/${encodeURIComponent(storyId)}/archive`, {});
};

export const fetchCurrentStoryAdmin = async (): Promise<{ currentStoryId: string | null; story: StorySummary | null }> => {
  return getJson('/api/v1/admin/stories/current');
};

export const setCurrentStoryAdminApi = async (storyId: string): Promise<{ currentStoryId: string; story: StorySummary }> => {
  return putJson('/api/v1/admin/stories/current', { storyId });
};
