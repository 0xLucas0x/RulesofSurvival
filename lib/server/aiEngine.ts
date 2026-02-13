import { GoogleGenAI, Type } from '@google/genai';
import { buildSystemInstruction } from '../../constants';
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../../gameConfig';
import type { Choice, Evidence, GeminiResponse, StoryEvaluation } from '../../types';

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    narrative: { type: Type.STRING },
    choices: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          text: { type: Type.STRING },
          actionType: { type: Type.STRING, enum: ['move', 'investigate', 'item', 'risky'] },
        },
        required: ['id', 'text', 'actionType'],
      },
    },
    image_prompt_english: { type: Type.STRING },
    sanity_change: { type: Type.NUMBER },
    new_rules: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    new_evidence: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          type: { type: Type.STRING, enum: ['document', 'photo', 'item', 'key'] },
        },
        required: ['id', 'name', 'description', 'type'],
      },
    },
    location_name: { type: Type.STRING },
    is_game_over: { type: Type.BOOLEAN },
    is_victory: { type: Type.BOOLEAN },
    consumed_item_id: { type: Type.STRING },
  },
  required: ['narrative', 'choices', 'image_prompt_english', 'sanity_change', 'location_name', 'is_game_over'],
};

const normalizeOpenAIBaseUrl = (url: string): string => {
  let clean = url.replace(/\/+$/, '');
  // If user pasted a full endpoint URL, strip /chat/completions
  if (clean.endsWith('/chat/completions')) {
    return clean.slice(0, -'/chat/completions'.length);
  }
  // Only append /v1 if no version path (/v1, /v2, /v3, etc.) is already present
  if (!/\/v\d+$/.test(clean)) {
    clean += '/v1';
  }
  return clean;
};

const extractLikelyJsonBlock = (text: string): string => {
  const trimmed = text.trim();
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

const escapeControlCharsInJsonStrings = (text: string): string => {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const code = ch.charCodeAt(0);

    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      if (code < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t' && ch !== ' ') {
        continue;
      }
      out += ch;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }

    if (code < 0x20) {
      if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += `\\u${code.toString(16).padStart(4, '0')}`;
      }
      continue;
    }

    out += ch;
  }

  return out;
};

const parseModelJsonResponse = <T>(rawText: string, context: string): T => {
  const candidate = extractLikelyJsonBlock(rawText);

  try {
    return JSON.parse(candidate) as T;
  } catch (firstError) {
    const repaired = escapeControlCharsInJsonStrings(candidate);
    try {
      return JSON.parse(repaired) as T;
    } catch (secondError: any) {
      const detail = secondError?.message || (firstError as any)?.message || 'Invalid JSON response';
      throw new Error(`${context}: ${detail}`);
    }
  }
};

const storyEvalSchema = {
  type: Type.OBJECT,
  properties: {
    coherence: { type: Type.NUMBER },
    ruleIntegration: { type: Type.NUMBER },
    horrorTension: { type: Type.NUMBER },
    choiceMeaningfulness: { type: Type.NUMBER },
    endingQuality: { type: Type.NUMBER },
    overall: { type: Type.NUMBER },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    summary: { type: Type.STRING },
  },
  required: [
    'coherence',
    'ruleIntegration',
    'horrorTension',
    'choiceMeaningfulness',
    'endingQuality',
    'overall',
    'issues',
    'suggestions',
    'summary',
  ],
};

type GenerateTurnInput = {
  history: string[];
  currentAction: string;
  currentRules: string[];
  apiKey?: string;
  baseUrl?: string;
  provider?: 'gemini' | 'openai';
  model?: string;
  currentSanity?: number;
  inventory?: Evidence[];
  gameConfig?: GameConfig;
  isOvertime?: boolean;
  labMode?: boolean;
};

type ActionType = Choice['actionType'];
type ChoiceRecord = { text: string; actionType: ActionType };

type DifficultyDirectorState = {
  turnNumber: number;
  actionRecords: ChoiceRecord[];
  actionTypes: ActionType[];
  lastActionType: ActionType;
  riskyRatio: number;
  consecutiveRisky: number;
  plotItemCount: number;
  clueItemCount: number;
  strictVerificationActions: number;
  ruleVerificationProgress: number;
  deepZoneProgress: number;
  threatClock: number;
  sealStability: number;
  hasExitIntent: boolean;
  hasRitualIntent: boolean;
  minEndingTurn: number;
  recentVerificationActions: number;
};

