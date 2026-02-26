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

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const resolveTurnJsonMaxAttempts = (): number => {
  const raw = Number.parseInt(process.env.TURN_JSON_MAX_ATTEMPTS || '', 10);
  if (!Number.isFinite(raw)) {
    return 2;
  }
  return Math.max(1, Math.min(8, raw));
};

const TURN_JSON_MAX_ATTEMPTS = resolveTurnJsonMaxAttempts();
const OPENAI_RETRY_BASE_DELAY_MS = 800;
const OPENAI_RETRY_MAX_DELAY_MS = 8000;

const previewText = (text: string, maxLength = 360): string => {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
};

const sleepMs = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isTransientOpenAIError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('fetch failed') ||
    normalized.includes('network') ||
    normalized.includes('socket hang up') ||
    normalized.includes('econnreset') ||
    normalized.includes('etimedout') ||
    normalized.includes('openai api error: 429') ||
    normalized.includes('openai api error: 500') ||
    normalized.includes('openai api error: 502') ||
    normalized.includes('openai api error: 503') ||
    normalized.includes('openai api error: 504') ||
    normalized.includes('unknown provider for model')
  );
};

const computeOpenAIRetryDelayMs = (attempt: number): number => {
  const exponential = Math.min(OPENAI_RETRY_MAX_DELAY_MS, OPENAI_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return exponential + jitter;
};

const buildTurnJsonRepairPrompt = (rawText: string, outputLocale: string): string => {
  return `
Your previous response was invalid JSON.
Rewrite it into a strictly valid JSON object only, without markdown or extra text.

Output requirements:
- Keep all JSON keys exactly as required by this game engine.
- Must include required keys: narrative, choices, image_prompt_english, sanity_change, location_name, is_game_over.
- choices[*].actionType must be one of: move, investigate, item, risky.
- Keep all player-visible text in locale: ${outputLocale}.
- If uncertain, use empty arrays for new_rules/new_evidence.

Malformed payload to repair:
${rawText}
`;
};

const requestOpenAIJsonCompletion = async ({
  cleanUrl,
  apiKey,
  model,
  messages,
  temperature,
}: {
  cleanUrl: string;
  apiKey: string;
  model: string;
  messages: OpenAIChatMessage[];
  temperature: number;
}): Promise<string> => {
  const response = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: 'json_object' },
      temperature,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API Error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const jsonText = data?.choices?.[0]?.message?.content;
  if (!jsonText || typeof jsonText !== 'string') {
    throw new Error('Empty response from OpenAI Provider');
  }
  return jsonText;
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
  systemInstructionOverride?: string;
  outputLocale?: string;
  isOvertime?: boolean;
  labMode?: boolean;
  storyTitle?: string | null;
  storySlug?: string | null;
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
  gameConfig: GameConfig;
  isOvertime: boolean;
  currentRules: string[];
  inventory: Evidence[];
  currentAction: string;
  currentSanity: number;
  directorMode: 'default' | 'lab';
  storyTitle?: string | null;
  storySlug?: string | null;
};

const ACTION_TYPES: ActionType[] = ['move', 'investigate', 'item', 'risky'];
const VERIFY_KEYWORDS = ['验证', '核对', '比对', '复查', '对照', '校验', '确认规则', '排查'];
const EXIT_KEYWORDS = ['天台', '屋顶', '出口', '逃生门', '安全通道', '检修通道', '离开医院', '撤离医院', '冲出医院'];
const RITUAL_KEYWORDS = ['封印', '仪式', '裂缝', '下潜', '地下二层', '锚点', '阵列', '关闭', '重置'];
const ENDING_ACTION_KEYWORDS = [...EXIT_KEYWORDS, ...RITUAL_KEYWORDS, '最终', '决断', '了结'];
const DEEP_ZONE_KEYWORDS = ['东楼', '地下', '档案', '封锁', '禁闭', '裂缝', '封印室', '地下二层'];
const BASE_PLOT_ITEM_KEYWORDS = [
  '病历',
  '档案',
  '录音',
  '工牌',
  '徽章',
  '封印',
  '阵列',
  '裂缝',
  '守则原件',
  '手册',
  '日志',
  '钥匙',
  '凭证',
  '契约',
  '地图',
  '笔记',
  '照片',
  '核心',
  '仪式',
];
const CHONGSHAN_PLOT_ITEM_KEYWORDS = [
  '病历',
  '档案',
  '录音',
  '工牌',
  '徽章',
  '封印',
  '阵列',
  '蓝衣',
  '赵医生',
  '裂缝',
  '守则原件',
];
const ENDING_GRACE_TURNS = 3;

const textIncludesAny = (text: string, keywords: string[]): boolean => {
  return keywords.some((keyword) => text.includes(keyword));
};

const uniqNonEmpty = (items: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'string') {
      continue;
    }
    const text = raw.trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    out.push(text);
  }
  return out;
};

const isChongshanStory = (storyTitle?: string | null, storySlug?: string | null): boolean => {
  const titleRaw = (storyTitle || '').trim();
  const title = titleRaw.toLowerCase();
  const slug = (storySlug || '').trim().toLowerCase().replace(/_/g, '-');
  return (
    slug === 'chongshan-hospital'
    || (slug.includes('chongshan') && slug.includes('hospital'))
    || titleRaw.includes('崇山医院')
    || title.includes('chongshan hospital')
  );
};

const extractStoryKeywords = (storyTitle?: string | null, storySlug?: string | null): string[] => {
  const title = (storyTitle || '').trim();
  const slug = (storySlug || '').trim().toLowerCase();
  const titleParts = title
    .split(/[\s\-_/|·，。、《》()（）]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  const slugParts = slug
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);

  const mappedSlugHints = slugParts.flatMap((part) => {
    if (part.includes('hospital')) return ['hospital', '医院'];
    if (part.includes('manor')) return ['manor', '庄园'];
    if (part.includes('clinic')) return ['clinic', '诊所'];
    return [part];
  });

  const semanticHints: string[] = [];
  if (title.includes('医院')) semanticHints.push('医院');
  if (title.includes('庄园')) semanticHints.push('庄园');
  if (title.includes('山庄')) semanticHints.push('山庄');
  if (title.includes('诊所')) semanticHints.push('诊所');

  return uniqNonEmpty([title, ...titleParts, ...mappedSlugHints, ...semanticHints]);
};

