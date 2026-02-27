import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_GAME_CONFIG } from '../gameConfig';
import { generateNextTurnServer } from '../lib/server/aiEngine';
import { composeStorySystemInstruction } from '../lib/server/storyPrompt';
import type { Choice, Evidence } from '../types';

type EndingTier = 'perfect' | 'normal' | 'pass' | 'fall' | 'unknown';
type TestStrategy = 'mixed' | 'seal' | 'verify' | 'escape' | 'agent';
type TerminalReason =
  | 'victory_perfect'
  | 'victory_normal'
  | 'victory_pass'
  | 'victory_unknown'
  | 'fall_sanity_depleted'
  | 'fall_rule_chain_break'
  | 'fall_deadline_exhausted'
  | 'fall_unstable_seal'
  | 'fall_rule_conflict'
  | 'fall_route_incomplete'
  | 'timeout'
  | 'error';
type TurnOfferedChoiceRecord = {
  id: string;
  text: string;
  actionType: Choice['actionType'];
};
type TurnReplayRecord = {
  turn: number;
  offeredChoices: TurnOfferedChoiceRecord[];
  offeredChoiceCount: number;
  selectedChoiceId: string;
  selectedChoiceIndex: number;
  choiceText: string;
  choiceType: Choice['actionType'];
  sanityBefore: number;
  sanityDelta: number;
  sanityAfter: number;
  locationBefore: string;
  locationAfter: string;
  rulesBefore: number;
  rulesAfter: number;
  ruleAdds: string[];
  inventoryBefore: number;
  inventoryAfter: number;
  evidenceAdds: string[];
  consumedItemId?: string;
  isGameOver: boolean;
  isVictory: boolean;
  endingSignal: string;
  narrativePreview: string;
};
type SingleGameResult = {
  game: number;
  ending: 'victory' | 'game_over' | 'timeout' | 'error';
  tier: EndingTier;
  terminalReason: TerminalReason;
  turns: number;
  finalSanity: number;
  rulesCount: number;
  inventoryCount: number;
  finalNarrative: string;
  timeline: TurnReplayRecord[];
  error?: string;
};
type AgentMemoryTurn = {
  turn: number;
  choiceType: Choice['actionType'];
  sanityDelta: number;
  ruleAdds: number;
  evidenceAdds: number;
  endingSignal: string;
};
type AgentMemoryActionStat = {
  count: number;
  avgSanityDelta: number;
  avgRuleAdds: number;
  avgEvidenceAdds: number;
};
type AgentMemorySnapshot = {
  recentTurns: AgentMemoryTurn[];
  trailingChoiceType: Choice['actionType'] | 'none';
  trailingSameChoiceCount: number;
  actionStats: Record<Choice['actionType'], AgentMemoryActionStat>;
  recommendation: {
    avoidRisky: boolean;
    avoidRepeatChoiceType: Choice['actionType'] | null;
    preferredChoiceTypes: Choice['actionType'][];
    reasons: string[];
  };
};

const SPECIAL_RULE_DROP_KEYWORDS = ['完整守则', '整页守则', '规则汇编', '值班手册', '患者守则原件', '公告栏整版'];