type DifficultyDirectorInput = {
  response: GeminiResponse;
  directorState: DifficultyDirectorState;
  turnNumber: number;
  maxTurns: number;
  isOvertime: boolean;
  currentRules: string[];
  inventory: Evidence[];
  currentAction: string;
  currentSanity: number;
  directorMode: 'default' | 'lab';
};

const ACTION_TYPES: ActionType[] = ['move', 'investigate', 'item', 'risky'];
const VERIFY_KEYWORDS = ['验证', '核对', '比对', '复查', '对照', '校验', '确认规则', '排查'];
const EXIT_KEYWORDS = ['天台', '屋顶', '出口', '逃离', '离开', '撤离', '逃生门', '安全通道'];
const RITUAL_KEYWORDS = ['封印', '仪式', '裂缝', '下潜', '地下二层', '锚点', '阵列', '关闭', '重置'];
const ENDING_ACTION_KEYWORDS = [...EXIT_KEYWORDS, ...RITUAL_KEYWORDS, '最终', '决断', '了结'];
const DEEP_ZONE_KEYWORDS = ['东楼', '地下', '档案', '封锁', '禁闭', '裂缝', '封印室', '地下二层'];
const PLOT_ITEM_KEYWORDS = ['病历', '档案', '录音', '工牌', '徽章', '封印', '阵列', '蓝衣', '赵医生', '裂缝', '守则原件'];
const ENDING_GRACE_TURNS = 3;

const textIncludesAny = (text: string, keywords: string[]): boolean => {
  return keywords.some((keyword) => text.includes(keyword));
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const parseChoiceRecordsFromHistory = (history: string[]): ChoiceRecord[] => {
  return history
    .map((line) => {
      const match = line.match(/Choice Made:\s*([\s\S]*?)\s*\((move|investigate|item|risky)\)\s*$/);
      if (!match) {
        return null;
      }
      const text = match[1]?.trim() || '';
      const actionType = match[2] as ActionType;
      if (!ACTION_TYPES.includes(actionType)) {
        return null;
      }
      return { text, actionType };
    })
    .filter((record): record is ChoiceRecord => !!record);
};

const countTrailingAction = (actions: ActionType[], target: ActionType): number => {
  let count = 0;
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    if (actions[i] !== target) {
      break;
    }
    count += 1;
  }
  return count;
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
  return textIncludesAny(text, PLOT_ITEM_KEYWORDS);
};

const ensureChoiceShape = (choices: GeminiResponse['choices'], locationName: string): Choice[] => {
  const raw = Array.isArray(choices) ? choices : [];
  const unique = new Set<string>();
  const normalized: Choice[] = [];

  for (const item of raw) {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!text || unique.has(text)) {
      continue;
    }
    const actionType = ACTION_TYPES.includes(item?.actionType as ActionType)
      ? (item.actionType as ActionType)
      : 'investigate';
    unique.add(text);
    normalized.push({
      id: String(item?.id || normalized.length + 1),
      text,
      actionType,
    });
  }

  const fallbackLocation = locationName || '附近区域';
  if (normalized.length < 3) {
    const fallbackPool: Choice[] = [
      { id: 'f1', text: `沿着${fallbackLocation}边缘移动，避免与异常正面接触`, actionType: 'move' },
      { id: 'f2', text: '对照手头线索，验证当前守则是否被污染', actionType: 'investigate' },
      { id: 'f3', text: '冒险逼近异响源头，尝试抢先切断触发点', actionType: 'risky' },
    ];
    for (const fallback of fallbackPool) {
      if (normalized.length >= 3) {
        break;
      }
      if (!unique.has(fallback.text)) {
        unique.add(fallback.text);
        normalized.push(fallback);
      }
    }
  }

  if (normalized.length > 4) {
    normalized.splice(4);
  }

  if (!normalized.some((choice) => choice.actionType === 'risky')) {
    normalized[normalized.length - 1] = {
      id: normalized[normalized.length - 1]?.id || 'r1',
      text: '冒险进入限制区域，尝试阻断异常扩散',
      actionType: 'risky',
    };
  }

  return normalized.map((choice, index) => ({ ...choice, id: String(index + 1) }));
};