const buildPlotItemKeywords = (storyTitle?: string | null, storySlug?: string | null): string[] => {
  if (isChongshanStory(storyTitle, storySlug)) {
    return CHONGSHAN_PLOT_ITEM_KEYWORDS;
  }
  return uniqNonEmpty([...BASE_PLOT_ITEM_KEYWORDS, ...extractStoryKeywords(storyTitle, storySlug)]);
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

const looksLikePlotItem = (item: Evidence, plotItemKeywords: string[]): boolean => {
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
  return textIncludesAny(text, plotItemKeywords);
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

const buildVerificationItemChoice = (): Choice => {
  return {
    id: 'verify_item',
    text: '整理携带物证并交叉比对冲突条目，再决定下一步推进顺序',
    actionType: 'item',
  };
};

const hasRescueAction = (text: string): boolean => {
  return textIncludesAny(text || '', CHONGSHAN_RESCUE_ACTION_KEYWORDS);
};

const hasRescueActionInHistory = (state: DifficultyDirectorState): boolean => {
  return state.actionRecords.some((record) => hasRescueAction(record.text));
};

const buildChongshanRescueChoices = (reasonCode: ChongshanFallReasonCode): Choice[] => {
  if (reasonCode === 'fall_rule_chain_break') {
    return [
      { id: 'rescue_chain_1', text: '【补救链】立即回到核验点，补做“规则-物证-位置”三联校验。', actionType: 'investigate' },
      { id: 'rescue_chain_2', text: '【补救链】用现有关键物证重新签注封印流程，再执行终结动作。', actionType: 'item' },
      { id: 'rescue_chain_3', text: '短距后撤至安全位，先压低威胁再二次推进。', actionType: 'move' },
    ];
  }
  return [
    { id: 'rescue_conflict_1', text: '【补救冲突】停止高危操作，先核对冲突规则并撤销刚触发的禁忌步骤。', actionType: 'investigate' },
    { id: 'rescue_conflict_2', text: '【补救冲突】提交当前证据给校验节点，重建合法执行链。', actionType: 'item' },
    { id: 'rescue_conflict_3', text: '快速脱离冲突区，绕行至东楼地下段重新对位。', actionType: 'move' },
  ];
};

const hasDeepZoneChoice = (choices: Choice[]): boolean => {
  return choices.some((choice) => textIncludesAny(choice.text, DEEP_ZONE_KEYWORDS));
};

const buildDeepZoneChoice = (deepZoneProgress: number): Choice => {
  if (deepZoneProgress <= 1) {
    return {
      id: 'deep_zone_push',
      text: '立即转入东楼地下段，定位地下二层入口并建立封印坐标。',
      actionType: 'move',
    };
  }
  return {
    id: 'deep_zone_push',
    text: '继续下潜至地下二层核心区，完成裂缝锚点与封印位的最终确认。',
    actionType: 'investigate',
  };
};

const buildEndgameChoices = (params: {
  storyTitle?: string | null;
  storySlug?: string | null;
  currentAction: string;
  currentRules: string[];
  inventory: Evidence[];
  locationName: string;
}): Choice[] => {
  if (isChongshanStory(params.storyTitle, params.storySlug)) {
    return [
      { id: 'end_1', text: '冲向屋顶出口，赌一次彻底脱离医院封锁', actionType: 'risky' },
      { id: 'end_2', text: '携带关键物件下潜裂缝核心，执行最后封印', actionType: 'risky' },
      { id: 'end_3', text: '回到赵医生处完成最终核验并立刻执行结果', actionType: 'investigate' },
    ];
  }

  const aggregateText = [
    params.storyTitle || '',
    params.storySlug || '',
    params.currentAction,
    params.locationName,
    ...params.currentRules,
    ...params.inventory.map((item) => `${item.name} ${item.description}`),
  ].join(' ');

  const escapeTarget = textIncludesAny(aggregateText, ['庄园', 'manor', '山庄'])
    ? '庄园外门'
    : textIncludesAny(aggregateText, ['医院', 'hospital', '病房'])
      ? '医院出口'
      : '外部出口';
  const coreTarget = textIncludesAny(aggregateText, ['封印', '裂缝', '仪式', '祭坛'])
    ? '核心封印区'
    : textIncludesAny(aggregateText, ['地下', '地窖', '地下室'])
      ? '地下核心区'
      : '核心区域';
  const verifyAnchor = params.inventory.find((item) => item.type === 'key' || item.type === 'document');
  const verifyTarget = verifyAnchor?.name?.trim() ? `“${verifyAnchor.name.trim()}”` : '关键线索源';

  return [
    { id: 'end_1', text: `冲向${escapeTarget}，赌一次彻底脱离当前封锁`, actionType: 'risky' },
    { id: 'end_2', text: `携带关键物件前往${coreTarget}，执行最后闭环`, actionType: 'risky' },
    { id: 'end_3', text: `先核对${verifyTarget}与现行规则冲突，再执行最终决断`, actionType: 'investigate' },
  ];
};

type EndingGateProfile = {
  truePlotItems: number;
  trueVerifyActions: number;
  trueRecentVerifyActions: number;
  trueDeepZone: number;
  trueSealStability: number;
  trueThreatMax: number;
  escapePlotItems: number;
  escapeVerifyActions: number;
  escapeRecentVerifyActions: number;
  escapeSealStability: number;
  escapeThreatMax: number;
  allowVictorySealFloor: number;
  targetVictoryRateHint: string;
};

type ChongshanRoute = 'seal' | 'verify' | 'escape' | 'unknown';
type ChongshanEndingTier = 'perfect' | 'normal' | 'pass' | 'fall' | null;
type ChongshanFallReasonCode =
  | 'fall_sanity_depleted'
  | 'fall_deadline_exhausted'
  | 'fall_rule_chain_break'
  | 'fall_unstable_seal'
  | 'fall_rule_conflict'
  | 'fall_route_incomplete';
type ChongshanFallReasonContext = {
  directorState: DifficultyDirectorState;
  route: ChongshanRoute;
  currentAction: string;
  projectedSanity: number;
  turnNumber: number;
  hardEndingTurn: number;
  hasEndingIntent: boolean;
  isModelEnding: boolean;
};

const CHONGSHAN_SEAL_ROUTE_KEYWORDS = ['下潜', '裂缝', '封印', '核心', '祭坛', '地下二层', '重置'];
const CHONGSHAN_VERIFY_ROUTE_KEYWORDS = ['赵医生', '核验', '核对', '交叉验证', '执行结果', '比对'];
const CHONGSHAN_ESCAPE_ROUTE_KEYWORDS = ['屋顶', '出口', '离开医院', '撤离医院', '冲出医院', '检修通道', '安全通道', '外部'];
const CHONGSHAN_ESCAPE_BOUNDARY_KEYWORDS = ['医院', '院区', '出口', '大门', '屋顶', '封锁', '检修通道', '安全通道', '外部'];
const CHONGSHAN_EARLY_FATAL_NARRATIVE_KEYWORDS = [
  '当场死亡',
  '瞬间死亡',
  '立即死亡',
  '被裂缝吞没',
  '被拖入裂缝',
  '意识被抹除',
  '不可逆',
  '无可逆',
  '高危规则冲突',
  '终局原因',
];
const CHONGSHAN_EARLY_FATAL_ACTION_KEYWORDS = [
  '回头',
  '直视',
  '摘下口罩',
  '进入东楼',
  '触碰裂缝',
  '撕毁守则',
  '靠近红衣',
  '跟随红衣',
  '拒绝核验',
];
const CHONGSHAN_MIN_VICTORY_TURN = 10;
const CHONGSHAN_PROGRESS_HINT_START_TURN = 8;
const CHONGSHAN_PROGRESS_HINT_END_TURN = 10;
const CHONGSHAN_DEEP_ZONE_PUSH_TURN = 8;
const CHONGSHAN_RESCUE_WINDOW_TURNS = 1;
const CHONGSHAN_RESCUE_ACTION_KEYWORDS = ['【补救链】', '【补救冲突】'];
const CHONGSHAN_DEFEAT_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /你活下来了/g, replacement: '你一度以为自己活下来了' },
  { pattern: /活了下来/g, replacement: '勉强维持了残存意识' },
  { pattern: /你成功逃离了崇山医院/g, replacement: '你一度以为自己已经逃离崇山医院' },
  { pattern: /你成功逃离/g, replacement: '你一度以为自己成功逃离' },
  { pattern: /你成功地跨过/g, replacement: '你以为自己跨过了' },
  { pattern: /你推开沉重的铁门，清晨阴冷的空气扑面而来。?/g, replacement: '你推开铁门时感受到的“清晨空气”，更像封印诱导出的错觉。' },
];

