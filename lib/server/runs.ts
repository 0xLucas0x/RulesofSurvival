import { AuthProvider, GameRunStatus, RunActorType, UserRole } from '@prisma/client';
import { INITIAL_STATE } from '../../constants';
import { ActorType, Choice, GameState, GeminiResponse } from '../../types';
import { generateNextTurnServer } from './aiEngine';
import {
  getSanityCriticalThreshold,
  parseActorTypeInput,
  publishRunStarted,
  publishRunTurnUpdate,
  runStatusFromOutcome,
  syncBoardRunSnapshotFromDb,
} from './board';
import { db } from './db';
import { isWalletAllowedForImages } from './entitlement';
import { HttpError } from './http';
import { composeStorySystemInstruction } from './storyPrompt';
import { resolveStoryForRunStart, resolveStoryLlmForTurn, resolveStoryVersionForTurn } from './stories';
import { computeRunScore } from './scoring';
import { getRuntimeConfig } from './runtimeConfig';
import { recordRunCompleted, recordRunStarted } from './stats';

const specialRuleDropKeywords = ['完整守则', '整页守则', '规则汇编', '值班手册', '患者守则原件', '公告栏整版'];
const DEFAULT_OUTPUT_LOCALE = 'zh-CN';

type PersistedState = Omit<GameState, 'isLoading'>;

type RunSnapshot = {
  llm: {
    provider: 'gemini' | 'openai';
    baseUrl?: string | null;
    apiKey?: string | null;
    model?: string | null;
  };
  image: {
    provider: 'pollinations' | 'openai';
    baseUrl?: string | null;
    apiKey?: string | null;
    model?: string | null;
  };
  gameConfig: any;
  outputLocale: string;
  story: {
    storyId?: string | null;
    storyVersionId?: string | null;
    storySlug?: string | null;
    storyTitle?: string | null;
  };
  createdAt: string;
};

const cleanState = (state: GameState): PersistedState => {
  return {
    sanity: state.sanity,
    location: state.location,
    narrative: state.narrative,
    imagePrompt: state.imagePrompt,
    choices: state.choices,
    rules: state.rules,
    inventory: state.inventory,
    turnCount: state.turnCount,
    isGameOver: state.isGameOver,
    isVictory: !!state.isVictory,
  };
};

const normalizeOutputLocale = (value: unknown): string => {
  if (typeof value !== 'string') {
    return DEFAULT_OUTPUT_LOCALE;
  }
  const locale = value.trim();
  return locale || DEFAULT_OUTPUT_LOCALE;
};

const coercePersistedState = (value: unknown): PersistedState => {
  if (!value || typeof value !== 'object') {
    return cleanState(INITIAL_STATE);
  }

  const raw = value as Record<string, any>;
  const fallback = cleanState(INITIAL_STATE);

  const sanityRaw = Number(raw.sanity);
  const sanity = Number.isFinite(sanityRaw) ? Math.max(0, Math.min(100, Math.round(sanityRaw))) : fallback.sanity;
  const choices = Array.isArray(raw.choices) ? (raw.choices as Choice[]) : fallback.choices;
  const rules = Array.isArray(raw.rules) ? raw.rules.filter((r) => typeof r === 'string') : fallback.rules;
  const inventory = Array.isArray(raw.inventory) ? raw.inventory : fallback.inventory;
  const turnCountRaw = Number(raw.turnCount);
  const turnCount = Number.isFinite(turnCountRaw) ? Math.max(0, Math.floor(turnCountRaw)) : fallback.turnCount;

  return {
    sanity,
    location: typeof raw.location === 'string' && raw.location ? raw.location : fallback.location,
    narrative: typeof raw.narrative === 'string' && raw.narrative ? raw.narrative : fallback.narrative,
    imagePrompt: typeof raw.imagePrompt === 'string' && raw.imagePrompt ? raw.imagePrompt : fallback.imagePrompt,
    choices,
    rules,
    inventory,
    turnCount,
    isGameOver: Boolean(raw.isGameOver),
    isVictory: Boolean(raw.isVictory),
  };
};