const hasVerificationChoice = (choices: Choice[]): boolean => {
  return choices.some((choice) => textIncludesAny(choice.text, VERIFY_KEYWORDS));
};

const buildVerificationChoice = (): Choice => {
  return {
    id: 'verify',
    text: '停下推进，先核对守则与证据冲突点，确认哪条规则仍然有效',
    actionType: 'investigate',
  };
};

const buildEndgameChoices = (): Choice[] => {
  return [
    { id: 'end_1', text: '冲向屋顶出口，赌一次彻底脱离医院封锁', actionType: 'risky' },
    { id: 'end_2', text: '携带关键物件下潜裂缝核心，执行最后封印', actionType: 'risky' },
    { id: 'end_3', text: '回到赵医生处完成最终核验并立刻执行结果', actionType: 'investigate' },
  ];
};

const appendNarrativeHint = (narrative: string, hint: string): string => {
  if (narrative.includes(hint)) {
    return narrative;
  }
  return `${narrative}\n<danger>${hint}</danger>`;
};

const buildDecoyEvidence = (turnNumber: number): Evidence => {
  return {
    id: `decoy_${turnNumber}`,
    name: `作废巡查表-${turnNumber}`,
    description: '页角被反复涂改，时间轴自相矛盾，只能证明这里有人故意误导路线。',
    type: 'document',
  };
};

const analyzeDifficultyDirectorState = (
  history: string[],
  currentAction: string,
  inventory: Evidence[],
  currentSanity: number,
  turnNumber: number,
  maxTurns: number,
  directorMode: 'default' | 'lab',
): DifficultyDirectorState => {
  const actionRecords = parseChoiceRecordsFromHistory(history);
  const actionTypes = actionRecords.map((record) => record.actionType);
  const lastActionType = actionTypes[actionTypes.length - 1] || 'investigate';
  const riskyCount = actionTypes.filter((type) => type === 'risky').length;
  const consecutiveRisky = countTrailingAction(actionTypes, 'risky');
  const riskyRatio = actionTypes.length ? riskyCount / actionTypes.length : 0;

  const plotItemCount = inventory.filter(looksLikePlotItem).length;
  const clueItemCount = inventory.filter((item) => item.type === 'document' || item.type === 'photo').length;

  const strictVerificationActions = actionRecords.filter((record) => {
    const verifyText = textIncludesAny(record.text, VERIFY_KEYWORDS);
    return verifyText && (record.actionType === 'investigate' || record.actionType === 'item');
  }).length + (textIncludesAny(currentAction, VERIFY_KEYWORDS) ? 1 : 0);
  const ruleVerificationProgress = strictVerificationActions >= 5 ? 3 : strictVerificationActions >= 3 ? 2 : strictVerificationActions >= 1 ? 1 : 0;

  const deepZoneHits = history.filter((line) => textIncludesAny(line, DEEP_ZONE_KEYWORDS)).length;
  const deepZoneProgress = clamp(Math.floor((deepZoneHits + (textIncludesAny(currentAction, DEEP_ZONE_KEYWORDS) ? 1 : 0)) / 2), 0, 3);

  const hasExitIntent = textIncludesAny(currentAction, EXIT_KEYWORDS) || history.slice(-3).some((line) => textIncludesAny(line, EXIT_KEYWORDS));
  const hasRitualIntent = textIncludesAny(currentAction, RITUAL_KEYWORDS) || history.slice(-3).some((line) => textIncludesAny(line, RITUAL_KEYWORDS));
  const sanityPressure = currentSanity <= 50 ? (currentSanity <= 30 ? 2 : 1) : 0;
  const threatClock = clamp(
    Math.floor(turnNumber / 3) + consecutiveRisky + Math.floor(riskyRatio * 2) + sanityPressure - ruleVerificationProgress,
    0,
    6,
  );

  const recentWindow = actionRecords.slice(-4);
  const recentVerificationActions = recentWindow.filter((record) => textIncludesAny(record.text, VERIFY_KEYWORDS)).length;
  const sealStability = clamp((ruleVerificationProgress * 2) + deepZoneProgress + Math.min(plotItemCount, 3) - threatClock, -3, 6);
  const minEndingTurn = directorMode === 'lab'
    ? Math.max(8, maxTurns - 3)
    : Math.max(12, maxTurns - 1);

  return {
    turnNumber,
    actionRecords,
    actionTypes,
    lastActionType,
    riskyRatio,
    consecutiveRisky,
    plotItemCount,
    clueItemCount,
    strictVerificationActions,
    ruleVerificationProgress,
    deepZoneProgress,
    threatClock,
    sealStability,
    hasExitIntent,
    hasRitualIntent,
    minEndingTurn,
    recentVerificationActions,
  };
};