const getEndingGateProfile = (
  directorMode: 'default' | 'lab',
  storyTitle?: string | null,
  storySlug?: string | null,
): EndingGateProfile => {
  const isChongshan = isChongshanStory(storyTitle, storySlug);
  const strict = directorMode !== 'lab' || isChongshan;

  if (strict) {
    return {
      truePlotItems: 5,
      trueVerifyActions: 5,
      trueRecentVerifyActions: 2,
      trueDeepZone: 3,
      trueSealStability: 3,
      trueThreatMax: 2,
      escapePlotItems: 3,
      escapeVerifyActions: 4,
      escapeRecentVerifyActions: 1,
      escapeSealStability: 2,
      escapeThreatMax: 2,
      allowVictorySealFloor: 1,
      targetVictoryRateHint: '8%-12%',
    };
  }

  return {
    truePlotItems: 3,
    trueVerifyActions: 2,
    trueRecentVerifyActions: 0,
    trueDeepZone: 2,
    trueSealStability: 0,
    trueThreatMax: 4,
    escapePlotItems: 1,
    escapeVerifyActions: 2,
    escapeRecentVerifyActions: 0,
    escapeSealStability: 0,
    escapeThreatMax: 4,
    allowVictorySealFloor: -1,
    targetVictoryRateHint: '30%-45%',
  };
};

const detectChongshanRoute = (actionText: string): ChongshanRoute => {
  if (textIncludesAny(actionText, CHONGSHAN_VERIFY_ROUTE_KEYWORDS)) {
    return 'verify';
  }
  if (textIncludesAny(actionText, CHONGSHAN_SEAL_ROUTE_KEYWORDS)) {
    return 'seal';
  }
  if (textIncludesAny(actionText, CHONGSHAN_ESCAPE_ROUTE_KEYWORDS)) {
    return 'escape';
  }
  return 'unknown';
};

const isChongshanEscapeFinisherAction = (actionText: string): boolean => {
  const hasEscapeRouteKeyword = textIncludesAny(actionText, CHONGSHAN_ESCAPE_ROUTE_KEYWORDS);
  const hasBoundaryKeyword = textIncludesAny(actionText, CHONGSHAN_ESCAPE_BOUNDARY_KEYWORDS);
  return hasEscapeRouteKeyword || (hasBoundaryKeyword && textIncludesAny(actionText, ['逃离', '撤离', '离开', '冲出', '冲向']));
};

const shouldAllowChongshanPrematureFailure = (params: {
  currentAction: string;
  narrative: string;
  directorState: DifficultyDirectorState;
}): boolean => {
  const { currentAction, narrative, directorState } = params;
  const explicitFatalNarrative = textIncludesAny(narrative, CHONGSHAN_EARLY_FATAL_NARRATIVE_KEYWORDS);
  const explicitFatalAction = textIncludesAny(currentAction, CHONGSHAN_EARLY_FATAL_ACTION_KEYWORDS);
  const severeState = directorState.threatClock >= 4 || directorState.sealStability <= 0;
  const earlyBlindRush = directorState.turnNumber <= 6 && directorState.strictVerificationActions < 2;
  return explicitFatalNarrative || (explicitFatalAction && (severeState || earlyBlindRush));
};

const buildChongshanEndingHint = (tier: Exclude<ChongshanEndingTier, null>): string => {
  if (tier === 'perfect') {
    return '结局判定：完美结局「封印重启」——你完成了全部校验闭环，裂缝被稳定回卷。';
  }
  if (tier === 'normal') {
    return '结局判定：普通结局「残缺封印」——主封印成立，但你的记忆与身份已被严重侵蚀。';
  }
  if (tier === 'pass') {
    return '结局判定：及格结局「带伤逃离」——你活着离开了崇山医院，但封印仍在缓慢衰减。';
  }
  return '结局判定：堕入结局「红衣轮值」——校验链断裂，你成为下一轮守门人。';
};

const resolveChongshanEndingTier = (params: {
  directorState: DifficultyDirectorState;
  currentAction: string;
  turnNumber: number;
  projectedSanity: number;
  hardEndingTurn: number;
  hasEndingIntent: boolean;
  isModelEnding: boolean;
}): ChongshanEndingTier => {
  const { directorState, currentAction, turnNumber, projectedSanity, hardEndingTurn, hasEndingIntent, isModelEnding } = params;

  const route = detectChongshanRoute(currentAction);
  const reachedVictoryFloor = turnNumber >= CHONGSHAN_MIN_VICTORY_TURN;
  const reachedEndingWindow = turnNumber >= directorState.minEndingTurn;
  const canAwardVictory = reachedVictoryFloor && reachedEndingWindow && hasEndingIntent;
  const meetsPerfect = route === 'seal'
    && directorState.plotItemCount >= 4
    && directorState.strictVerificationActions >= 5
    && directorState.recentVerificationActions >= 2
    && directorState.deepZoneProgress >= 3
    && directorState.sealStability >= 2
    && directorState.threatClock <= 2;
  const meetsNormalSeal = route === 'seal'
    && directorState.plotItemCount >= 3
    && directorState.strictVerificationActions >= 4
    && directorState.recentVerificationActions >= 1
    && directorState.deepZoneProgress >= 2
    && directorState.sealStability >= 1
    && directorState.threatClock <= 3;
  const meetsNormalVerify = route === 'verify'
    && directorState.plotItemCount >= 3
    && directorState.strictVerificationActions >= 4
    && directorState.recentVerificationActions >= 1
    && directorState.deepZoneProgress >= 2
    && directorState.sealStability >= 1
    && directorState.threatClock <= 3;
  const meetsPassEscape = route === 'escape'
    && isChongshanEscapeFinisherAction(currentAction)
    && directorState.plotItemCount >= 2
    && directorState.strictVerificationActions >= 3
    && directorState.recentVerificationActions >= 1
    && directorState.deepZoneProgress >= 1
    && directorState.sealStability >= 0
    && directorState.threatClock <= 3;

  const meetsAnyVictoryTier = meetsPerfect || meetsNormalSeal || meetsNormalVerify || meetsPassEscape;
  if (canAwardVictory && meetsPerfect) return 'perfect';
  if (canAwardVictory && (meetsNormalSeal || meetsNormalVerify)) return 'normal';
  if (canAwardVictory && meetsPassEscape) return 'pass';

  const mustResolveNow = turnNumber >= hardEndingTurn || projectedSanity <= 0 || isModelEnding;
  if ((reachedEndingWindow && hasEndingIntent && !meetsAnyVictoryTier) || mustResolveNow) {
    return 'fall';
  }

  return null;
};

