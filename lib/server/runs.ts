import { GameRunStatus, RunActorType, UserRole } from '@prisma/client';
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
import { computeRunScore } from './scoring';
import { getRuntimeConfig } from './runtimeConfig';
import { recordRunCompleted, recordRunStarted } from './stats';

const specialRuleDropKeywords = ['完整守则', '整页守则', '规则汇编', '值班手册', '患者守则原件', '公告栏整版'];

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

const initialState = (): PersistedState => cleanState(INITIAL_STATE);

const ensureRunAccessible = async (runId: string, authUser: { id: string; role: UserRole }) => {
  const run = await db.gameRun.findUnique({ where: { id: runId } });
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

const getLastStateFromRun = async (runId: string): Promise<PersistedState> => {
  const lastTurn = await db.gameTurn.findFirst({
    where: { runId },
    orderBy: { turnNo: 'desc' },
  });

  if (!lastTurn) {
    return initialState();
  }

  return lastTurn.stateAfterJson as unknown as PersistedState;
};

const makeSnapshot = async (): Promise<RunSnapshot> => {
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
}) => ({
  runId: run.id,
  status: run.status.toLowerCase(),
  turnNo: run.currentTurnNo,
  startedAt: run.startedAt,
  actorType: run.actorType === RunActorType.AGENT ? 'agent' : 'human',
  isVictory: run.isVictory,
});

export const startOrGetActiveRun = async (
  authUser: { id: string; walletAddress: string },
  actorTypeInput: ActorType,
) => {
  const actorType = parseActorTypeInput(actorTypeInput);
  const active = await db.gameRun.findFirst({
    where: { userId: authUser.id, status: GameRunStatus.ACTIVE },
    orderBy: { startedAt: 'desc' },
  });

  if (active) {
    void syncBoardRunSnapshotFromDb(active.id);
    const state = await getLastStateFromRun(active.id);
    return {
      summary: toRunSummary(active),
      state,
      recovered: true,
    };
  }

  const snapshot = await makeSnapshot();
  const created = await db.gameRun.create({
    data: {
      userId: authUser.id,
      status: GameRunStatus.ACTIVE,
      actorType: actorType === 'agent' ? RunActorType.AGENT : RunActorType.HUMAN,
      currentTurnNo: 0,
      configSnapshotJson: snapshot as any,
      activeKey: authUser.id,
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
    state: initialState(),
    recovered: false,
  };
};

export const getCurrentRun = async (userId: string) => {
  const run = await db.gameRun.findFirst({
    where: { userId, status: GameRunStatus.ACTIVE },
    orderBy: { startedAt: 'desc' },
  });

  if (!run) {
    return null;
  }

  const state = await getLastStateFromRun(run.id);
  return {
    summary: toRunSummary(run),
    state,
  };
};

export const getRunWithState = async (runId: string, authUser: { id: string; role: UserRole }) => {
  const run = await ensureRunAccessible(runId, authUser);
  const state = await getLastStateFromRun(run.id);
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
    ? (turns[turns.length - 1].stateAfterJson as unknown as PersistedState)
    : initialState();

  if (stateBefore.isGameOver) {
    throw new HttpError(400, 'Run is already completed');
  }

  const history = buildHistoryFromTurns(turns);
  const currentHistoryLine = `Turn ${stateBefore.turnCount}: Location: ${stateBefore.location}. Narrative: ${stateBefore.narrative}. Choice Made: ${choice.text} (${choice.actionType})`;

  // Always resolve runtime config at turn time so admin updates take effect immediately.
  const liveConfig = await getRuntimeConfig();
  const snapshot: RunSnapshot = {
    llm: {
      provider: liveConfig.llmProvider,
      baseUrl: liveConfig.llmBaseUrl,
      apiKey: liveConfig.llmApiKey,
      model: liveConfig.llmModel,
    },
    image: {
      provider: liveConfig.imageProvider,
      baseUrl: liveConfig.imageBaseUrl,
      apiKey: liveConfig.imageApiKey,
      model: liveConfig.imageModel,
    },
    gameConfig: liveConfig.gameConfig,
    createdAt: new Date().toISOString(),
  };
  const gameConfig = snapshot.gameConfig as any;

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