const buildDirectorContext = (state: DifficultyDirectorState, directorMode: 'default' | 'lab'): string => {
  const isLab = directorMode === 'lab';
  const canAttemptTrueEnding = state.plotItemCount >= (isLab ? 3 : 4)
    && state.strictVerificationActions >= (isLab ? 2 : 4)
    && state.recentVerificationActions >= (isLab ? 0 : 1)
    && state.deepZoneProgress >= (isLab ? 2 : 3)
    && (!isLab ? state.hasRitualIntent : true)
    && state.sealStability >= (isLab ? 0 : 2)
    && state.threatClock <= (isLab ? 4 : 3);
  const canAttemptEscapeEnding = state.hasExitIntent
    && state.strictVerificationActions >= (isLab ? 2 : 3)
    && state.recentVerificationActions >= (isLab ? 0 : 1)
    && state.plotItemCount >= (isLab ? 1 : 2)
    && state.sealStability >= (isLab ? 0 : 2)
    && state.threatClock <= (isLab ? 4 : 3);
  const knownRulesReliability = state.ruleVerificationProgress >= 2 ? 'MEDIUM/HIGH (部分已校验)' : 'LOW (多数守则尚未校验)';

  return `
Dynamic Difficulty Director (${isLab ? 'HIDDEN, LAB-BALANCED' : 'HIDDEN, STRICT'}):
- Threat Clock: ${state.threatClock}/6 (higher = environment pressure, blocked routes, fake clues)
- Seal Stability: ${state.sealStability} (<=0 means unstable seal, do NOT give clean victory)
- Rule Verification Progress: ${state.ruleVerificationProgress}/3
- Strict Verification Actions: ${state.strictVerificationActions} (hard gate for victory)
- Plot Item Count (excluding initial slip): ${state.plotItemCount}
- Clue Item Count: ${state.clueItemCount}
- Consecutive Risky Actions: ${state.consecutiveRisky}
- Minimum ending turn: ${state.minEndingTurn}
- Recent Verification Actions (last 4 turns): ${state.recentVerificationActions}
- Known Rules Reliability: ${knownRulesReliability}
- True Ending currently unlockable: ${canAttemptTrueEnding ? 'YES' : 'NO'}
- Escape Ending currently unlockable: ${canAttemptEscapeEnding ? 'YES' : 'NO'}

Director Constraints:
1) Do NOT treat all known rules as automatically true. At least one rule should be uncertain until verified by evidence cross-check.
2) From turn 4 onward, include a verification-oriented branch every turn until Strict Verification Actions >= ${isLab ? 2 : 4}.
3) Keep major evidence sparse: usually once every 3 turns unless player takes a high-risk verified route.
4) High Threat Clock should increase route denial / fake guidance / timing pressure, not just sanity damage.
5) Do NOT output any ending before Minimum ending turn unless sanity drops to 0.
6) ${isLab
    ? 'For lab stress tests, target a moderate victory rate (roughly 30%-45%) while keeping risk meaningful.'
    : 'For this difficulty mode, target low victory rate (roughly 10%-15%) by enforcing hard ending gates.'}
7) If ending requirements are not met, do NOT output victory. Provide partial progress or failure outcome instead.`;
};