const initialState = (seed?: unknown): PersistedState => {
  if (seed) {
    return coercePersistedState(seed);
  }
  return cleanState(INITIAL_STATE);
};

const ensureRunAccessible = async (runId: string, authUser: { id: string; role: UserRole }) => {
  const run = await db.gameRun.findUnique({
    where: { id: runId },
    include: {
      story: {
        select: {
          id: true,
          slug: true,
          title: true,
        },
      },
    },
  });
  if (!run) {
    throw new HttpError(404, 'Run not found');
  }

  if (authUser.role !== UserRole.ADMIN && run.userId !== authUser.id) {
    throw new HttpError(403, 'Forbidden run access');
  }

  return run;
};

const buildHistoryFromTurns = (turns: Array<{ turnNo: number; inputJson: any; stateBeforeJson: any }>): string[] => {
  return turns.map((turn) => {
    const choice = turn.inputJson?.choice || {};
    const before = turn.stateBeforeJson || {};
    return `Turn ${before.turnCount ?? turn.turnNo - 1}: Location: ${before.location || 'unknown'}. Narrative: ${before.narrative || ''}. Choice Made: ${choice.text || ''} (${choice.actionType || 'investigate'})`;
  });
};

const applyAiResult = (prev: PersistedState, choice: Choice, response: GeminiResponse): PersistedState => {
  const newSanity = Math.max(0, Math.min(100, prev.sanity + response.sanity_change));

  const incomingRules = response.new_rules || [];
  const isSpecialRuleDrop =
    (choice.actionType === 'investigate' || choice.actionType === 'item') &&
    specialRuleDropKeywords.some((keyword) => response.narrative.includes(keyword));
  const cappedIncomingRules = isSpecialRuleDrop ? incomingRules.slice(0, 2) : incomingRules.slice(0, 1);
  const uniqueIncomingRules = cappedIncomingRules.filter((r) => !prev.rules.includes(r));
  const newRules = [...prev.rules, ...uniqueIncomingRules];

  const incomingEvidence = response.new_evidence || [];
  let newInventory = [...prev.inventory, ...incomingEvidence];

  if (response.consumed_item_id) {
    newInventory = newInventory.filter((item) => item.id !== response.consumed_item_id);
  }

  const isGameOver = newSanity <= 0 || response.is_game_over;

  return {
    sanity: newSanity,
    location: response.location_name || prev.location,
    narrative: response.narrative,
    imagePrompt: response.image_prompt_english,
    choices: response.choices,
    rules: newRules,
    inventory: newInventory,
    turnCount: prev.turnCount + 1,
    isGameOver,
    isVictory: !!response.is_victory,
  };
};

const getLastStateFromRun = async (run: {
  id: string;
  storyId?: string | null;
  storyVersionIdAtStart?: string | null;
}): Promise<PersistedState> => {
  const lastTurn = await db.gameTurn.findFirst({
    where: { runId: run.id },
    orderBy: { turnNo: 'desc' },
  });

  if (!lastTurn) {
    const storySeed = await resolveStoryVersionForTurn({
      storyId: run.storyId,
      storyVersionIdAtStart: run.storyVersionIdAtStart,
    });
    return initialState(storySeed?.initialStateJson);
  }

  return coercePersistedState(lastTurn.stateAfterJson);
};

const makeSnapshot = async (params: {
  outputLocale: string;
  story?: {
    storyId?: string | null;
    storyVersionId?: string | null;
    storySlug?: string | null;
    storyTitle?: string | null;
  };
}): Promise<RunSnapshot> => {
  const cfg = await getRuntimeConfig();
  return {
    llm: {
      provider: cfg.llmProvider,
      baseUrl: cfg.llmBaseUrl,
      apiKey: cfg.llmApiKey,
      model: cfg.llmModel,
    },
    image: {
      provider: cfg.imageProvider,
      baseUrl: cfg.imageBaseUrl,
      apiKey: cfg.imageApiKey,
      model: cfg.imageModel,
    },
    gameConfig: cfg.gameConfig,
    outputLocale: params.outputLocale,
    story: params.story || {},
    createdAt: new Date().toISOString(),
  };
};