const buildChongshanGapLabels = (params: {
  directorState: DifficultyDirectorState;
  gate: EndingGateProfile;
}): string[] => {
  const { directorState, gate } = params;
  const gaps: string[] = [];

  const verifyGap = gate.trueVerifyActions - directorState.strictVerificationActions;
  if (verifyGap > 0) {
    gaps.push(`核验动作还差${verifyGap}次`);
  }

  const recentVerifyGap = gate.trueRecentVerifyActions - directorState.recentVerificationActions;
  if (recentVerifyGap > 0) {
    gaps.push(`近4回合核验至少补${recentVerifyGap}次`);
  }

  const plotItemGap = gate.truePlotItems - directorState.plotItemCount;
  if (plotItemGap > 0) {
    gaps.push(`关键物证还差${plotItemGap}件`);
  }

  const deepZoneGap = gate.trueDeepZone - directorState.deepZoneProgress;
  if (deepZoneGap > 0) {
    gaps.push(`深区推进还差${deepZoneGap}级`);
  }

  const sealGap = gate.trueSealStability - directorState.sealStability;
  if (sealGap > 0) {
    gaps.push(`封印稳定度至少再提升${sealGap}`);
  }

  const threatDrop = directorState.threatClock - gate.trueThreatMax;
  if (threatDrop > 0) {
    gaps.push(`威胁时钟需再压低${threatDrop}格`);
  }

  return gaps;
};

const buildChongshanProgressAdvisory = (params: {
  directorState: DifficultyDirectorState;
  gate: EndingGateProfile;
}): string => {
  const { directorState, gate } = params;
  if (directorState.strictVerificationActions < gate.trueVerifyActions) {
    return '优先补核验动作，完成“规则-物证-位置”交叉验证。';
  }
  if (directorState.deepZoneProgress < gate.trueDeepZone) {
    return '优先推进东楼/地下二层，完成深区定位。';
  }
  if (directorState.plotItemCount < gate.truePlotItems) {
    return '优先补齐关键物证，避免终章缺口。';
  }
  if (directorState.sealStability < gate.trueSealStability) {
    return '优先做稳封步骤，先稳住封印再尝试终结。';
  }
  if (directorState.threatClock > gate.trueThreatMax) {
    return '优先降低威胁时钟，再执行高风险动作。';
  }
  return '闭环条件接近完成，可尝试最终核验并收束结局。';
};

const buildChongshanClosureScore = (params: {
  directorState: DifficultyDirectorState;
  gate: EndingGateProfile;
}): number => {
  const { directorState, gate } = params;
  const verifyScore = clamp(directorState.strictVerificationActions / Math.max(1, gate.trueVerifyActions), 0, 1);
  const recentVerifyScore = clamp(directorState.recentVerificationActions / Math.max(1, gate.trueRecentVerifyActions), 0, 1);
  const plotScore = clamp(directorState.plotItemCount / Math.max(1, gate.truePlotItems), 0, 1);
  const deepScore = clamp(directorState.deepZoneProgress / Math.max(1, gate.trueDeepZone), 0, 1);
  const sealScore = clamp((directorState.sealStability + 3) / (gate.trueSealStability + 3), 0, 1);
  const threatScore = clamp(1 - (Math.max(0, directorState.threatClock - gate.trueThreatMax) / 6), 0, 1);
  const weighted = (verifyScore * 0.28)
    + (recentVerifyScore * 0.12)
    + (plotScore * 0.2)
    + (deepScore * 0.16)
    + (sealScore * 0.14)
    + (threatScore * 0.1);
  return Math.round(weighted * 100);
};

const buildChongshanRiskLabel = (params: {
  directorState: DifficultyDirectorState;
  gate: EndingGateProfile;
}): string => {
  const { directorState, gate } = params;
  if (directorState.sealStability <= 0 || directorState.threatClock >= 5) {
    return '高';
  }
  if (
    directorState.strictVerificationActions < gate.trueVerifyActions - 1
    || directorState.deepZoneProgress < gate.trueDeepZone - 1
    || directorState.threatClock >= 4
  ) {
    return '中';
  }
  return '低';
};

const buildChongshanProgressHint = (params: {
  directorState: DifficultyDirectorState;
  gate: EndingGateProfile;
  turnNumber: number;
  maxTurns: number;
  isNearEndingWindow: boolean;
}): string => {
  const {
    directorState,
    gate,
    turnNumber,
    maxTurns,
    isNearEndingWindow,
  } = params;
  const gaps = buildChongshanGapLabels({ directorState, gate });
  const remainTurns = Math.max(0, maxTurns + ENDING_GRACE_TURNS - turnNumber);
  const closureScore = buildChongshanClosureScore({ directorState, gate });
  const riskLabel = buildChongshanRiskLabel({ directorState, gate });
  const advisory = buildChongshanProgressAdvisory({ directorState, gate });
  const summaryLine = `【阶段校验】核验:${directorState.strictVerificationActions}/${gate.trueVerifyActions} | 物证:${directorState.plotItemCount}/${gate.truePlotItems} | 深区:${directorState.deepZoneProgress}/${gate.trueDeepZone} | 封印稳定:${directorState.sealStability} | 威胁:${directorState.threatClock}/6`;
  const panelLine = `【闭环面板】闭环分:${closureScore}/100 | 风险:${riskLabel} | 剩余窗口:${remainTurns}回合`;
  const gapLine = gaps.length
    ? `【缺失项】${gaps.join('；')}`
    : '【缺失项】主闭环条件基本齐备，下一步优先执行最终核验并收束结局。';
  const advisoryLine = `【下一步】${advisory}`;
  const urgencyLine = isNearEndingWindow
    ? `【终章提醒】剩余可逆窗口约${remainTurns}回合，请立即补齐缺口后再尝试终结动作。`
    : `【节奏建议】当前回合数${turnNumber}/${maxTurns}，先补齐缺口再冲终章，成功率更高。`;
  return `${summaryLine}\n${panelLine}\n${gapLine}\n${advisoryLine}\n${urgencyLine}`;
};

const inferChongshanFallReasonCode = (params: ChongshanFallReasonContext): ChongshanFallReasonCode => {
  const {
    directorState,
    route,
    currentAction,
    projectedSanity,
    turnNumber,
    hardEndingTurn,
    hasEndingIntent,
    isModelEnding,
  } = params;

  if (projectedSanity <= 0) {
    return 'fall_sanity_depleted';
  }

  if (turnNumber >= hardEndingTurn) {
    return 'fall_deadline_exhausted';
  }

  const explicitConflictAction = textIncludesAny(currentAction, CHONGSHAN_EARLY_FATAL_ACTION_KEYWORDS);
  if ((turnNumber < directorState.minEndingTurn && isModelEnding) || explicitConflictAction) {
    return 'fall_rule_conflict';
  }

  if (hasEndingIntent && (directorState.strictVerificationActions < 3 || directorState.recentVerificationActions < 1)) {
    return 'fall_rule_chain_break';
  }

  if (directorState.sealStability <= 0 || directorState.threatClock >= 4) {
    return 'fall_unstable_seal';
  }

  if (isModelEnding) {
    return 'fall_rule_conflict';
  }

  if (!hasEndingIntent || route === 'unknown') {
    return 'fall_route_incomplete';
  }

  return 'fall_route_incomplete';
};

const buildChongshanFallEndingHint = (reasonCode: ChongshanFallReasonCode): string => {
  if (reasonCode === 'fall_unstable_seal') {
    return '结局判定：堕入结局「裂隙反涌」——封印阵列失稳，裂缝回涌吞没了你的撤离路径。';
  }
  if (reasonCode === 'fall_rule_chain_break') {
    return '结局判定：堕入结局「断链收束」——你抵达终局节点，却因关键闭环缺口被强制判入失败线。';
  }
  if (reasonCode === 'fall_rule_conflict') {
    return '结局判定：堕入结局「伪证闭环」——你用未核验规则强行收束流程，封印在最后一刻发生逆向反噬。';
  }
  return '结局判定：堕入结局「盲区回廊」——你在伪线索与迟滞行动中错过终章窗口，最终被医院重写为下一轮巡查样本。';
};