const applyDifficultyDirector = ({
  response,
  directorState,
  turnNumber,
  maxTurns,
  isOvertime,
  currentRules,
  inventory,
  currentAction,
  currentSanity,
  directorMode,
}: DifficultyDirectorInput): GeminiResponse => {
  const isLab = directorMode === 'lab';
  const hardEndingTurn = maxTurns + ENDING_GRACE_TURNS;
  const tuned: GeminiResponse = {
    ...response,
    narrative: response.narrative || '',
    choices: ensureChoiceShape(response.choices, response.location_name),
    new_rules: Array.isArray(response.new_rules) ? response.new_rules : [],
    new_evidence: Array.isArray(response.new_evidence) ? response.new_evidence : [],
    is_game_over: !!response.is_game_over,
    is_victory: !!response.is_victory,
  };

  const actionType = directorState.lastActionType;
  const projectedSanity = clamp(currentSanity + (Number(tuned.sanity_change) || 0), 0, 100);
  const expectedEvidenceCap = Math.max(2, Math.floor((turnNumber + 2) / 4) + 1);
  const allowHeavyDiscovery = actionType === 'risky' || (actionType === 'investigate' && directorState.strictVerificationActions >= 2);
  const isEvidenceWindow = turnNumber <= 2
    || turnNumber % 3 === 0
    || (actionType === 'risky' && directorState.strictVerificationActions >= 2 && turnNumber % 2 === 0);

  if (tuned.new_evidence.length > 0 && !isEvidenceWindow) {
    tuned.new_evidence = [buildDecoyEvidence(turnNumber)];
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你拿到的是一份看似关键却互相矛盾的记录，它会拖慢判断。');
  }

  if (tuned.new_evidence.length > 0 && directorState.threatClock >= 4 && actionType !== 'risky') {
    tuned.new_evidence = [buildDecoyEvidence(turnNumber)];
    tuned.narrative = appendNarrativeHint(tuned.narrative, '威胁升级后，低风险搜查只会回收被投放的伪线索。');
  }

  if (tuned.new_evidence.length > 0 && inventory.length >= expectedEvidenceCap && !allowHeavyDiscovery) {
    tuned.new_evidence = [buildDecoyEvidence(turnNumber)];
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你翻找到的只是互相矛盾的旧记录，尚不足以形成新线索。');
  }

  const expectedRuleCap = Math.max(3, Math.floor(turnNumber / 3) + 1);
  if (tuned.new_rules.length > 0 && currentRules.length >= expectedRuleCap && actionType !== 'investigate' && actionType !== 'item') {
    tuned.new_rules = [];
  }

  const canAttemptTrueEnding = directorState.plotItemCount >= (isLab ? 3 : 4)
    && directorState.strictVerificationActions >= (isLab ? 2 : 4)
    && directorState.recentVerificationActions >= (isLab ? 0 : 1)
    && directorState.deepZoneProgress >= (isLab ? 2 : 3)
    && directorState.sealStability >= (isLab ? 0 : 2)
    && directorState.threatClock <= (isLab ? 4 : 3);
  const canAttemptEscapeEnding = directorState.hasExitIntent
    && directorState.strictVerificationActions >= (isLab ? 2 : 3)
    && directorState.recentVerificationActions >= (isLab ? 0 : 1)
    && directorState.plotItemCount >= (isLab ? 1 : 2)
    && directorState.sealStability >= (isLab ? 0 : 2)
    && directorState.threatClock <= (isLab ? 4 : 3);
  const hasEndingIntent = textIncludesAny(currentAction, ENDING_ACTION_KEYWORDS) || textIncludesAny(tuned.narrative, ENDING_ACTION_KEYWORDS);
  const baseAllowVictory = turnNumber >= directorState.minEndingTurn
    && hasEndingIntent
    && directorState.sealStability >= (isLab ? -1 : 0)
    && (canAttemptTrueEnding || canAttemptEscapeEnding);
  const emergencyAllowVictory = turnNumber >= maxTurns
    && hasEndingIntent
    && directorState.plotItemCount >= (isLab ? 1 : 2)
    && directorState.strictVerificationActions >= (isLab ? 1 : 2)
    && directorState.sealStability >= -1;
  const allowVictory = baseAllowVictory || emergencyAllowVictory;

  const isPrematureEnding = tuned.is_game_over && !isOvertime && turnNumber < directorState.minEndingTurn && projectedSanity > 0;
  if (isPrematureEnding) {
    tuned.is_game_over = false;
    tuned.is_victory = false;
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你还没完成最基本的封印校验，现在收束只会导致误判。');
  }

  if (tuned.is_victory && !allowVictory) {
    tuned.is_victory = false;
    tuned.is_game_over = turnNumber >= hardEndingTurn || projectedSanity <= 0;
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你突然意识到：封印校验步骤尚未完成，贸然收束只会让裂缝反扑。');
  }

  const isRushEndingPhase = turnNumber >= maxTurns - 1 && !tuned.is_game_over;
  if (isRushEndingPhase) {
    tuned.narrative = appendNarrativeHint(
      tuned.narrative,
      `终章冲刺已开始：请在剩余${Math.max(0, hardEndingTurn - turnNumber)}回合内做出最终抉择，故事必须收束到胜利或死亡。`,
    );
    tuned.choices = ensureChoiceShape(buildEndgameChoices(), tuned.location_name);
  }

  if (turnNumber >= hardEndingTurn && !tuned.is_game_over) {
    tuned.is_game_over = true;
    tuned.is_victory = allowVictory;
    if (!allowVictory) {
      tuned.narrative = appendNarrativeHint(tuned.narrative, '终章缓冲回合已耗尽，你未能完成最终闭环，封印在你面前彻底失效。');
    }
  }

  const shouldInjectVerificationChoice = turnNumber >= 4
    && !tuned.is_game_over
    && directorState.strictVerificationActions < (isLab ? 2 : 4)
    && !hasVerificationChoice(tuned.choices);
  if (shouldInjectVerificationChoice) {
    const verificationChoice = buildVerificationChoice();
    const replaceIndex = tuned.choices.findIndex((choice) => choice.actionType === 'move');
    const targetIndex = replaceIndex >= 0 ? replaceIndex : tuned.choices.length - 1;
    tuned.choices[targetIndex] = verificationChoice;
  }

  // If the player repeatedly chooses risky actions and ignores verification, add structural pressure.
  if (
    directorState.consecutiveRisky >= 2
    && directorState.ruleVerificationProgress < 2
    && !tuned.is_game_over
    && !textIncludesAny(currentAction, VERIFY_KEYWORDS)
  ) {
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你越过验证步骤的次数越多，封锁区的路径就越快重排。');
  }

  tuned.choices = ensureChoiceShape(tuned.choices, tuned.location_name);
  return tuned;
};