const TOTAL_GAMES = Number.parseInt(process.env.TEST_GAMES || '30', 10);
const MAX_TURNS = Number.parseInt(process.env.TEST_MAX_TURNS || '15', 10);
const TURN_TIMEOUT_MS = Number.parseInt(process.env.TEST_TURN_TIMEOUT_MS || '180000', 10);
const TEST_STRATEGY = ((process.env.TEST_STRATEGY || 'mixed').trim().toLowerCase() as TestStrategy);
const PROVIDER = 'openai' as const;
const BASE_URL = (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1/chat/completions')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/chat\/completions$/, '');
const MODEL = (process.env.NVIDIA_MODEL || 'z-ai/glm4.7').trim();
const AGENT_MODEL = (process.env.TEST_AGENT_MODEL || MODEL).trim();
const AGENT_DECISION_TIMEOUT_MS = Number.parseInt(
  process.env.TEST_AGENT_TIMEOUT_MS || String(Math.min(120000, TURN_TIMEOUT_MS)),
  10,
);
const AGENT_TEMPERATURE = Number.parseFloat(process.env.TEST_AGENT_TEMPERATURE || '0.2');
const AGENT_HISTORY_TURNS = Number.parseInt(process.env.TEST_AGENT_HISTORY_TURNS || '4', 10);
const AGENT_MEMORY_TURNS = Number.parseInt(process.env.TEST_AGENT_MEMORY_TURNS || '8', 10);
const AGENT_GUARD_MIN_RISKY_COUNT = Number.parseInt(process.env.TEST_AGENT_GUARD_MIN_RISKY_COUNT || '2', 10);
const AGENT_GUARD_RISKY_DELTA_FLOOR = Number.parseInt(process.env.TEST_AGENT_GUARD_RISKY_DELTA_FLOOR || '-8', 10);
const API_KEY = (process.env.NVIDIA_API_KEY || '').trim();
const RUN_TOKEN = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const OUTPUT_DIR = (process.env.TEST_OUTPUT_DIR || '').trim() || path.join('tmp', `backtest-report-${RUN_TOKEN}-${process.pid}`);
const NARRATIVE_PREVIEW_MAX = 140;

if (!API_KEY) {
  throw new Error('Missing NVIDIA_API_KEY');
}

const normalizeInlineText = (text: string): string => {
  return (text || '').replace(/\s+/g, ' ').trim();
};

const buildNarrativePreview = (text: string, maxLen = NARRATIVE_PREVIEW_MAX): string => {
  const normalized = normalizeInlineText(text);
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen)}...`;
};

const normalizeOpenAIBaseUrl = (url: string): string => {
  let clean = url.replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) {
    clean = clean.slice(0, -'/chat/completions'.length);
  }
  if (!/\/v\d+$/.test(clean)) {
    clean += '/v1';
  }
  return clean;
};

const extractEndingSignal = (narrative: string): string => {
  const normalized = normalizeInlineText(narrative);
  const marker = normalized.match(/结局判定[:：]\s*([^<>\n]+)/);
  if (marker?.[1]) {
    return marker[1].trim();
  }
  if (normalized.includes('完美结局')) return '完美结局';
  if (normalized.includes('普通结局')) return '普通结局';
  if (normalized.includes('及格结局')) return '及格结局';
  if (normalized.includes('堕入结局')) return '堕入结局';
  return '';
};

const inferTerminalReason = (params: {
  ending: 'victory' | 'game_over' | 'timeout' | 'error';
  tier: EndingTier;
  finalSanity: number;
  narrative: string;
}): TerminalReason => {
  const { ending, tier, finalSanity, narrative } = params;
  const text = normalizeInlineText(narrative);

  if (ending === 'error') return 'error';
  if (ending === 'timeout') return 'timeout';
  if (ending === 'victory') {
    if (tier === 'perfect') return 'victory_perfect';
    if (tier === 'normal') return 'victory_normal';
    if (tier === 'pass') return 'victory_pass';
    return 'victory_unknown';
  }

  if (finalSanity <= 0) return 'fall_sanity_depleted';
  if (text.includes('终局原因：校验链断裂')) return 'fall_rule_chain_break';
  if (text.includes('终局原因：终章窗口耗尽') || text.includes('终章缓冲回合已耗尽')) return 'fall_deadline_exhausted';
  if (text.includes('终局原因：封印稳定度不足')) return 'fall_unstable_seal';
  if (text.includes('终局原因：你触发了高危规则冲突')) return 'fall_rule_conflict';
  return 'fall_route_incomplete';
};

const INITIAL_STATE = {
  sanity: 100,
  location: '崇山医院 - 大厅',
  narrative: '你在一阵刺鼻的消毒水味中醒来。',
  rules: ['不要直视东楼的护士。', '熄灯后，不论听到什么声音，绝对不要回头。'],
  inventory: [
    {
      id: 'init_1',
      name: '皱巴巴的挂号单',
      description: "上面印着今天的日期，背面写着潦草的字迹：'别相信穿红衣服的人'。",
      type: 'document' as const,
    },
  ],
  choices: [
    { id: '1', text: '查看四周', actionType: 'investigate' as const },
    { id: '2', text: '走向护士站', actionType: 'move' as const },
    { id: '3', text: '检查挂号单', actionType: 'item' as const },
  ],
};

const VERIFY_HINTS = ['验证', '核对', '比对', '复查', '对照', '校验', '排查'];
const SEAL_HINTS = ['封印', '裂缝', '核心', '地下二层', '下潜', '祭坛'];
const ESCAPE_HINTS = ['出口', '屋顶', '撤离', '逃离', '离开'];
const VERIFY_ROUTE_HINTS = ['赵医生', '核验', '执行结果', '交叉验证'];
const DEEP_ZONE_HINTS = ['东楼', '地下', '档案', '封锁', '禁闭', '裂缝', '封印室', '地下二层'];
const PLOT_ITEM_HINTS = ['病历', '档案', '录音', '工牌', '徽章', '封印', '阵列', '蓝衣', '赵医生', '裂缝', '守则原件', '钥匙'];

const findChoiceByKeywords = (choices: Choice[], keywords: string[]): Choice | null => {
  const hit = choices.find((choice) => keywords.some((kw) => choice.text.includes(kw)));
  return hit || null;
};

const extractLikelyJsonBlock = (text: string): string => {
  const trimmed = (text || '').trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
};

const parseJsonLoose = (text: string): Record<string, unknown> | null => {
  const candidate = extractLikelyJsonBlock(text);
  if (!candidate) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const mean = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const parseChoiceRecordsFromHistory = (history: string[]): Array<{ text: string; actionType: Choice['actionType'] }> => {
  return history
    .map((line) => {
      const match = line.match(/Choice Made:\s*([\s\S]*?)\s*\((move|investigate|item|risky)\)\s*$/);
      if (!match) {
        return null;
      }
      const text = match[1]?.trim() || '';
      const actionType = match[2] as Choice['actionType'];
      return { text, actionType };
    })
    .filter((record): record is { text: string; actionType: Choice['actionType'] } => !!record);
};

const parseNarrativeProgressHint = (narrative: string): {
  verifyCurrent: number;
  verifyTarget: number;
  plotCurrent: number;
  plotTarget: number;
  deepCurrent: number;
  deepTarget: number;
  sealStability: number;
  threatClock: number;
} | null => {
  const normalized = normalizeInlineText(narrative || '');
  const match = normalized.match(
    /【阶段校验】核验:(-?\d+)\/(\d+)\s*\|\s*物证:(-?\d+)\/(\d+)\s*\|\s*深区:(-?\d+)\/(\d+)\s*\|\s*封印稳定:(-?\d+)\s*\|\s*威胁:(-?\d+)\/6/,
  );
  if (!match) {
    return null;
  }

  return {
    verifyCurrent: Number.parseInt(match[1], 10),
    verifyTarget: Number.parseInt(match[2], 10),
    plotCurrent: Number.parseInt(match[3], 10),
    plotTarget: Number.parseInt(match[4], 10),
    deepCurrent: Number.parseInt(match[5], 10),
    deepTarget: Number.parseInt(match[6], 10),
    sealStability: Number.parseInt(match[7], 10),
    threatClock: Number.parseInt(match[8], 10),
  };
};

const looksLikePlotItem = (item: Evidence): boolean => {
  if (!item || item.id === 'init_1') {
    return false;
  }
  if (item.type === 'key') {
    return true;
  }
  if (item.type !== 'document' && item.type !== 'item') {
    return false;
  }
  const text = `${item.name} ${item.description}`;
  return PLOT_ITEM_HINTS.some((kw) => text.includes(kw));
};

const computeAgentProgressFeedback = (params: {
  turn: number;
  sanity: number;
  history: string[];
  narrative: string;
  inventory: Evidence[];
}): {
  progressScore: number;
  verifyActions: { current: number; target: number; missing: number };
  recentVerifyActions: { current: number; target: number; missing: number };
  plotItems: { current: number; target: number; missing: number };
  deepZone: { current: number; target: number; missing: number };
  sealStabilityEstimate: number;
  threatClockEstimate: number;
  missingGoals: string[];
} => {
  const records = parseChoiceRecordsFromHistory(params.history);
  const actionTypes = records.map((record) => record.actionType);
  const riskyCount = actionTypes.filter((type) => type === 'risky').length;
  let trailingRisky = 0;
  for (let i = actionTypes.length - 1; i >= 0; i -= 1) {
    if (actionTypes[i] !== 'risky') {
      break;
    }
    trailingRisky += 1;
  }

  const verifyActionsFromHistory = records.filter((record) =>
    VERIFY_HINTS.some((kw) => record.text.includes(kw)) && (record.actionType === 'investigate' || record.actionType === 'item'),
  ).length;
  const recentVerifyActions = records.slice(-4).filter((record) => VERIFY_HINTS.some((kw) => record.text.includes(kw))).length;
  const deepZoneHits = params.history.filter((line) => DEEP_ZONE_HINTS.some((kw) => line.includes(kw))).length
    + (DEEP_ZONE_HINTS.some((kw) => (params.narrative || '').includes(kw)) ? 1 : 0);
  const deepZoneProgress = clamp(Math.floor(deepZoneHits / 2), 0, 3);
  const plotItemCount = params.inventory.filter((item) => looksLikePlotItem(item)).length;
  const verifyBand = verifyActionsFromHistory >= 5 ? 3 : verifyActionsFromHistory >= 3 ? 2 : verifyActionsFromHistory >= 1 ? 1 : 0;
  const sanityPressure = params.sanity <= 50 ? (params.sanity <= 30 ? 2 : 1) : 0;
  const riskyRatio = actionTypes.length ? riskyCount / actionTypes.length : 0;
  const threatClockEstimate = clamp(
    Math.floor((params.turn + 1) / 3) + trailingRisky + Math.floor(riskyRatio * 2) + sanityPressure - verifyBand,
    0,
    6,
  );
  const sealStabilityEstimate = clamp((verifyBand * 2) + deepZoneProgress + Math.min(plotItemCount, 3) - threatClockEstimate, -3, 6);

  // Align to in-narrative checkpoint if the model emitted explicit progress lines.
  const narrativeProgress = parseNarrativeProgressHint(params.narrative || '');
  const verifyCurrent = narrativeProgress?.verifyCurrent ?? verifyActionsFromHistory;
  const verifyTarget = narrativeProgress?.verifyTarget ?? 5;
  const plotCurrent = narrativeProgress?.plotCurrent ?? plotItemCount;
  const plotTarget = narrativeProgress?.plotTarget ?? 5;
  const deepCurrent = narrativeProgress?.deepCurrent ?? deepZoneProgress;
  const deepTarget = narrativeProgress?.deepTarget ?? 3;
  const sealCurrent = narrativeProgress?.sealStability ?? sealStabilityEstimate;
  const threatCurrent = narrativeProgress?.threatClock ?? threatClockEstimate;

  const verifyMissing = Math.max(0, verifyTarget - verifyCurrent);
  const recentMissing = Math.max(0, 2 - recentVerifyActions);
  const plotMissing = Math.max(0, plotTarget - plotCurrent);
  const deepMissing = Math.max(0, deepTarget - deepCurrent);
  const missingGoals: string[] = [];
  if (verifyMissing > 0) missingGoals.push(`补${verifyMissing}次核验动作`);
  if (recentMissing > 0) missingGoals.push(`近4回合再做${recentMissing}次核验`);
  if (plotMissing > 0) missingGoals.push(`补${plotMissing}件关键物证`);
  if (deepMissing > 0) missingGoals.push(`推进深区${deepMissing}级`);
  if (sealCurrent <= 0) missingGoals.push('提升封印稳定度至正值');
  if (threatCurrent >= 4) missingGoals.push('降低威胁时钟到3以下');

  const verifyScore = clamp(verifyCurrent / Math.max(1, verifyTarget), 0, 1);
  const plotScore = clamp(plotCurrent / Math.max(1, plotTarget), 0, 1);
  const deepScore = clamp(deepCurrent / Math.max(1, deepTarget), 0, 1);
  const recentScore = clamp(recentVerifyActions / 2, 0, 1);
  const sealScore = clamp((sealCurrent + 3) / 6, 0, 1);
  const threatScore = clamp(1 - (threatCurrent / 6), 0, 1);
  const progressScore = Math.round((verifyScore * 30) + (recentScore * 10) + (plotScore * 25) + (deepScore * 15) + (sealScore * 10) + (threatScore * 10));

  return {
    progressScore,
    verifyActions: { current: verifyCurrent, target: verifyTarget, missing: verifyMissing },
    recentVerifyActions: { current: recentVerifyActions, target: 2, missing: recentMissing },
    plotItems: { current: plotCurrent, target: plotTarget, missing: plotMissing },
    deepZone: { current: deepCurrent, target: deepTarget, missing: deepMissing },
    sealStabilityEstimate: sealCurrent,
    threatClockEstimate: threatCurrent,
    missingGoals,
  };
};

const buildAgentMemorySnapshot = (params: {
  timeline: TurnReplayRecord[];
  sanity: number;
  narrative: string;
}): AgentMemorySnapshot => {
  const recentTurns = params.timeline
    .slice(-Math.max(1, AGENT_MEMORY_TURNS))
    .map((turn) => ({
      turn: turn.turn,
      choiceType: turn.choiceType,
      sanityDelta: turn.sanityDelta,
      ruleAdds: Array.isArray(turn.ruleAdds) ? turn.ruleAdds.length : 0,
      evidenceAdds: Array.isArray(turn.evidenceAdds) ? turn.evidenceAdds.length : 0,
      endingSignal: turn.endingSignal || '',
    }));

  const actionTypes: Choice['actionType'][] = ['move', 'investigate', 'item', 'risky'];
  const actionStats = actionTypes.reduce<Record<Choice['actionType'], AgentMemoryActionStat>>((acc, type) => {
    const hits = recentTurns.filter((turn) => turn.choiceType === type);
    acc[type] = {
      count: hits.length,
      avgSanityDelta: Number(mean(hits.map((turn) => turn.sanityDelta)).toFixed(2)),
      avgRuleAdds: Number(mean(hits.map((turn) => turn.ruleAdds)).toFixed(2)),
      avgEvidenceAdds: Number(mean(hits.map((turn) => turn.evidenceAdds)).toFixed(2)),
    };
    return acc;
  }, {
    move: { count: 0, avgSanityDelta: 0, avgRuleAdds: 0, avgEvidenceAdds: 0 },
    investigate: { count: 0, avgSanityDelta: 0, avgRuleAdds: 0, avgEvidenceAdds: 0 },
    item: { count: 0, avgSanityDelta: 0, avgRuleAdds: 0, avgEvidenceAdds: 0 },
    risky: { count: 0, avgSanityDelta: 0, avgRuleAdds: 0, avgEvidenceAdds: 0 },
  });

  let trailingChoiceType: Choice['actionType'] | 'none' = 'none';
  let trailingSameChoiceCount = 0;
  for (let i = recentTurns.length - 1; i >= 0; i -= 1) {
    const currentType = recentTurns[i].choiceType;
    if (trailingChoiceType === 'none') {
      trailingChoiceType = currentType;
      trailingSameChoiceCount = 1;
      continue;
    }
    if (currentType !== trailingChoiceType) {
      break;
    }
    trailingSameChoiceCount += 1;
  }

  const riskyStat = actionStats.risky;
  const progressHint = parseNarrativeProgressHint(params.narrative);
  const threatClock = progressHint?.threatClock ?? 0;
  const sealStability = progressHint?.sealStability ?? 0;
  const reasons: string[] = [];
  const preferredChoiceTypes: Choice['actionType'][] = [];
  const riskyLowReturn = riskyStat.count >= AGENT_GUARD_MIN_RISKY_COUNT
    && riskyStat.avgSanityDelta <= AGENT_GUARD_RISKY_DELTA_FLOOR
    && (riskyStat.avgRuleAdds + riskyStat.avgEvidenceAdds) <= 1;
  if (riskyLowReturn) {
    reasons.push('近期risky收益低且理智代价高');
  }
  if (threatClock >= 4) {
    reasons.push('威胁时钟偏高');
    preferredChoiceTypes.push('investigate');
    preferredChoiceTypes.push('item');
  }
  if (sealStability <= 0) {
    reasons.push('封印稳定度未转正');
    if (!preferredChoiceTypes.includes('investigate')) {
      preferredChoiceTypes.push('investigate');
    }
  }
  if (params.sanity <= 30) {
    reasons.push('理智偏低');
    if (!preferredChoiceTypes.includes('move')) {
      preferredChoiceTypes.push('move');
    }
    if (!preferredChoiceTypes.includes('item')) {
      preferredChoiceTypes.push('item');
    }
  }

  let avoidRepeatChoiceType: Choice['actionType'] | null = null;
  if (trailingChoiceType !== 'none' && trailingSameChoiceCount >= 3) {
    const stat = actionStats[trailingChoiceType];
    const lowGain = (stat.avgRuleAdds + stat.avgEvidenceAdds) <= 0.5;
    const costly = stat.avgSanityDelta <= -2;
    if (lowGain && costly) {
      avoidRepeatChoiceType = trailingChoiceType;
      reasons.push(`连续${trailingSameChoiceCount}次${trailingChoiceType}且收益偏低`);
    }
  }

  return {
    recentTurns,
    trailingChoiceType,
    trailingSameChoiceCount,
    actionStats,
    recommendation: {
      avoidRisky: riskyLowReturn || threatClock >= 5,
      avoidRepeatChoiceType,
      preferredChoiceTypes,
      reasons,
    },
  };
};

const pickChoiceByActionTypePriority = (
  choices: Choice[],
  actionTypes: Choice['actionType'][],
  avoidType?: Choice['actionType'] | null,
): Choice | null => {
  for (const type of actionTypes) {
    const hit = choices.find((choice) => choice.actionType === type && choice.actionType !== avoidType);
    if (hit) {
      return hit;
    }
  }
  return null;
};

const applyAgentMemoryGuard = (params: {
  selected: Choice;
  choices: Choice[];
  memory: AgentMemorySnapshot;
}): Choice => {
  const { selected, choices, memory } = params;

  if (memory.recommendation.avoidRisky && selected.actionType === 'risky') {
    const replacement = findChoiceByKeywords(choices, VERIFY_HINTS)
      || pickChoiceByActionTypePriority(
        choices,
        memory.recommendation.preferredChoiceTypes.length
          ? memory.recommendation.preferredChoiceTypes
          : ['investigate', 'item', 'move'],
      )
      || pickChoiceByActionTypePriority(choices, ['investigate', 'item', 'move']);
    if (replacement && replacement.id !== selected.id) {
      console.warn(
        `[agent-guard] reroute risky -> ${replacement.actionType} | reasons=${memory.recommendation.reasons.join(';') || 'n/a'}`,
      );
      return replacement;
    }
  }

  const avoidType = memory.recommendation.avoidRepeatChoiceType;
  if (avoidType && selected.actionType === avoidType) {
    const replacement = findChoiceByKeywords(choices, VERIFY_HINTS)
      || pickChoiceByActionTypePriority(choices, ['investigate', 'item', 'move', 'risky'], avoidType);
    if (replacement && replacement.id !== selected.id) {
      console.warn(`[agent-guard] break repetitive ${avoidType} -> ${replacement.actionType}`);
      return replacement;
    }
  }

  return selected;
};

const requestAgentChoice = async (params: {
  turn: number;
  sanity: number;
  location: string;
  rules: string[];
  inventory: Evidence[];
  narrative: string;
  history: string[];
  timeline: TurnReplayRecord[];
  choices: Choice[];
}): Promise<string> => {
  const cleanBaseUrl = normalizeOpenAIBaseUrl(BASE_URL);
  const progressFeedback = computeAgentProgressFeedback({
    turn: params.turn,
    sanity: params.sanity,
    history: params.history,
    narrative: params.narrative,
    inventory: params.inventory,
  });
  const memorySnapshot = buildAgentMemorySnapshot({
    timeline: params.timeline,
    sanity: params.sanity,
    narrative: params.narrative,
  });
  const payload = {
    turn: params.turn + 1,
    maxTurns: MAX_TURNS,
    validChoiceIds: params.choices.map((choice) => choice.id),
    sanity: params.sanity,
    location: params.location,
    latestNarrative: buildNarrativePreview(params.narrative, 140),
    recentHistory: params.history.slice(-Math.max(1, AGENT_HISTORY_TURNS)),
    activeRules: params.rules.slice(-6),
    progressFeedback,
    memory: memorySnapshot,
    inventory: params.inventory.slice(-6).map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
    })),
    choices: params.choices.map((choice, index) => ({
      index: index + 1,
      id: choice.id,
      text: choice.text,
      actionType: choice.actionType,
    })),
  };

  const response = await fetch(`${cleanBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: AGENT_MODEL,
      temperature: Number.isFinite(AGENT_TEMPERATURE) ? AGENT_TEMPERATURE : 0.2,
      max_tokens: 80,
      messages: [
        {
          role: 'system',
          content:
            '你是《崇山医院》回测代理。请在 validChoiceIds 中选择一个最优动作 ID，以最大化胜率并避免 route_incomplete。若 progressFeedback.missingGoals 非空，优先选择能补齐缺口的动作；若 threatClockEstimate>=4，优先降低威胁。你必须阅读 memory.recommendation：当 avoidRisky=true 时不要选 risky；当 avoidRepeatChoiceType 非空时避免继续重复该类型。输出要求：只输出一个真实 ID（例如 2），不要输出解释、JSON、模板或占位符。',
        },
        {
          role: 'user',
          content: `仅依据以下上下文决策，不要编造新选项：\n${JSON.stringify(payload)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Agent chooser API error: ${response.status} - ${errText}`);
  }
  const data = await response.json();
  const message = data?.choices?.[0]?.message || {};
  const content = message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((item: any) => (typeof item?.text === 'string' ? item.text : '')).join('').trim()
      : '';
  if (!text || typeof text !== 'string') {
    const reasoning = typeof message?.reasoning_content === 'string' ? message.reasoning_content : '';
    if (reasoning.trim()) {
      return reasoning;
    }
    throw new Error('Agent chooser returned empty content');
  }
  return text;
};