const toRunSummary = (run: {
  id: string;
  status: GameRunStatus;
  currentTurnNo: number;
  startedAt: Date;
  isVictory: boolean | null;
  actorType: RunActorType;
  storyId?: string | null;
  outputLocale?: string;
  story?: {
    slug: string;
    title: string;
  } | null;
}) => ({
  runId: run.id,
  status: run.status.toLowerCase(),
  turnNo: run.currentTurnNo,
  startedAt: run.startedAt,
  actorType: run.actorType === RunActorType.AGENT ? 'agent' : 'human',
  isVictory: run.isVictory,
  storyId: run.storyId ?? null,
  storySlug: run.story?.slug ?? null,
  storyTitle: run.story?.title ?? null,
  outputLocale: run.outputLocale || DEFAULT_OUTPUT_LOCALE,
});

export const startOrGetActiveRun = async (
  authUser: { id: string; walletAddress: string; authProvider: AuthProvider },
  actorTypeInput: ActorType,
  options?: {
    storyId?: string | null;
    outputLocale?: string;
  },
) => {
  const actorType = parseActorTypeInput(actorTypeInput);
  const outputLocale = normalizeOutputLocale(options?.outputLocale);
  const active = await db.gameRun.findFirst({
    where: { userId: authUser.id, status: GameRunStatus.ACTIVE },
    orderBy: { startedAt: 'desc' },
    include: {
      story: {
        select: {
          id: true,
          slug: true,
          title: true,
        },
      },
    },
  });

  if (active) {
    void syncBoardRunSnapshotFromDb(active.id);
    const state = await getLastStateFromRun(active);
    return {
      summary: toRunSummary(active),
      state,
      recovered: true,
    };
  }

  if (authUser.authProvider === AuthProvider.GUEST) {
    const priorRuns = await db.gameRun.count({
      where: { userId: authUser.id },
    });
    if (priorRuns > 0) {
      throw new HttpError(403, 'guest_trial_consumed');
    }
  }

  const selectedStory = await resolveStoryForRunStart(options?.storyId || null);
  const snapshot = await makeSnapshot({
    outputLocale,
    story: {
      storyId: selectedStory?.storyId || null,
      storyVersionId: selectedStory?.storyVersionId || null,
      storySlug: selectedStory?.storySlug || null,
      storyTitle: selectedStory?.storyTitle || null,
    },
  });
  const created = await db.gameRun.create({
    data: {
      userId: authUser.id,
      storyId: selectedStory?.storyId || null,
      storyVersionIdAtStart: selectedStory?.storyVersionId || null,
      outputLocale,
      status: GameRunStatus.ACTIVE,
      actorType: actorType === 'agent' ? RunActorType.AGENT : RunActorType.HUMAN,
      currentTurnNo: 0,
      configSnapshotJson: snapshot as any,
      activeKey: authUser.id,
    },
    include: {
      story: {
        select: {
          id: true,
          slug: true,
          title: true,
        },
      },
    },
  });

  await recordRunStarted(created.startedAt);
  void publishRunStarted({
    runId: created.id,
    actorType,
    walletAddress: authUser.walletAddress,
    startedAt: created.startedAt,
  });

  return {
    summary: toRunSummary(created),
    state: initialState(selectedStory?.initialStateJson),
    recovered: false,
  };
};

export const getCurrentRun = async (userId: string) => {
  const run = await db.gameRun.findFirst({
    where: { userId, status: GameRunStatus.ACTIVE },
    orderBy: { startedAt: 'desc' },
    include: {
      story: {
        select: {
          id: true,
          slug: true,
          title: true,
        },
      },
    },
  });

  if (!run) {
    return null;
  }

  const state = await getLastStateFromRun(run);
  return {
    summary: toRunSummary(run),
    state,
  };
};