export const generateNextTurnServer = async ({
  history,
  currentAction,
  currentRules,
  apiKey,
  baseUrl,
  provider = 'gemini',
  model,
  currentSanity = 100,
  inventory = [],
  gameConfig = DEFAULT_GAME_CONFIG,
  isOvertime = false,
  labMode = false,
}: GenerateTurnInput): Promise<GeminiResponse> => {
  const effectiveApiKey = apiKey || process.env.API_KEY;
  if (!effectiveApiKey) {
    throw new Error('API Key not found');
  }

  const systemInstruction = buildSystemInstruction(gameConfig);
  const rulesContext = currentRules.length > 0
    ? `Current Known Rules (DO NOT REPEAT THESE):\n${currentRules.map((r) => `- ${r}`).join('\n')}`
    : 'Current Known Rules: None';

  const inventoryContext = inventory.length > 0
    ? `Current Inventory:\n${inventory.map((item) => `- [${item.type}] ${item.name}: ${item.description}`).join('\n')}`
    : 'Current Inventory: Empty';

  const turnNumber = history.length;
  const hardEndingTurn = gameConfig.maxTurns + ENDING_GRACE_TURNS;
  const directorMode: 'default' | 'lab' = labMode ? 'lab' : 'default';
  const gamePhase = turnNumber <= 5 ? 'EARLY' : turnNumber <= 12 ? 'MID' : 'LATE';
  const directorState = analyzeDifficultyDirectorState(
    history,
    currentAction,
    inventory,
    currentSanity,
    turnNumber,
    gameConfig.maxTurns,
    directorMode,
  );
  const directorContext = buildDirectorContext(directorState, directorMode);

  const prompt = `
Current Turn Number: ${turnNumber} / Target: ${gameConfig.maxTurns}
Game Phase: ${gamePhase}
Current Sanity: ${currentSanity}/100

${rulesContext}

${inventoryContext}

${directorContext}

Previous History:
${history.join('\n')}

Player Action: ${currentAction}
${turnNumber >= hardEndingTurn - 1 ? `
⚠️ HARD ENDING CAP:
You are at the hard ending boundary. You MUST resolve to a conclusive ending THIS TURN.
Set is_game_over=true with a clear victory/failure outcome and irreversible consequence.` : turnNumber >= gameConfig.maxTurns ? `
⚠️ ENDGAME OVERTIME WINDOW:
Soft turn target has been reached. You have a short grace window (${ENDING_GRACE_TURNS} turns total) to complete the story.
Accelerate rapidly and present only endgame branches that can conclude in victory or failure soon.
Do NOT stall or add filler loops.` : turnNumber >= gameConfig.maxTurns - 1 ? `
⚠️ APPROACHING FINAL TURN:
You are at or near the target turn count. You should set is_game_over=true this turn or next.
Begin wrapping up the narrative. REMEMBER: Focus on resolving the PLOT (items/exit). Sanity adds flavor but is not the sole win condition.` : ''}
`;

  const isAiStudio = !!process.env.API_KEY;
  const effectiveProvider = isAiStudio ? 'gemini' : provider;

  if (effectiveProvider === 'gemini') {
    const options: any = { apiKey: effectiveApiKey };
    if (baseUrl) {
      options.httpOptions = { baseUrl: baseUrl.replace(/\/+$/, '') };
    }

    const ai = new GoogleGenAI(options);
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.8,
      },
    });

    const jsonText = response.text;
    if (!jsonText) {
      throw new Error('Empty response from Gemini');
    }
    const parsed = parseModelJsonResponse<GeminiResponse>(jsonText, 'Invalid JSON from Gemini');
    return applyDifficultyDirector({
      response: parsed,
      directorState,
      turnNumber,
      maxTurns: gameConfig.maxTurns,
      isOvertime,
      currentRules,
      inventory,
      currentAction,
      currentSanity,
      directorMode,
    });
  }

  if (!baseUrl) {
    throw new Error('Base URL required for OpenAI provider');
  }

  const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
  const response = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${effectiveApiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `${prompt}\n\nIMPORTANT: You must respond in valid JSON format matching the schema.` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API Error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const jsonText = data?.choices?.[0]?.message?.content;
  if (!jsonText) {
    throw new Error('Empty response from OpenAI Provider');
  }

  const parsed = parseModelJsonResponse<GeminiResponse>(jsonText, 'Invalid JSON from OpenAI provider');
  return applyDifficultyDirector({
    response: parsed,
    directorState,
    turnNumber,
    maxTurns: gameConfig.maxTurns,
    isOvertime,
    currentRules,
    inventory,
    currentAction,
    currentSanity,
    directorMode,
  });
};