const buildChongshanFallCauseHint = (reasonCode: ChongshanFallReasonCode): string => {
  if (reasonCode === 'fall_sanity_depleted') {
    return '终局原因：理智值归零，污染在你完成闭环前先一步吞没了你。';
  }
  if (reasonCode === 'fall_deadline_exhausted') {
    return '终局原因：终章窗口耗尽，你仍未补齐闭环步骤，失败线已被锁定。';
  }
  if (reasonCode === 'fall_rule_chain_break') {
    return '终局原因：校验链断裂，关键核验步骤不足，导致终局判定直接滑向堕入线。';
  }
  if (reasonCode === 'fall_unstable_seal') {
    return '终局原因：封印稳定度不足且威胁时钟过高，当前路线已无可逆窗口。';
  }
  if (reasonCode === 'fall_rule_conflict') {
    return '终局原因：你触发了高危规则冲突，尽管理智尚存，结局仍被强制判死。';
  }
  return '终局原因：你的最终行动未形成有效路线，闭环条件不足，结局坠入失败线。';
};

const stripTerminalHints = (narrative: string): string => {
  return (narrative || '')
    .replace(/\n?<danger>\s*结局判定[:：][\s\S]*?<\/danger>/g, '')
    .replace(/\n?<danger>\s*终局原因[:：][\s\S]*?<\/danger>/g, '')
    .replace(/\n?结局判定[:：][^\n<]*/g, '')
    .replace(/\n?终局原因[:：][^\n<]*/g, '')
    .trim();
};

const sanitizeChongshanDefeatNarrative = (narrative: string): string => {
  let next = narrative;
  for (const { pattern, replacement } of CHONGSHAN_DEFEAT_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }
  return next;
};

const inferChongshanVictoryTierFromNarrative = (narrative: string): Exclude<ChongshanEndingTier, 'fall' | null> => {
  if (narrative.includes('完美结局')) return 'perfect';
  if (narrative.includes('及格结局')) return 'pass';
  return 'normal';
};