export const getRunWithState = async (runId: string, authUser: { id: string; role: UserRole }) => {
  const run = await ensureRunAccessible(runId, authUser);
  const state = await getLastStateFromRun(run);
  return {
    summary: toRunSummary(run),
    state,
  };
};

export const listRunTurns = async (
  runId: string,
  authUser: { id: string; role: UserRole },
  page = 1,
  pageSize = 20,
) => {
  await ensureRunAccessible(runId, authUser);
  const skip = Math.max(0, (page - 1) * pageSize);

  const [items, total] = await Promise.all([
    db.gameTurn.findMany({
      where: { runId },
      orderBy: { turnNo: 'asc' },
      skip,
      take: pageSize,
    }),
    db.gameTurn.count({ where: { runId } }),
  ]);

  return {
    total,
    page,
    pageSize,
    items,
  };
};

export const submitRunTurn = async (
  runId: string,
  authUser: { id: string; role: UserRole; walletAddress: string },
  choice: Choice,
) => {
  const run = await ensureRunAccessible(runId, authUser);
  if (run.status !== GameRunStatus.ACTIVE) {
    throw new HttpError(400, 'Run is not active');
  }

  const turns = await db.gameTurn.findMany({
    where: { runId },
    orderBy: { turnNo: 'asc' },
  });

  const stateBefore = turns.length
    ? coercePersistedState(turns[turns.length - 1].stateAfterJson)
    : await getLastStateFromRun(run);

  if (stateBefore.isGameOver) {
    throw new HttpError(400, 'Run is already completed');
  }

  const history = buildHistoryFromTurns(turns);
  const currentHistoryLine = `Turn ${stateBefore.turnCount}: Location: ${stateBefore.location}. Narrative: ${stateBefore.narrative}. Choice Made: ${choice.text} (${choice.actionType})`;

  // Always resolve runtime config at turn time so admin updates take effect immediately.
  const liveConfig = await getRuntimeConfig();
  const storyInstructionContext = await resolveStoryVersionForTurn({
    storyId: run.storyId,
    storyVersionIdAtStart: run.storyVersionIdAtStart,
  });
  const storyLlm = await resolveStoryLlmForTurn(run.storyId);
  const outputLocale = normalizeOutputLocale(run.outputLocale);
  const snapshot: RunSnapshot = {
    llm: {
      provider: storyLlm.provider,
      baseUrl: storyLlm.baseUrl,
      apiKey: storyLlm.apiKey,
      model: storyLlm.model,
    },
    image: {
      provider: liveConfig.imageProvider,
      baseUrl: liveConfig.imageBaseUrl,
      apiKey: liveConfig.imageApiKey,
      model: liveConfig.imageModel,
    },
    gameConfig: liveConfig.gameConfig,
    outputLocale,
    story: {
      storyId: storyInstructionContext?.storyId || run.storyId || null,
      storyVersionId: storyInstructionContext?.storyVersionId || run.storyVersionIdAtStart || null,
      storySlug: storyInstructionContext?.storySlug || run.story?.slug || null,
      storyTitle: storyInstructionContext?.storyTitle || run.story?.title || null,
    },
    createdAt: new Date().toISOString(),
  };
  const gameConfig = snapshot.gameConfig as any;
  const systemInstructionOverride = storyInstructionContext
    ? composeStorySystemInstruction({
      templateRaw: storyInstructionContext.instructionTemplateRaw,
      gameConfig,
      outputLocale,
    })
    : undefined;

  const startedAt = Date.now();
  const ai = await generateNextTurnServer({
    history: [...history, currentHistoryLine],
    currentAction: choice.text,
    currentRules: stateBefore.rules,
    apiKey: snapshot.llm.apiKey || undefined,
    baseUrl: snapshot.llm.baseUrl || undefined,
    provider: snapshot.llm.provider,
    model: snapshot.llm.model || undefined,
    currentSanity: stateBefore.sanity,
    inventory: stateBefore.inventory,
    gameConfig,
    systemInstructionOverride,
    outputLocale,
    storyTitle: snapshot.story.storyTitle || undefined,
    storySlug: snapshot.story.storySlug || undefined,
  });
  const latencyMs = Date.now() - startedAt;

  const stateAfter = applyAiResult(stateBefore, choice, ai);
  const turnNo = run.currentTurnNo + 1;

  const createdTurn = await db.$transaction(async (tx) => {
    const turn = await tx.gameTurn.create({
      data: {
        runId,
        turnNo,
        inputJson: {
          choice,
          historyLine: currentHistoryLine,
        } as any,
        outputJson: ai as any,
        stateBeforeJson: stateBefore as any,
        stateAfterJson: stateAfter as any,
        latencyMs,
      },
    });

    const runPatch: any = {
      currentTurnNo: turnNo,
      lastTurnId: turn.id,
      configSnapshotJson: snapshot as any,
    };

    if (stateAfter.isGameOver) {
      const score = computeRunScore({
        isVictory: stateAfter.isVictory,
        turns: stateAfter.turnCount,
        finalSanity: stateAfter.sanity,
        rulesCount: stateAfter.rules.length,
        inventoryCount: stateAfter.inventory.length,
      });

      runPatch.status = stateAfter.isVictory ? GameRunStatus.COMPLETED : GameRunStatus.FAILED;
      runPatch.endedAt = new Date();
      runPatch.finalScore = score;
      runPatch.finalSanity = stateAfter.sanity;
      runPatch.isVictory = stateAfter.isVictory;
      runPatch.activeKey = null;

      await tx.runResult.upsert({
        where: { runId },
        update: {
          score,
          isVictory: stateAfter.isVictory,
          turns: stateAfter.turnCount,
          finalSanity: stateAfter.sanity,
          completedAt: new Date(),
        },
        create: {
          runId,
          userId: run.userId,
          score,
          isVictory: stateAfter.isVictory,
          turns: stateAfter.turnCount,
          finalSanity: stateAfter.sanity,
          completedAt: new Date(),
        },
      });
    }

    await tx.gameRun.update({
      where: { id: runId },
      data: runPatch,
    });

    return turn;
  });

  if (stateAfter.isGameOver) {
    await recordRunCompleted(run.userId, new Date());
  }

  const nextRunStatus = stateAfter.isGameOver
    ? stateAfter.isVictory
      ? GameRunStatus.COMPLETED
      : GameRunStatus.FAILED
    : GameRunStatus.ACTIVE;
  const endedAt = stateAfter.isGameOver ? new Date() : null;
  const sanityCrossedCritical =
    stateBefore.sanity > getSanityCriticalThreshold() && stateAfter.sanity <= getSanityCriticalThreshold();

  void publishRunTurnUpdate({
    runId,
    actorType: run.actorType === RunActorType.AGENT ? 'agent' : 'human',
    walletAddress: authUser.walletAddress,
    status: runStatusFromOutcome(nextRunStatus),
    startedAt: run.startedAt,
    endedAt,
    isVictory: stateAfter.isGameOver ? stateAfter.isVictory : null,
    turnNo: stateAfter.turnCount,
    sanity: stateAfter.sanity,
    location: stateAfter.location,
    narrative: stateAfter.narrative,
    choiceText: choice.text,
    choiceType: choice.actionType,
    newEvidenceNames: (ai.new_evidence || []).map((e) => e.name).filter(Boolean),
    sanityCrossedCritical,
  });

  const imageUnlocked = await isWalletAllowedForImages(authUser.walletAddress);

  return {
    turn: createdTurn,
    state: stateAfter,
    imageUnlocked,
  };
};