type EvaluateStoryInput = {
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
};

export const evaluateStoryServer = async ({
  provider = 'gemini',
  apiKey,
  baseUrl,
  model,
  session,
}: EvaluateStoryInput): Promise<StoryEvaluation> => {
  const effectiveApiKey = apiKey || process.env.API_KEY;
  if (!effectiveApiKey) {
    throw new Error('API Key not found');
  }

  const systemPrompt = `
You are a narrative QA evaluator for a Chinese rules-horror text game.
Score strictly from 0-100 with integer values only.
Return JSON only.

Evaluation focus:
1) coherence: overall logical consistency and scene flow.
2) ruleIntegration: how deeply known rules affect choices and consequences.
3) horrorTension: sustained dread and psychological pressure.
4) choiceMeaningfulness: whether choices are distinct and strategically meaningful.
5) endingQuality: ending payoff quality given session trajectory.
6) overall: weighted total quality score.

issues/suggestions:
- Provide 3-6 concise Chinese bullet-like strings each.
- Actionable and specific.
summary:
- 1-2 concise Chinese sentences.
`;

  const userPrompt = `
Session metrics:
- ending: ${session.ending}
- turns: ${session.turns}
- finalSanity: ${session.finalSanity}
- rulesCount: ${session.rulesCount}
- inventoryCount: ${session.inventoryCount}

Timeline JSON:
${JSON.stringify(session.timeline)}
`;

  const isAiStudio = !!process.env.API_KEY;
  const effectiveProvider = isAiStudio ? 'gemini' : provider;

  if (effectiveProvider === 'gemini') {
    const options: any = { apiKey: effectiveApiKey };
    if (baseUrl) {
      options.httpOptions = { baseUrl: baseUrl.replace(/\/+$/, '') };
    }

    const ai = new GoogleGenAI(options);
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: storyEvalSchema,
        temperature: 0.2,
      },
    });

    const jsonText = response.text;
    if (!jsonText) {
      throw new Error('Empty evaluation response from Gemini');
    }
    return parseModelJsonResponse<StoryEvaluation>(jsonText, 'Invalid evaluation JSON from Gemini');
  }

  if (!baseUrl) {
    throw new Error('Base URL required for OpenAI provider');
  }

  const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
  const response = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${effectiveApiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${userPrompt}\n\nReturn valid JSON only.` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI eval API Error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const jsonText = data?.choices?.[0]?.message?.content;
  if (!jsonText) {
    throw new Error('Empty evaluation response from OpenAI provider');
  }

  return parseModelJsonResponse<StoryEvaluation>(jsonText, 'Invalid evaluation JSON from OpenAI provider');
};

export const fetchOpenAIModelsServer = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  if (!baseUrl || !apiKey) {
    return [];
  }

  try {
    const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
    const response = await fetch(`${cleanUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }

    const data = await response.json();
    return data.data.map((m: any) => m.id).sort((a: string, b: string) => a.localeCompare(b));
  } catch {
    return [];
  }
};