const resolveAgentChoice = (choices: Choice[], rawText: string): Choice | null => {
  const normalizedRaw = normalizeInlineText(rawText);
  if (normalizedRaw) {
    const exact = choices.find((choice) => normalizedRaw === choice.id || normalizedRaw === `"${choice.id}"`);
    if (exact) {
      return exact;
    }
    const sortedChoices = [...choices].sort((a, b) => b.id.length - a.id.length);
    for (const choice of sortedChoices) {
      const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(choice.id)}([^A-Za-z0-9_-]|$)`);
      if (pattern.test(normalizedRaw)) {
        return choice;
      }
    }
  }

  const parsed = parseJsonLoose(rawText);
  if (!parsed) {
    return null;
  }

  const readTextField = (...keys: string[]): string => {
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  };
  const readNumberField = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim()) {
        const n = Number.parseInt(value.trim(), 10);
        if (Number.isFinite(n)) {
          return n;
        }
      }
    }
    return null;
  };

  const choiceId = readTextField('choiceId', 'choice_id', 'optionId', 'option_id', 'id');
  if (choiceId) {
    const exact = choices.find((choice) => choice.id === choiceId);
    if (exact) {
      return exact;
    }
  }

  const choiceIndex = readNumberField('choiceIndex', 'choice_index', 'index', 'optionIndex', 'option_index');
  if (choiceIndex !== null) {
    const oneBasedIndex = choiceIndex - 1;
    if (oneBasedIndex >= 0 && oneBasedIndex < choices.length) {
      return choices[oneBasedIndex];
    }
    if (choiceIndex >= 0 && choiceIndex < choices.length) {
      return choices[choiceIndex];
    }
  }

  const choiceText = readTextField('choiceText', 'choice_text', 'text', 'optionText', 'option_text');
  if (choiceText) {
    const directTextHit = choices.find((choice) => choice.text === choiceText);
    if (directTextHit) {
      return directTextHit;
    }
    const fuzzyHit = choices.find((choice) => choice.text.includes(choiceText) || choiceText.includes(choice.text));
    if (fuzzyHit) {
      return fuzzyHit;
    }
  }

  return null;
};

const pickChoiceByMixedStrategy = (choices: Choice[]): Choice => {
  if (!choices.length) {
    return { id: 'fallback', text: '原地观察', actionType: 'investigate' };
  }

  const risky = choices.filter((c) => c.actionType === 'risky');
  const investigate = choices.filter((c) => c.actionType === 'investigate');
  const safe = choices.filter((c) => c.actionType === 'move' || c.actionType === 'item');
  const roll = Math.random();

  if (roll < 0.35 && risky.length) {
    return risky[Math.floor(Math.random() * risky.length)];
  }
  if (roll < 0.75 && investigate.length) {
    return investigate[Math.floor(Math.random() * investigate.length)];
  }
  if (safe.length) {
    return safe[Math.floor(Math.random() * safe.length)];
  }
  return choices[Math.floor(Math.random() * choices.length)];
};

const pickChoiceByAgentStrategy = async (params: {
  choices: Choice[];
  turn: number;
  sanity: number;
  location: string;
  rules: string[];
  inventory: Evidence[];
  narrative: string;
  history: string[];
  timeline: TurnReplayRecord[];
}): Promise<Choice> => {
  const { choices } = params;
  if (!choices.length) {
    return { id: 'fallback', text: '原地观察', actionType: 'investigate' };
  }
  try {
    const rawText = await withTimeout(requestAgentChoice(params), AGENT_DECISION_TIMEOUT_MS);
    const resolved = resolveAgentChoice(choices, rawText);
    if (resolved) {
      const memorySnapshot = buildAgentMemorySnapshot({
        timeline: params.timeline,
        sanity: params.sanity,
        narrative: params.narrative,
      });
      return applyAgentMemoryGuard({
        selected: resolved,
        choices,
        memory: memorySnapshot,
      });
    }
    console.warn(`[agent-chooser] invalid choice output: ${buildNarrativePreview(rawText, 180)}`);
  } catch (error: any) {
    console.warn(`[agent-chooser] fallback to mixed: ${error?.message || 'unknown error'}`);
  }
  return pickChoiceByMixedStrategy(choices);
};

const pickChoiceByStrategy = async (params: {
  choices: Choice[];
  turn: number;
  sanity: number;
  location: string;
  rules: string[];
  inventory: Evidence[];
  narrative: string;
  history: string[];
  timeline: TurnReplayRecord[];
}): Promise<Choice> => {
  const { choices, turn } = params;
  if (TEST_STRATEGY === 'agent') {
    return pickChoiceByAgentStrategy(params);
  }

  if (TEST_STRATEGY === 'mixed') {
    return pickChoiceByMixedStrategy(choices);
  }

  if (!choices.length) {
    return { id: 'fallback', text: '原地观察', actionType: 'investigate' };
  }

  const isEndgame = turn >= MAX_TURNS - 2;
  if (isEndgame) {
    if (TEST_STRATEGY === 'seal') {
      return findChoiceByKeywords(choices, SEAL_HINTS)
        || findChoiceByKeywords(choices, VERIFY_HINTS)
        || pickChoiceByMixedStrategy(choices);
    }
    if (TEST_STRATEGY === 'verify') {
      return findChoiceByKeywords(choices, VERIFY_ROUTE_HINTS)
        || findChoiceByKeywords(choices, VERIFY_HINTS)
        || pickChoiceByMixedStrategy(choices);
    }
    if (TEST_STRATEGY === 'escape') {
      return findChoiceByKeywords(choices, ESCAPE_HINTS)
        || findChoiceByKeywords(choices, VERIFY_HINTS)
        || pickChoiceByMixedStrategy(choices);
    }
  }

  return findChoiceByKeywords(choices, VERIFY_HINTS)
    || pickChoiceByMixedStrategy(choices);
};

const capIncomingRules = (choice: Choice, narrative: string, incoming: string[]): string[] => {
  const isSpecialRuleDrop = (choice.actionType === 'investigate' || choice.actionType === 'item')
    && SPECIAL_RULE_DROP_KEYWORDS.some((kw) => narrative.includes(kw));
  return isSpecialRuleDrop ? incoming.slice(0, 2) : incoming.slice(0, 1);
};

const inferEndingTier = (narrative: string, isVictory: boolean): EndingTier => {
  if (!narrative) {
    return isVictory ? 'unknown' : 'fall';
  }
  if (narrative.includes('完美结局')) return 'perfect';
  if (narrative.includes('普通结局')) return 'normal';
  if (narrative.includes('及格结局')) return 'pass';
  if (narrative.includes('堕入结局')) return 'fall';
  return isVictory ? 'unknown' : 'fall';
};

const withTimeout = async <T>(work: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Turn timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const resolveStoryInstructionOverride = async (): Promise<string | undefined> => {
  const db = new PrismaClient();
  try {
    const story = await db.story.findFirst({
      where: { slug: 'chongshan-hospital' },
      select: { publishedVersionId: true },
    });
    if (!story?.publishedVersionId) {
      return undefined;
    }

    const version = await db.storyVersion.findUnique({
      where: { id: story.publishedVersionId },
      select: { instructionTemplateRaw: true },
    });
    const templateRaw = version?.instructionTemplateRaw?.trim();
    if (!templateRaw) {
      return undefined;
    }

    return composeStorySystemInstruction({
      templateRaw,
      gameConfig: { ...DEFAULT_GAME_CONFIG, maxTurns: MAX_TURNS },
      outputLocale: 'zh-CN',
    });
  } catch {
    return undefined;
  } finally {
    await db.$disconnect();
  }
};

const runSingleGame = async (gameNo: number, systemInstructionOverride?: string) => {
  let sanity = INITIAL_STATE.sanity;
  let location = INITIAL_STATE.location;
  let narrative = INITIAL_STATE.narrative;
  let rules = [...INITIAL_STATE.rules];
  let inventory: Evidence[] = [...INITIAL_STATE.inventory];
  let choices: Choice[] = [...INITIAL_STATE.choices];
  let turn = 0;
  let isGameOver = false;
  let isVictory = false;
  const history: string[] = [];
  const timeline: TurnReplayRecord[] = [];

  while (!isGameOver && turn < MAX_TURNS + 3) {
    const sanityBefore = sanity;
    const locationBefore = location;
    const rulesBefore = rules.length;
    const inventoryBefore = inventory.length;
    const offeredChoices: TurnOfferedChoiceRecord[] = choices.map((option) => ({
      id: option.id,
      text: option.text,
      actionType: option.actionType,
    }));
    const choice = await pickChoiceByStrategy({
      choices,
      turn,
      sanity,
      location,
      rules,
      inventory,
      narrative,
      history,
      timeline,
    });
    const selectedChoiceIndex = offeredChoices.findIndex((option) => option.id === choice.id);
    const selectedChoiceFallbackIndex = selectedChoiceIndex >= 0
      ? selectedChoiceIndex
      : offeredChoices.findIndex((option) => option.text === choice.text && option.actionType === choice.actionType);
    const selectedChoiceSafeIndex = selectedChoiceFallbackIndex >= 0 ? selectedChoiceFallbackIndex : -1;
    history.push(`Turn ${turn}: Location: ${location}. Choice Made: ${choice.text} (${choice.actionType})`);
    console.log(`[G${gameNo}] turn=${turn} choiceType=${choice.actionType}`);
    const response = await withTimeout(
      generateNextTurnServer({
        history,
        currentAction: choice.text,
        currentRules: rules,
        apiKey: API_KEY,
        baseUrl: BASE_URL,
        provider: PROVIDER,
        model: MODEL,
        currentSanity: sanity,
        inventory,
        gameConfig: { ...DEFAULT_GAME_CONFIG, maxTurns: MAX_TURNS },
        systemInstructionOverride,
        labMode: true,
        outputLocale: 'zh-CN',
        storyTitle: '崇山医院',
        storySlug: 'chongshan-hospital',
      }),
      TURN_TIMEOUT_MS,
    );

    const incomingRules = capIncomingRules(choice, response.narrative || '', response.new_rules || []);
    const uniqueIncomingRules = incomingRules.filter((rule) => !rules.includes(rule));
    rules = [...rules, ...uniqueIncomingRules];

    const incomingEvidence = response.new_evidence || [];
    const evidenceAdds = incomingEvidence.map((item) => `${item.type}:${item.name}`);
    inventory = [...inventory, ...incomingEvidence];
    const consumedItemId = response.consumed_item_id;
    if (response.consumed_item_id) {
      inventory = inventory.filter((item) => item.id !== response.consumed_item_id);
    }

    const sanityDelta = Number(response.sanity_change) || 0;
    sanity = Math.max(0, Math.min(100, sanity + sanityDelta));
    location = response.location_name || location;
    narrative = response.narrative || narrative;
    choices = Array.isArray(response.choices) && response.choices.length
      ? response.choices
      : [{ id: 'fallback', text: '原地观察', actionType: 'investigate' }];

    isVictory = !!response.is_victory;
    isGameOver = sanity <= 0 || !!response.is_game_over;

    timeline.push({
      turn,
      offeredChoices,
      offeredChoiceCount: offeredChoices.length,
      selectedChoiceId: choice.id,
      selectedChoiceIndex: selectedChoiceSafeIndex,
      choiceText: choice.text,
      choiceType: choice.actionType,
      sanityBefore,
      sanityDelta,
      sanityAfter: sanity,
      locationBefore,
      locationAfter: location,
      rulesBefore,
      rulesAfter: rules.length,
      ruleAdds: uniqueIncomingRules,
      inventoryBefore,
      inventoryAfter: inventory.length,
      evidenceAdds,
      consumedItemId,
      isGameOver,
      isVictory,
      endingSignal: extractEndingSignal(response.narrative || ''),
      narrativePreview: buildNarrativePreview(response.narrative || ''),
    });
    turn += 1;
  }

  const ending: SingleGameResult['ending'] = isVictory ? 'victory' : isGameOver ? 'game_over' : 'timeout';
  const tier = inferEndingTier(narrative, isVictory);
  const terminalReason = inferTerminalReason({
    ending,
    tier,
    finalSanity: sanity,
    narrative,
  });

  return {
    game: gameNo,
    ending,
    tier,
    terminalReason,
    turns: turn,
    finalSanity: sanity,
    rulesCount: rules.length,
    inventoryCount: inventory.length,
    finalNarrative: narrative,
    timeline,
  };
};

const main = async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Backtesting ${TOTAL_GAMES} games | model=${MODEL} | baseUrl=${BASE_URL} | strategy=${TEST_STRATEGY}`);
  if (TEST_STRATEGY === 'agent') {
    console.log(`Agent chooser enabled | model=${AGENT_MODEL} | timeoutMs=${AGENT_DECISION_TIMEOUT_MS}`);
  }
  console.log(`Artifacts output dir: ${OUTPUT_DIR}`);
  const systemInstructionOverride = await resolveStoryInstructionOverride();
  console.log(`Using story instruction override: ${systemInstructionOverride ? 'yes' : 'no'}`);
  const results: SingleGameResult[] = [];
  for (let i = 0; i < TOTAL_GAMES; i += 1) {
    let game: SingleGameResult;
    try {
      game = await runSingleGame(i + 1, systemInstructionOverride);
    } catch (error: any) {
      game = {
        game: i + 1,
        ending: 'error' as const,
        tier: 'fall' as const,
        terminalReason: 'error',
        turns: 0,
        finalSanity: 0,
        rulesCount: 0,
        inventoryCount: 0,
        finalNarrative: '',
        timeline: [],
        error: error?.message || 'Unknown error',
      };
    }
    results.push(game);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `game-${String(game.game).padStart(3, '0')}.json`),
      JSON.stringify(game, null, 2),
      'utf8',
    );
    console.log(
      `Game #${game.game} | ending=${game.ending} | tier=${game.tier} | reason=${game.terminalReason} | turns=${game.turns} | sanity=${game.finalSanity} | rules=${game.rulesCount} | inventory=${game.inventoryCount}${game.error ? ` | error=${game.error}` : ''}`,
    );
  }

  const completed = results.filter((r) => r.ending !== 'error');
  const terminalReasonCounts = results.reduce<Record<string, number>>((acc, item) => {
    acc[item.terminalReason] = (acc[item.terminalReason] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    total: results.length,
    completed: completed.length,
    failed: results.filter((r) => r.ending === 'error').length,
    victory: completed.filter((r) => r.ending === 'victory').length,
    gameOver: completed.filter((r) => r.ending === 'game_over').length,
    timeout: completed.filter((r) => r.ending === 'timeout').length,
    perfect: completed.filter((r) => r.tier === 'perfect').length,
    normal: completed.filter((r) => r.tier === 'normal').length,
    pass: completed.filter((r) => r.tier === 'pass').length,
    fall: completed.filter((r) => r.tier === 'fall').length,
    unknownTier: completed.filter((r) => r.tier === 'unknown').length,
    avgTurns: completed.length ? completed.reduce((sum, r) => sum + r.turns, 0) / completed.length : 0,
    avgFinalSanity: completed.length ? completed.reduce((sum, r) => sum + r.finalSanity, 0) / completed.length : 0,
    terminalReasonCounts,
  };

  const victoryRate = summary.completed ? (summary.victory / summary.completed) * 100 : 0;
  const summaryPayload = {
    generatedAt: new Date().toISOString(),
    outputDir: OUTPUT_DIR,
    config: {
      totalGames: TOTAL_GAMES,
      maxTurns: MAX_TURNS,
      turnTimeoutMs: TURN_TIMEOUT_MS,
      strategy: TEST_STRATEGY,
      agentModel: TEST_STRATEGY === 'agent' ? AGENT_MODEL : null,
      agentDecisionTimeoutMs: TEST_STRATEGY === 'agent' ? AGENT_DECISION_TIMEOUT_MS : null,
      provider: PROVIDER,
      model: MODEL,
      baseUrl: BASE_URL,
      historyMode: 'full',
      storySlug: 'chongshan-hospital',
    },
    summary: {
      ...summary,
      victoryRatePercent: Number(victoryRate.toFixed(2)),
    },
    results: results.map((r) => ({
      game: r.game,
      ending: r.ending,
      tier: r.tier,
      terminalReason: r.terminalReason,
      turns: r.turns,
      finalSanity: r.finalSanity,
      rulesCount: r.rulesCount,
      inventoryCount: r.inventoryCount,
      error: r.error,
      gameFile: `game-${String(r.game).padStart(3, '0')}.json`,
    })),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summaryPayload, null, 2), 'utf8');

  console.log('\n=== Summary ===');
  console.log(JSON.stringify({
    ...summary,
    victoryRatePercent: Number(victoryRate.toFixed(2)),
  }, null, 2));
  console.log(`Summary written: ${path.join(OUTPUT_DIR, 'summary.json')}`);
};

main().catch((error) => {
  console.error('Backtest failed:', error);
  process.exit(1);
});