const normalizeChongshanTerminalNarrative = (params: {
  narrative: string;
  isGameOver: boolean;
  isVictory: boolean;
  victoryTier?: Exclude<ChongshanEndingTier, 'fall' | null> | null;
  fallReasonCode?: ChongshanFallReasonCode | null;
}): string => {
  const { isGameOver, isVictory } = params;

  if (!isGameOver) {
    return stripTerminalHints(params.narrative);
  }

  const base = stripTerminalHints(params.narrative);
  if (isVictory) {
    const victoryTier = params.victoryTier || inferChongshanVictoryTierFromNarrative(base);
    return appendNarrativeHint(base, buildChongshanEndingHint(victoryTier));
  }

  const fallReason = params.fallReasonCode || 'fall_route_incomplete';
  const sanitized = sanitizeChongshanDefeatNarrative(base);
  const withEnding = appendNarrativeHint(sanitized, buildChongshanFallEndingHint(fallReason));
  return appendNarrativeHint(withEnding, buildChongshanFallCauseHint(fallReason));
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

const getSanityPaceBand = (turnNumber: number, maxTurns: number): { min: number; max: number } => {
  const earlyTurn = Math.max(4, Math.floor(maxTurns * 0.35));
  const midTurn = Math.max(8, Math.floor(maxTurns * 0.7));
  if (turnNumber <= earlyTurn) {
    return { min: 65, max: 86 };
  }
  if (turnNumber <= midTurn) {
    return { min: 38, max: 68 };
  }
  return { min: 16, max: 52 };
};

const calibrateSanityChange = (params: {
  rawSanityChange: number;
  actionType: ActionType;
  currentSanity: number;
  turnNumber: number;
  maxTurns: number;
  currentAction: string;
  directorState: DifficultyDirectorState;
  gameConfig: GameConfig;
}): number => {
  const {
    rawSanityChange,
    actionType,
    currentSanity,
    turnNumber,
    maxTurns,
    currentAction,
    directorState,
    gameConfig,
  } = params;

  let tuned = Number.isFinite(rawSanityChange) ? rawSanityChange : 0;
  const explicitCoreViolation = textIncludesAny(currentAction, CHONGSHAN_EARLY_FATAL_ACTION_KEYWORDS);
  const isVerificationAction = textIncludesAny(currentAction, VERIFY_KEYWORDS);

  if (explicitCoreViolation) {
    tuned = clamp(tuned, gameConfig.sanityPenaltyFatal, Math.floor(gameConfig.sanityPenaltyFatal / 2));
  } else if (actionType === 'risky') {
    tuned = clamp(tuned, Math.max(gameConfig.sanityPenaltyRule, -18), -4);
  } else if (actionType === 'item') {
    tuned = clamp(tuned, -10, 2);
  } else {
    tuned = clamp(tuned, -8, 2);
  }

  const lowSanity = currentSanity <= 35;
  const shouldGiveBreather = !explicitCoreViolation
    && actionType !== 'risky'
    && (
      isVerificationAction
      || directorState.ruleVerificationProgress >= 1
      || turnNumber % 4 === 0
    );

  if (shouldGiveBreather && lowSanity) {
    tuned = Math.max(tuned, 1);
  } else if (shouldGiveBreather && currentSanity <= 55) {
    tuned = Math.max(tuned, 0);
  }

  let projected = clamp(currentSanity + tuned, 0, 100);
  if (!explicitCoreViolation) {
    const paceBand = getSanityPaceBand(turnNumber, maxTurns);
    if (projected < paceBand.min && actionType !== 'risky') {
      const recovery = Math.min(4, paceBand.min - projected);
      tuned += recovery;
      projected = clamp(currentSanity + tuned, 0, 100);
    }

    if (projected > paceBand.max && actionType === 'risky') {
      const extraPenalty = Math.min(3, projected - paceBand.max);
      tuned -= extraPenalty;
    }
  }

  return Math.round(clamp(tuned, gameConfig.sanityPenaltyFatal, 3));
};

const analyzeDifficultyDirectorState = (
  history: string[],
  currentAction: string,
  inventory: Evidence[],
  currentSanity: number,
  turnNumber: number,
  maxTurns: number,
  directorMode: 'default' | 'lab',
  storyTitle?: string | null,
  storySlug?: string | null,
): DifficultyDirectorState => {
  const actionRecords = parseChoiceRecordsFromHistory(history);
  const actionTypes = actionRecords.map((record) => record.actionType);
  const lastActionType = actionTypes[actionTypes.length - 1] || 'investigate';
  const riskyCount = actionTypes.filter((type) => type === 'risky').length;
  const consecutiveRisky = countTrailingAction(actionTypes, 'risky');
  const riskyRatio = actionTypes.length ? riskyCount / actionTypes.length : 0;

  const plotItemKeywords = buildPlotItemKeywords(storyTitle, storySlug);
  const plotItemCount = inventory.filter((item) => looksLikePlotItem(item, plotItemKeywords)).length;
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
  const strictEndingWindow = directorMode !== 'lab' || isChongshanStory(storyTitle, storySlug);
  const minEndingTurn = strictEndingWindow
    ? Math.max(11, maxTurns - 2)
    : Math.max(8, maxTurns - 3);

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

const buildDirectorContext = (
  state: DifficultyDirectorState,
  directorMode: 'default' | 'lab',
  storyTitle?: string | null,
  storySlug?: string | null,
): string => {
  const isLab = directorMode === 'lab';
  const gate = getEndingGateProfile(directorMode, storyTitle, storySlug);
  const profileLabel = isLab && gate.targetVictoryRateHint === '30%-45%'
    ? 'HIDDEN, LAB-BALANCED'
    : 'HIDDEN, STRICT';
  const canAttemptTrueEnding = state.plotItemCount >= gate.truePlotItems
    && state.strictVerificationActions >= gate.trueVerifyActions
    && state.recentVerificationActions >= gate.trueRecentVerifyActions
    && state.deepZoneProgress >= gate.trueDeepZone
    && (!isLab ? state.hasRitualIntent : true)
    && state.sealStability >= gate.trueSealStability
    && state.threatClock <= gate.trueThreatMax;
  const canAttemptEscapeEnding = state.hasExitIntent
    && state.strictVerificationActions >= gate.escapeVerifyActions
    && state.recentVerificationActions >= gate.escapeRecentVerifyActions
    && state.plotItemCount >= gate.escapePlotItems
    && state.sealStability >= gate.escapeSealStability
    && state.threatClock <= gate.escapeThreatMax;
  const knownRulesReliability = state.ruleVerificationProgress >= 2 ? 'MEDIUM/HIGH (部分已校验)' : 'LOW (多数守则尚未校验)';

  return `
Dynamic Difficulty Director (${profileLabel}):
- Threat Clock: ${state.threatClock}/6 (higher = environment pressure, blocked routes, fake clues)
- Seal Stability: ${state.sealStability} (<=0 means unstable seal, do NOT give clean victory)
- Rule Verification Progress: ${state.ruleVerificationProgress}/3
- Strict Verification Actions: ${state.strictVerificationActions} (hard gate for victory)
- Plot Item Count (excluding initial slip): ${state.plotItemCount}
- Clue Item Count: ${state.clueItemCount}
- Consecutive Risky Actions: ${state.consecutiveRisky}
- Minimum ending turn: ${state.minEndingTurn}
- Minimum victory turn floor (Chongshan hard rule): ${CHONGSHAN_MIN_VICTORY_TURN}
- Recent Verification Actions (last 4 turns): ${state.recentVerificationActions}
- Known Rules Reliability: ${knownRulesReliability}
- True Ending currently unlockable: ${canAttemptTrueEnding ? 'YES' : 'NO'}
- Escape Ending currently unlockable: ${canAttemptEscapeEnding ? 'YES' : 'NO'}

Director Constraints:
1) Do NOT treat all known rules as automatically true. At least one rule should be uncertain until verified by evidence cross-check.
2) From turn 4 onward, include a verification-oriented branch every turn until Strict Verification Actions >= ${gate.trueVerifyActions}.
3) Keep major evidence sparse: usually once every 3 turns unless player takes a high-risk verified route.
4) High Threat Clock should increase route denial / fake guidance / timing pressure, not just sanity damage.
5) Do NOT output victory before Minimum ending turn, and never before turn ${CHONGSHAN_MIN_VICTORY_TURN} in Chongshan mode. Early game_over is allowed only for irreversible fatal rule violations or sanity <= 0.
6) For this mode, target low victory rate (roughly ${gate.targetVictoryRateHint}) by enforcing hard ending gates.
7) If ending requirements are not met, do NOT output victory. Provide partial progress or failure outcome instead.`;
};

const applyDifficultyDirector = ({
  response,
  directorState,
  turnNumber,
  maxTurns,
  gameConfig,
  isOvertime,
  currentRules,
  inventory,
  currentAction,
  currentSanity,
  directorMode,
  storyTitle,
  storySlug,
}: DifficultyDirectorInput): GeminiResponse => {
  const isChongshan = isChongshanStory(storyTitle, storySlug);
  const gate = getEndingGateProfile(directorMode, storyTitle, storySlug);
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
  const plotItemKeywords = buildPlotItemKeywords(storyTitle, storySlug);
  tuned.sanity_change = calibrateSanityChange({
    rawSanityChange: Number(tuned.sanity_change) || 0,
    actionType,
    currentSanity,
    turnNumber,
    maxTurns,
    currentAction,
    directorState,
    gameConfig,
  });
  let projectedSanity = clamp(currentSanity + (Number(tuned.sanity_change) || 0), 0, 100);
  const expectedEvidenceCap = Math.max(2, Math.floor((turnNumber + 2) / 4) + 1);
  const allowHeavyDiscovery = actionType === 'risky' || (actionType === 'investigate' && directorState.strictVerificationActions >= 2);
  const isEvidenceWindow = turnNumber <= 2
    || turnNumber % 3 === 0
    || (actionType === 'risky' && directorState.strictVerificationActions >= 2 && turnNumber % 2 === 0);
  const hasCriticalEvidence = tuned.new_evidence.some((item) =>
    item.type === 'key'
    || item.type === 'item'
    || looksLikePlotItem(item, plotItemKeywords));
  const preserveCriticalEvidence = isChongshan
    && hasCriticalEvidence
    && (turnNumber >= directorState.minEndingTurn - 2 || actionType === 'risky');

  if (tuned.new_evidence.length > 0 && !isEvidenceWindow && !preserveCriticalEvidence) {
    tuned.new_evidence = [buildDecoyEvidence(turnNumber)];
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你拿到的是一份看似关键却互相矛盾的记录，它会拖慢判断。');
  }

  if (tuned.new_evidence.length > 0 && directorState.threatClock >= 4 && actionType !== 'risky' && !preserveCriticalEvidence) {
    tuned.new_evidence = [buildDecoyEvidence(turnNumber)];
    tuned.narrative = appendNarrativeHint(tuned.narrative, '威胁升级后，低风险搜查只会回收被投放的伪线索。');
  }

  if (tuned.new_evidence.length > 0 && inventory.length >= expectedEvidenceCap && !allowHeavyDiscovery && !preserveCriticalEvidence) {
    tuned.new_evidence = [buildDecoyEvidence(turnNumber)];
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你翻找到的只是互相矛盾的旧记录，尚不足以形成新线索。');
  }

  const expectedRuleCap = Math.max(3, Math.floor(turnNumber / 3) + 1);
  if (tuned.new_rules.length > 0 && currentRules.length >= expectedRuleCap && actionType !== 'investigate' && actionType !== 'item') {
    tuned.new_rules = [];
  }

  const canAttemptTrueEnding = directorState.plotItemCount >= gate.truePlotItems
    && directorState.strictVerificationActions >= gate.trueVerifyActions
    && directorState.recentVerificationActions >= gate.trueRecentVerifyActions
    && directorState.deepZoneProgress >= gate.trueDeepZone
    && directorState.sealStability >= gate.trueSealStability
    && directorState.threatClock <= gate.trueThreatMax;
  const canAttemptEscapeEnding = directorState.hasExitIntent
    && directorState.strictVerificationActions >= gate.escapeVerifyActions
    && directorState.recentVerificationActions >= gate.escapeRecentVerifyActions
    && directorState.plotItemCount >= gate.escapePlotItems
    && directorState.sealStability >= gate.escapeSealStability
    && directorState.threatClock <= gate.escapeThreatMax;
  const hasEndingIntent = textIncludesAny(currentAction, ENDING_ACTION_KEYWORDS) || textIncludesAny(tuned.narrative, ENDING_ACTION_KEYWORDS);
  const baseAllowVictory = turnNumber >= directorState.minEndingTurn
    && hasEndingIntent
    && directorState.sealStability >= gate.allowVictorySealFloor
    && (canAttemptTrueEnding || canAttemptEscapeEnding);
  const emergencyAllowVictory = turnNumber >= maxTurns
    && hasEndingIntent
    && directorState.plotItemCount >= Math.max(1, gate.escapePlotItems - 1)
    && directorState.strictVerificationActions >= Math.max(1, gate.escapeVerifyActions - 1)
    && directorState.sealStability >= -1;
  const allowVictory = baseAllowVictory || emergencyAllowVictory;

  const isPrematureEnding = tuned.is_game_over && !isOvertime && turnNumber < directorState.minEndingTurn && projectedSanity > 0;
  const allowPrematureFailure = isChongshan
    && tuned.is_game_over
    && !tuned.is_victory
    && shouldAllowChongshanPrematureFailure({
      currentAction,
      narrative: tuned.narrative,
      directorState,
    });
  if (isPrematureEnding && !allowPrematureFailure) {
    tuned.is_game_over = false;
    tuned.is_victory = false;
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你还没完成最基本的封印校验，现在收束只会导致误判。');
  } else if (isPrematureEnding && allowPrematureFailure) {
    tuned.is_game_over = true;
    tuned.is_victory = false;
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你触发了不可逆规则冲突，中盘提前坠入失败线。');
  }

  let lockedChongshanVictory = false;
  let resolvedChongshanVictoryTier: Exclude<ChongshanEndingTier, 'fall' | null> | null = null;
  let resolvedChongshanFallReason: ChongshanFallReasonCode | null = null;
  let pendingRescueChoices: Choice[] | null = null;
  let rescueWindowOpened = false;
  if (isChongshan) {
    const modelSignaledEnding = tuned.is_game_over;
    const chongshanRoute = detectChongshanRoute(currentAction);
    const fallContextBase: ChongshanFallReasonContext = {
      directorState,
      route: chongshanRoute,
      currentAction,
      projectedSanity,
      turnNumber,
      hardEndingTurn,
      hasEndingIntent,
      isModelEnding: modelSignaledEnding,
    };
    const tier = resolveChongshanEndingTier({
      directorState,
      currentAction,
      turnNumber,
      projectedSanity,
      hardEndingTurn,
      hasEndingIntent,
      isModelEnding: modelSignaledEnding,
    });
    if (tier === 'perfect' || tier === 'normal' || tier === 'pass') {
      tuned.is_game_over = true;
      tuned.is_victory = true;
      resolvedChongshanVictoryTier = tier;
      tuned.narrative = appendNarrativeHint(tuned.narrative, buildChongshanEndingHint(tier));
      lockedChongshanVictory = true;
    } else if (tier === 'fall') {
      resolvedChongshanFallReason = inferChongshanFallReasonCode(fallContextBase);
      const rescueAlreadyUsed = hasRescueActionInHistory(directorState) || hasRescueAction(currentAction);
      const canOpenRescueWindow = !rescueAlreadyUsed
        && !isOvertime
        && projectedSanity > 0
        && turnNumber < hardEndingTurn
        && turnNumber <= directorState.minEndingTurn + CHONGSHAN_RESCUE_WINDOW_TURNS
        && (resolvedChongshanFallReason === 'fall_rule_chain_break' || resolvedChongshanFallReason === 'fall_rule_conflict');

      if (canOpenRescueWindow) {
        tuned.is_game_over = false;
        tuned.is_victory = false;
        rescueWindowOpened = true;
        pendingRescueChoices = buildChongshanRescueChoices(resolvedChongshanFallReason);
        tuned.narrative = appendNarrativeHint(
          tuned.narrative,
          `补救窗口已开启：当前失败原因为${resolvedChongshanFallReason === 'fall_rule_chain_break' ? '校验链断裂' : '规则冲突'}，你还有1次补链机会。`,
        );
        tuned.narrative = appendNarrativeHint(
          tuned.narrative,
          '请优先执行带【补救链】或【补救冲突】标记的动作，成功后可恢复终章判定资格。',
        );
        resolvedChongshanFallReason = null;
      } else {
        tuned.is_game_over = true;
        tuned.is_victory = false;
        tuned.narrative = appendNarrativeHint(tuned.narrative, buildChongshanFallEndingHint(resolvedChongshanFallReason));
        tuned.narrative = appendNarrativeHint(tuned.narrative, buildChongshanFallCauseHint(resolvedChongshanFallReason));
      }
    }
  }

  if (isChongshan && !tuned.is_game_over) {
    const missingCoreProgress = directorState.strictVerificationActions < gate.trueVerifyActions
      || directorState.recentVerificationActions < gate.trueRecentVerifyActions
      || directorState.plotItemCount < gate.truePlotItems
      || directorState.deepZoneProgress < gate.trueDeepZone;
    const shouldInjectProgressHint = turnNumber >= CHONGSHAN_PROGRESS_HINT_START_TURN
      && (missingCoreProgress || turnNumber <= CHONGSHAN_PROGRESS_HINT_END_TURN || turnNumber >= directorState.minEndingTurn - 1);
    if (shouldInjectProgressHint) {
      tuned.narrative = appendNarrativeHint(tuned.narrative, buildChongshanProgressHint({
        directorState,
        gate,
        turnNumber,
        maxTurns,
        isNearEndingWindow: turnNumber >= directorState.minEndingTurn - 1,
      }));
    }
  }

  if (isChongshan && tuned.is_victory && turnNumber < CHONGSHAN_MIN_VICTORY_TURN) {
    tuned.is_victory = false;
    tuned.is_game_over = false;
    lockedChongshanVictory = false;
    tuned.narrative = appendNarrativeHint(tuned.narrative, `回合数不足，胜利判定被驳回（崇山最低胜利回合：${CHONGSHAN_MIN_VICTORY_TURN}）。`);
  }

  if (tuned.is_victory && !allowVictory && !lockedChongshanVictory) {
    tuned.is_victory = false;
    tuned.is_game_over = turnNumber >= hardEndingTurn || projectedSanity <= 0;
    resolvedChongshanVictoryTier = null;
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你突然意识到：封印校验步骤尚未完成，贸然收束只会让裂缝反扑。');
  }

  const isRushEndingPhase = turnNumber >= maxTurns - 1 && !tuned.is_game_over;
  if (isRushEndingPhase) {
    tuned.narrative = appendNarrativeHint(
      tuned.narrative,
      `终章冲刺已开始：请在剩余${Math.max(0, hardEndingTurn - turnNumber)}回合内做出最终抉择，故事必须收束到胜利或死亡。`,
    );
    tuned.choices = ensureChoiceShape(buildEndgameChoices({
      storyTitle,
      storySlug,
      currentAction,
      currentRules,
      inventory,
      locationName: tuned.location_name,
    }), tuned.location_name);
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
    && directorState.strictVerificationActions < gate.trueVerifyActions
    && !hasVerificationChoice(tuned.choices);
  if (shouldInjectVerificationChoice) {
    const verificationChoice = buildVerificationChoice();
    const replaceIndex = tuned.choices.findIndex((choice) => choice.actionType === 'move');
    const targetIndex = replaceIndex >= 0 ? replaceIndex : tuned.choices.length - 1;
    tuned.choices[targetIndex] = verificationChoice;

    if (directorState.strictVerificationActions <= 2) {
      const secondaryChoice = buildVerificationItemChoice();
      const secondaryIndex = tuned.choices.findIndex(
        (choice, index) => index !== targetIndex
          && choice.actionType !== 'risky'
          && !textIncludesAny(choice.text, VERIFY_KEYWORDS),
      );
      if (secondaryIndex >= 0) {
        tuned.choices[secondaryIndex] = secondaryChoice;
      }
    }
  }

  const shouldInjectDeepZoneChoice = isChongshan
    && !tuned.is_game_over
    && turnNumber >= CHONGSHAN_DEEP_ZONE_PUSH_TURN
    && directorState.deepZoneProgress < gate.trueDeepZone
    && !hasDeepZoneChoice(tuned.choices);
  if (shouldInjectDeepZoneChoice) {
    const deepZoneChoice = buildDeepZoneChoice(directorState.deepZoneProgress);
    const replaceIndex = tuned.choices.findIndex((choice) =>
      choice.actionType !== 'risky'
      && !textIncludesAny(choice.text, VERIFY_KEYWORDS)
      && !textIncludesAny(choice.text, ENDING_ACTION_KEYWORDS));
    const targetIndex = replaceIndex >= 0 ? replaceIndex : tuned.choices.length - 1;
    tuned.choices[targetIndex] = deepZoneChoice;
    tuned.narrative = appendNarrativeHint(tuned.narrative, '主线仍卡在深区推进，先进入东楼/地下二层补齐关键定位再尝试终局。');
  }

  if (pendingRescueChoices && !tuned.is_game_over) {
    tuned.choices = ensureChoiceShape(pendingRescueChoices, tuned.location_name);
    if (!rescueWindowOpened) {
      tuned.narrative = appendNarrativeHint(tuned.narrative, '补救窗口触发：请先完成补链动作，再继续终局推进。');
    }
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

  if (projectedSanity <= 0 && !tuned.is_victory) {
    tuned.is_game_over = true;
    tuned.is_victory = false;
    if (isChongshan && !resolvedChongshanFallReason) {
      resolvedChongshanFallReason = inferChongshanFallReasonCode({
        directorState,
        route: detectChongshanRoute(currentAction),
        currentAction,
        projectedSanity,
        turnNumber,
        hardEndingTurn,
        hasEndingIntent,
        isModelEnding: true,
      });
    }
  }

  if (isChongshan) {
    if (tuned.is_game_over && !tuned.is_victory && !resolvedChongshanFallReason) {
      resolvedChongshanFallReason = inferChongshanFallReasonCode({
        directorState,
        route: detectChongshanRoute(currentAction),
        currentAction,
        projectedSanity,
        turnNumber,
        hardEndingTurn,
        hasEndingIntent,
        isModelEnding: tuned.is_game_over,
      });
    }
    tuned.narrative = normalizeChongshanTerminalNarrative({
      narrative: tuned.narrative,
      isGameOver: tuned.is_game_over,
      isVictory: tuned.is_victory,
      victoryTier: resolvedChongshanVictoryTier,
      fallReasonCode: resolvedChongshanFallReason,
    });
  }

  tuned.choices = tuned.is_game_over ? [] : ensureChoiceShape(tuned.choices, tuned.location_name);
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
  systemInstructionOverride,
  outputLocale = 'zh-CN',
  isOvertime = false,
  labMode = false,
  storyTitle,
  storySlug,
}: GenerateTurnInput): Promise<GeminiResponse> => {
  const effectiveApiKey = apiKey || process.env.API_KEY;
  if (!effectiveApiKey) {
    throw new Error('API Key not found');
  }

  const systemInstruction = (systemInstructionOverride || '').trim() || buildSystemInstruction(gameConfig);
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
    storyTitle,
    storySlug,
  );
  const directorContext = buildDirectorContext(directorState, directorMode, storyTitle, storySlug);

  const prompt = `
Current Turn Number: ${turnNumber} / Target: ${gameConfig.maxTurns}
Game Phase: ${gamePhase}
Current Sanity: ${currentSanity}/100
Target Output Locale: ${outputLocale}

${rulesContext}

${inventoryContext}

${directorContext}

Previous History:
${history.join('\n')}

Player Action: ${currentAction}

Locale constraint:
- Use locale ${outputLocale} for all player-visible text fields.
- Keep JSON keys and enum values unchanged.
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

  const effectiveProvider = provider;

  if (effectiveProvider === 'gemini') {
    const options: any = { apiKey: effectiveApiKey };
    if (baseUrl) {
      options.httpOptions = { baseUrl: baseUrl.replace(/\/+$/, '') };
    }

    const ai = new GoogleGenAI(options);
    const response = await ai.models.generateContent({
      model: model || 'gemini-3-flash-preview',
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
      gameConfig,
      isOvertime,
      currentRules,
      inventory,
      currentAction,
      currentSanity,
      directorMode,
      storyTitle,
      storySlug,
    });
  }

  if (!baseUrl) {
    throw new Error('Base URL required for OpenAI provider');
  }

  const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
  const openAiModel = model || 'gpt-3.5-turbo';
  const baseMessages: OpenAIChatMessage[] = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: `${prompt}\n\nIMPORTANT: You must respond in valid JSON format matching the schema.` },
  ];
  let lastRawText = '';
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= TURN_JSON_MAX_ATTEMPTS; attempt += 1) {
    const isRepairAttempt = attempt > 1;
    const messages: OpenAIChatMessage[] = isRepairAttempt
      ? [
          { role: 'system', content: `${systemInstruction}\n\nYou are in strict JSON repair mode. Return JSON only.` },
          { role: 'user', content: buildTurnJsonRepairPrompt(lastRawText, outputLocale) },
        ]
      : baseMessages;

    try {
      const jsonText = await requestOpenAIJsonCompletion({
        cleanUrl,
        apiKey: effectiveApiKey,
        model: openAiModel,
        messages,
        temperature: isRepairAttempt ? 0 : 0.8,
      });
      lastRawText = jsonText;
      const parsed = parseModelJsonResponse<GeminiResponse>(jsonText, 'Invalid JSON from OpenAI provider');
      return applyDifficultyDirector({
        response: parsed,
        directorState,
        turnNumber,
        maxTurns: gameConfig.maxTurns,
        gameConfig,
        isOvertime,
        currentRules,
        inventory,
        currentAction,
        currentSanity,
        directorMode,
        storyTitle,
        storySlug,
      });
    } catch (error: any) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      const isInvalidJsonError = err.message.includes('Invalid JSON');
      const shouldBackoff = !isInvalidJsonError && isTransientOpenAIError(err.message);
      console.warn('[turn-generate] openai attempt failed', {
        attempt,
        openAiModel,
        isRepairAttempt,
        isInvalidJsonError,
        shouldBackoff,
        message: err.message,
        rawPreview: previewText(lastRawText || ''),
      });

      if (attempt >= TURN_JSON_MAX_ATTEMPTS) {
        throw err;
      }

      if (shouldBackoff) {
        const delayMs = computeOpenAIRetryDelayMs(attempt);
        console.warn('[turn-generate] openai transient backoff', {
          attempt,
          delayMs,
          message: err.message,
        });
        await sleepMs(delayMs);
      }
    }
  }

  throw lastError || new Error('Turn generation failed after retries');
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