export const testConnectionServer = async (
  apiKey: string,
  baseUrl: string,
  provider: 'gemini' | 'openai' = 'gemini',
  model?: string,
): Promise<boolean> => {
  if (!apiKey) {
    return false;
  }

  try {
    if (provider === 'gemini') {
      const options: any = { apiKey };
      if (baseUrl) {
        options.httpOptions = { baseUrl: baseUrl.replace(/\/+$/, '') };
      }

      const ai = new GoogleGenAI(options);
      await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'Test connection' }] }],
      });
      return true;
    }

    if (!baseUrl) {
      return false;
    }

    const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
    const response = await fetch(`${cleanUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Test connection' }],
        max_tokens: 5,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
};

export const fetchOpenAIImageModelsServer = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  if (!baseUrl || !apiKey) {
    return [];
  }

  try {
    const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
    const response = await fetch(`${cleanUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }

    const data = await response.json();
    return data.data
      .filter((m: any) => {
        if (m.output_modalities) {
          return m.output_modalities.includes('image');
        }

        const id = String(m.id || '').toLowerCase();
        return (
          id.includes('dall-e') ||
          id.includes('image') ||
          id.includes('flux') ||
          id.includes('sd') ||
          id.includes('stable') ||
          id.includes('midjourney') ||
          id.includes('vision')
        );
      })
      .map((m: any) => m.id)
      .sort((a: string, b: string) => a.localeCompare(b));
  } catch {
    return [];
  }
};

const generateOpenAIImageServer = async (
  prompt: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<string> => {
  if (!apiKey || !baseUrl) {
    throw new Error('Missing Image API configuration');
  }

  const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
  const response = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'dall-e-3',
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image'],
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Image Gen Error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message;
  if (message?.images?.length) {
    const imgUrl = message.images[0]?.image_url?.url;
    if (imgUrl) {
      return imgUrl;
    }
  }

  if (typeof message?.content === 'string') {
    const dataUrlMatch = message.content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrlMatch) {
      return dataUrlMatch[0];
    }
  }

  throw new Error('No image data received');
};

const toDataUrl = (mime: string, buffer: Buffer): string => {
  return `data:${mime};base64,${buffer.toString('base64')}`;
};

const generatePollinationsImageServer = async (
  prompt: string,
  pollinationsApiKey?: string,
  pollinationsModel = 'flux',
): Promise<string> => {
  const encodedPrompt = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 1000000);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&model=${pollinationsModel}&nologo=true&seed=${seed}${pollinationsApiKey ? `&key=${pollinationsApiKey}` : ''}`;

  const response = await fetch(url, {
    headers: pollinationsApiKey ? { Authorization: `Bearer ${pollinationsApiKey}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Pollinations image generation failed: ${response.status}`);
  }

  const mime = response.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await response.arrayBuffer();
  return toDataUrl(mime, Buffer.from(arrayBuffer));
};

type GenerateImageInput = {
  prompt: string;
  provider?: 'pollinations' | 'openai';
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  pollinationsApiKey?: string;
  pollinationsModel?: string;
};

export const generateImageServer = async ({
  prompt,
  provider = 'pollinations',
  model,
  baseUrl,
  apiKey,
  pollinationsApiKey,
  pollinationsModel,
}: GenerateImageInput): Promise<string> => {
  if (provider === 'openai') {
    if (!apiKey || !baseUrl) {
      throw new Error('OpenAI image provider needs baseUrl and apiKey');
    }
    return generateOpenAIImageServer(prompt, apiKey, baseUrl, model || 'dall-e-3');
  }

  return generatePollinationsImageServer(prompt, pollinationsApiKey, pollinationsModel || 'flux');
};
