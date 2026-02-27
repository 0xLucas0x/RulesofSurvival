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

const resolveBoundedIntEnv = (
  envName: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = Number.parseInt(process.env[envName] || '', 10);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, raw));
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
  apiKey?: string;
  model: string;
  messages: OpenAIChatMessage[];
  temperature: number;
}): Promise<string> => {
  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (normalizedApiKey) {
    headers.Authorization = `Bearer ${normalizedApiKey}`;
  }

  const response = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers,
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
  investigateRatio: number;
  consecutiveInvestigate: number;
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
  recentMoveActions: number;
  recentItemActions: number;
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

const resolveChoiceLocationAnchor = (locationName: string): string => {
  const location = (locationName || '').trim();
  if (!location) {
    return '你所在的走廊';
  }
  return location.includes('崇山医院') ? location.replace('崇山医院 - ', '') : location;
};

const buildVerificationChoice = (params: { turnNumber: number; locationName: string }): Choice => {
  const anchor = resolveChoiceLocationAnchor(params.locationName);
  const variants = [
    `先在${anchor}把守则与物证对齐，确认哪条警告值得信。`,
    `回看${anchor}附近的记录与口供，确认下一步该信哪条线。`,
    `贴着${anchor}复盘刚拿到的线索，先排除一条明显假指引。`,
  ];
  return {
    id: 'verify',
    text: variants[params.turnNumber % variants.length],
    actionType: 'investigate',
  };
};

const buildVerificationItemChoice = (params: { turnNumber: number; locationName: string }): Choice => {
  const anchor = resolveChoiceLocationAnchor(params.locationName);
  const variants = [
    `把手上的物证按时间顺序摊开，在${anchor}做一次交叉比对后再推进。`,
    `用随身物件复核${anchor}门旁标记，确认哪条线索不是诱饵。`,
    `先拿现有物证做一次回读，看看${anchor}这段是否被伪线索改写过。`,
  ];
  return {
    id: 'verify_item',
    text: variants[params.turnNumber % variants.length],
    actionType: 'item',
  };
};

const hasStabilizeChoice = (choices: Choice[]): boolean => {
  return choices.some((choice) => textIncludesAny(choice.text, ['稳封', '稳定', '压低威胁', '锚点', '封缝']));
};

const buildStabilizeChoice = (params: { turnNumber: number; locationName: string }): Choice => {
  const anchor = resolveChoiceLocationAnchor(params.locationName);
  const variants = [
    `先在${anchor}完成一次稳封操作，把躁动压住再决定是否冲刺。`,
    `用关键物件在${anchor}执行封缝步骤，先换一口稳定窗口。`,
    `先稳住${anchor}的封印节奏，再决定要不要冒险推进。`,
  ];
  return {
    id: 'stabilize',
    text: variants[params.turnNumber % variants.length],
    actionType: 'item',
  };
};

const buildLateBranchingHint = (): string => {
  return '两股声音在走廊里拉扯你：一边催你立刻冲出去，一边逼你先把封缝压稳。再犹豫，医院会替你选一条更糟的路。';
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
      { id: 'rescue_chain_1', text: '沿回闪脚印退回核验点，把缺的那步证据链补齐。', actionType: 'investigate' },
      { id: 'rescue_chain_2', text: '拿现有关键物件重做一次封缝执行，再尝试落终结动作。', actionType: 'item' },
      { id: 'rescue_chain_3', text: '先后撤到低噪区稳住呼吸，再二次推进。', actionType: 'move' },
    ];
  }
  if (reasonCode === 'fall_route_incomplete') {
    return [
      { id: 'rescue_route_1', text: '回到分岔门廊，对照墙上标记和手头证据，确认哪扇门是真路。', actionType: 'investigate' },
      { id: 'rescue_route_2', text: '把关键物证接入门旁终端，试一次通道回读，逼出可走路线。', actionType: 'item' },
      { id: 'rescue_route_3', text: '放弃眼前伪出口，转入东楼地下段重新定坐标。', actionType: 'move' },
    ];
  }
  if (reasonCode === 'fall_unstable_seal') {
    return [
      { id: 'rescue_seal_1', text: '立刻折返控制桥重锁锚点，先把封印按住一拍。', actionType: 'item' },
      { id: 'rescue_seal_2', text: '核对阀位与广播节奏，找出刚才让封印失稳的那一步。', actionType: 'investigate' },
      { id: 'rescue_seal_3', text: '短撤到低噪区压低威胁，再回来执行收束。', actionType: 'move' },
    ];
  }
  return [
    { id: 'rescue_conflict_1', text: '先停下高危动作，对照冲突规则，撤销刚触发的禁忌步骤。', actionType: 'investigate' },
    { id: 'rescue_conflict_2', text: '把当前证据送去回读节点，重建这段执行链。', actionType: 'item' },
    { id: 'rescue_conflict_3', text: '快速脱离冲突区，绕行到东楼地下段重新对位。', actionType: 'move' },
  ];
};

const hasDeepZoneChoice = (choices: Choice[]): boolean => {
  return choices.some((choice) => textIncludesAny(choice.text, DEEP_ZONE_KEYWORDS));
};

const buildDeepZoneChoice = (deepZoneProgress: number): Choice => {
  if (deepZoneProgress <= 1) {
    return {
      id: 'deep_zone_push',
      text: '立刻转入东楼地下段，先确认地下二层入口的真实位置。',
      actionType: 'move',
    };
  }
  return {
    id: 'deep_zone_push',
    text: '继续下潜到地下二层核心区，把裂缝锚点位置最后确认一遍。',
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
    const anchor = resolveChoiceLocationAnchor(params.locationName);
    return [
      { id: 'end_1', text: `沿着${anchor}再推进一步，确认真正可走的通道。`, actionType: 'move' },
      { id: 'end_2', text: `先在${anchor}做最后一次守则-证据核对，避免走错终局分叉。`, actionType: 'investigate' },
      { id: 'end_3', text: `用关键物件在${anchor}执行封缝步骤，先稳住再决定撤离。`, actionType: 'item' },
      { id: 'end_4', text: '趁红衣护士换位时硬闯分岔口，赌一次速通；失手会被当场反扑。', actionType: 'risky' },
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
    { id: 'end_2', text: `携带关键物件前往${coreTarget}，把最后一道封缝做完`, actionType: 'risky' },
    { id: 'end_3', text: `先核对${verifyTarget}与现行规则冲突，再落下最终决断`, actionType: 'investigate' },
  ];
};

const pickChoiceByKeywords = (choices: Choice[], keywords: string[]): Choice | null => {
  return choices.find((choice) => textIncludesAny(choice.text, keywords)) || null;
};

const rebalanceLatePhaseChoices = (params: {
  choices: Choice[];
  locationName: string;
  turnNumber: number;
}): Choice[] => {
  const { choices, locationName, turnNumber } = params;
  const anchor = resolveChoiceLocationAnchor(locationName);
  const riskyConsequence = turnNumber % 2 === 0 ? '失手会被当场反扑' : '失手会被直接拖入裂缝';
  const movePool = choices.filter((choice) => choice.actionType === 'move');
  const investigatePool = choices.filter((choice) => choice.actionType === 'investigate');
  const itemPool = choices.filter((choice) => choice.actionType === 'item');
  const riskyPool = choices.filter((choice) => choice.actionType === 'risky');

  const advanceChoice = pickChoiceByKeywords(movePool, ['前往', '走', '转入', '下潜', '入口', '通道', '楼梯', '东楼', '地下'])
    || movePool[0]
    || {
      id: 'late_move',
      text: `沿着${anchor}继续前压，确认真正可走的通道。`,
      actionType: 'move' as const,
    };
  const verifyChoice = pickChoiceByKeywords(investigatePool, ['核对', '比对', '验证', '确认', '守则', '证据', '记录'])
    || investigatePool[0]
    || {
      id: 'late_verify',
      text: `先在${anchor}把守则与物证对齐，确认哪条警告值得信。`,
      actionType: 'investigate' as const,
    };
  const executeChoice = pickChoiceByKeywords(itemPool, ['钥匙', '门禁', '封缝', '重锁', '阀位', '锚点', '终端', '执行'])
    || itemPool[0]
    || {
      id: 'late_execute',
      text: `用关键物件在${anchor}执行一次封缝步骤，先稳住再冲刺。`,
      actionType: 'item' as const,
    };
  const riskyChoice = pickChoiceByKeywords(riskyPool, ['冒险', '硬闯', '赌', '速通', '失手', '反扑'])
    || riskyPool[0]
    || {
      id: 'late_risky',
      text: `趁红衣护士换位时硬闯分岔口，赌一次速通；${riskyConsequence}。`,
      actionType: 'risky' as const,
    };

  const picked: Choice[] = [];
  const usedText = new Set<string>();
  for (const choice of [advanceChoice, verifyChoice, executeChoice, riskyChoice]) {
    if (!usedText.has(choice.text)) {
      usedText.add(choice.text);
      picked.push(choice);
    }
  }
  return picked;
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

type ChongshanFallHintContext = {
  directorState: DifficultyDirectorState;
  route: ChongshanRoute;
  hasEndingIntent: boolean;
  gate: EndingGateProfile;
  turnNumber: number;
  hardEndingTurn: number;
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
const CHONGSHAN_MIN_VICTORY_TURN = resolveBoundedIntEnv('CHONGSHAN_MIN_VICTORY_TURN', 10, 8, 14);
const CHONGSHAN_PROGRESS_HINT_START_TURN = resolveBoundedIntEnv('CHONGSHAN_PROGRESS_HINT_START_TURN', 7, 4, 12);
const CHONGSHAN_PROGRESS_HINT_END_TURN = resolveBoundedIntEnv('CHONGSHAN_PROGRESS_HINT_END_TURN', 10, 6, 14);
const CHONGSHAN_DEEP_ZONE_PUSH_TURN = resolveBoundedIntEnv('CHONGSHAN_DEEP_ZONE_PUSH_TURN', 8, 5, 12);
const CHONGSHAN_RESCUE_WINDOW_TURNS = resolveBoundedIntEnv('CHONGSHAN_RESCUE_WINDOW_TURNS', 2, 1, 4);
const CHONGSHAN_UNSTABLE_RESCUE_PREEMPT_TURN_OFFSET = resolveBoundedIntEnv('CHONGSHAN_UNSTABLE_RESCUE_PREEMPT_TURN_OFFSET', 1, 0, 3);
const CHONGSHAN_SAFE_CHOICE_ENFORCE_WINDOW = resolveBoundedIntEnv('CHONGSHAN_SAFE_CHOICE_ENFORCE_WINDOW', 4, 2, 6);
const CHONGSHAN_ENDING_ACTION_WINDOW_TURNS = resolveBoundedIntEnv('CHONGSHAN_ENDING_ACTION_WINDOW_TURNS', 6, 4, 10);
const CHONGSHAN_ENDING_MIN_MOVE_ACTIONS = resolveBoundedIntEnv('CHONGSHAN_ENDING_MIN_MOVE_ACTIONS', 1, 0, 3);
const CHONGSHAN_ENDING_MIN_ITEM_ACTIONS = resolveBoundedIntEnv('CHONGSHAN_ENDING_MIN_ITEM_ACTIONS', 1, 0, 3);
const CHONGSHAN_INVESTIGATE_STREAK_SOFT_CAP = resolveBoundedIntEnv('CHONGSHAN_INVESTIGATE_STREAK_SOFT_CAP', 4, 2, 8);
const CHONGSHAN_INVESTIGATE_VERIFY_DECAY_STEP = resolveBoundedIntEnv('CHONGSHAN_INVESTIGATE_VERIFY_DECAY_STEP', 2, 1, 4);
const CHONGSHAN_INVESTIGATE_THREAT_STEP = resolveBoundedIntEnv('CHONGSHAN_INVESTIGATE_THREAT_STEP', 2, 1, 4);
const CHONGSHAN_PROGRESS_HINT_NUMERIC = ['1', 'true', 'yes', 'on'].includes(
  (process.env.CHONGSHAN_PROGRESS_HINT_NUMERIC || '').trim().toLowerCase(),
);
const CHONGSHAN_RESCUE_ACTION_KEYWORDS = [
  '证据链补齐',
  '封缝执行',
  '分岔门廊',
  '门旁终端',
  '控制桥',
  '禁忌步骤',
  '低噪区',
  '重定坐标',
];
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
    return '完美结局「封印重启」：你把最后一枚环扣上，裂缝像潮水一样倒卷回去，东楼第一次安静下来。';
  }
  if (tier === 'normal') {
    return '普通结局「残缺封印」：主封印勉强立住了，你活了下来，却丢失了自己的一部分。';
  }
  if (tier === 'pass') {
    return '及格结局「带伤逃离」：你带着伤离开了医院，身后那道封印仍在缓慢衰减。';
  }
  return '堕入结局「红衣轮值」：校验链断在你手里，你被留在这条轮值线上。';
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
  const hasStructuredActionMix = directorState.recentMoveActions >= CHONGSHAN_ENDING_MIN_MOVE_ACTIONS
    && directorState.recentItemActions >= CHONGSHAN_ENDING_MIN_ITEM_ACTIONS;
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
  const meetsStructuredVictory = meetsAnyVictoryTier && hasStructuredActionMix;
  if (canAwardVictory && hasStructuredActionMix && meetsPerfect) return 'perfect';
  if (canAwardVictory && hasStructuredActionMix && (meetsNormalSeal || meetsNormalVerify)) return 'normal';
  if (canAwardVictory && hasStructuredActionMix && meetsPassEscape) return 'pass';

  const mustResolveNow = turnNumber >= hardEndingTurn || projectedSanity <= 0 || isModelEnding;
  if ((reachedEndingWindow && hasEndingIntent && !meetsStructuredVictory) || mustResolveNow) {
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
    gaps.push(verifyGap >= 3 ? '你手里的证词与痕迹还没连成一条能站住的路' : '最后那段证据回路还没扣上');
  }

  const recentVerifyGap = gate.trueRecentVerifyActions - directorState.recentVerificationActions;
  if (recentVerifyGap > 0) {
    gaps.push('最近几步太急，关键细节还没被反复坐实');
  }

  const moveGap = CHONGSHAN_ENDING_MIN_MOVE_ACTIONS - directorState.recentMoveActions;
  if (moveGap > 0) {
    gaps.push('你还没有换过关键落脚点，路径真假仍混在一起');
  }

  const itemGap = CHONGSHAN_ENDING_MIN_ITEM_ACTIONS - directorState.recentItemActions;
  if (itemGap > 0) {
    gaps.push('还缺一次真正的执行动作，封缝仍停在纸面上');
  }

  const plotItemGap = gate.truePlotItems - directorState.plotItemCount;
  if (plotItemGap > 0) {
    gaps.push(plotItemGap >= 3 ? '线索像被人故意拆散，关键物证还不够成形' : '还差最后一件能压住局面的物证');
  }

  const deepZoneGap = gate.trueDeepZone - directorState.deepZoneProgress;
  if (deepZoneGap > 0) {
    gaps.push(deepZoneGap >= 2 ? '深区坐标还在漂，像被暗处不断改写' : '深区位置只差最后一次对位');
  }

  const sealGap = gate.trueSealStability - directorState.sealStability;
  if (sealGap > 0) {
    gaps.push(sealGap >= 2 ? '封印还在抖，像随时会被反噬掀开' : '封印只差一口气才能稳住');
  }

  const threatDrop = directorState.threatClock - gate.trueThreatMax;
  if (threatDrop > 0) {
    gaps.push(threatDrop >= 2 ? '红衣的气息压得太近，走廊随时会换路' : '威胁刚越线，再慢一步就会被逼进岔路');
  }

  return gaps;
};

const buildChongshanProgressAdvisory = (params: {
  directorState: DifficultyDirectorState;
  gate: EndingGateProfile;
}): string => {
  const { directorState, gate } = params;
  if (directorState.recentMoveActions < CHONGSHAN_ENDING_MIN_MOVE_ACTIONS) {
    return '先换一个落脚点，再确认通道有没有变形。';
  }
  if (directorState.recentItemActions < CHONGSHAN_ENDING_MIN_ITEM_ACTIONS) {
    return '先做一次封缝执行，再决定要不要冲。';
  }
  if (directorState.strictVerificationActions < gate.trueVerifyActions) {
    return '把规则、物证和位置再对一轮。';
  }
  if (directorState.deepZoneProgress < gate.trueDeepZone) {
    return '先下到东楼地下段，把深区坐标钉死。';
  }
  if (directorState.plotItemCount < gate.truePlotItems) {
    return '先补齐关键物证，再谈收束。';
  }
  if (directorState.sealStability < gate.trueSealStability) {
    return '先稳住封印，再决定冲刺还是撤离。';
  }
  if (directorState.threatClock > gate.trueThreatMax) {
    return '先压低追势，再碰高风险动作。';
  }
  return '你可以准备最后一次对位。';
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
  const pressureLine = CHONGSHAN_PROGRESS_HINT_NUMERIC
    ? `局势：核验${directorState.strictVerificationActions}/${gate.trueVerifyActions}，物证${directorState.plotItemCount}/${gate.truePlotItems}，深区${directorState.deepZoneProgress}/${gate.trueDeepZone}，稳${directorState.sealStability}，威胁${directorState.threatClock}/6。`
    : closureScore >= 70
      ? '回声暂时平稳，但错门还在移动。'
      : closureScore >= 45
        ? '低语在换位，这条路还能走，但容错很窄。'
        : '指示开始互相矛盾，像有东西在把你引向错门。';
  const focusLine = gaps.length
    ? `先稳住这一环：${gaps[0]}。`
    : '主链基本咬合，接下来就是最后一次对位。';
  const directiveLine = `现在先做这一步：${advisory}`;
  const urgencyLine = isNearEndingWindow
    ? `红灯在加速熄灭，再拖${remainTurns}步，门会替你决定。`
    : '';
  return urgencyLine
    ? `${pressureLine}\n${focusLine}\n${directiveLine}\n${urgencyLine}`
    : `${pressureLine}\n${focusLine}\n${directiveLine}`;
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

const isHighProgressRecoverableState = (params: {
  directorState: DifficultyDirectorState;
  gate: EndingGateProfile;
}): boolean => {
  const { directorState, gate } = params;
  const verifyReady = directorState.strictVerificationActions >= Math.max(3, gate.trueVerifyActions - 1);
  const recentVerifyReady = directorState.recentVerificationActions >= Math.max(1, gate.trueRecentVerifyActions);
  const itemReady = directorState.plotItemCount >= Math.max(2, gate.truePlotItems - 1);
  const deepZoneReady = directorState.deepZoneProgress >= Math.max(1, gate.trueDeepZone - 1);
  const sealRecoverable = directorState.sealStability >= Math.max(-1, gate.trueSealStability - 2);
  return verifyReady && recentVerifyReady && itemReady && deepZoneReady && sealRecoverable;
};

const isNearMissRouteOrChain = (params: {
  reasonCode: ChongshanFallReasonCode;
  directorState: DifficultyDirectorState;
  gate: EndingGateProfile;
}): boolean => {
  const { reasonCode, directorState, gate } = params;
  if (reasonCode !== 'fall_route_incomplete' && reasonCode !== 'fall_rule_chain_break') {
    return false;
  }
  const verifyGap = Math.max(0, gate.trueVerifyActions - directorState.strictVerificationActions);
  const recentVerifyGap = Math.max(0, gate.trueRecentVerifyActions - directorState.recentVerificationActions);
  const itemGap = Math.max(0, gate.truePlotItems - directorState.plotItemCount);
  const deepGap = Math.max(0, gate.trueDeepZone - directorState.deepZoneProgress);
  if (reasonCode === 'fall_rule_chain_break') {
    return verifyGap <= 1 || recentVerifyGap <= 1;
  }
  return verifyGap <= 1 || itemGap <= 1 || deepGap <= 1;
};

const shouldOpenHighProgressSoftLanding = (params: {
  reasonCode: ChongshanFallReasonCode;
  projectedSanity: number;
  projectedRulesCount: number;
  projectedInventoryCount: number;
  rescueAlreadyUsed: boolean;
  isOvertime: boolean;
  turnNumber: number;
  hardEndingTurn: number;
}): boolean => {
  const {
    reasonCode,
    projectedSanity,
    projectedRulesCount,
    projectedInventoryCount,
    rescueAlreadyUsed,
    isOvertime,
    turnNumber,
    hardEndingTurn,
  } = params;
  if (reasonCode !== 'fall_route_incomplete' && reasonCode !== 'fall_rule_chain_break') {
    return false;
  }
  if (rescueAlreadyUsed || isOvertime || projectedSanity <= 0) {
    return false;
  }
  if (turnNumber >= hardEndingTurn) {
    return false;
  }
  const hasHighProgress = projectedSanity >= 20 && (projectedRulesCount >= 9 || projectedInventoryCount >= 9);
  return hasHighProgress;
};

const inferChongshanRouteIncompleteCause = (context: ChongshanFallHintContext): string => {
  const { directorState, route, hasEndingIntent, gate, turnNumber, hardEndingTurn } = context;

  if (!hasEndingIntent) {
    return '你一路搜寻，却始终没有落下真正的收束动作，路线在犹豫里散开了。';
  }
  if (route === 'unknown') {
    return '最后一步没落在主线上，你在分岔前失了方向。';
  }
  if (directorState.recentMoveActions < CHONGSHAN_ENDING_MIN_MOVE_ACTIONS || directorState.recentItemActions < CHONGSHAN_ENDING_MIN_ITEM_ACTIONS) {
    return '你把线索查得很细，却少了必要的位移与执行，路始终没真正落地。';
  }
  if (directorState.strictVerificationActions < gate.trueVerifyActions) {
    return '关键核验还没落稳，你最后一步像踩在空台阶，路当场断开。';
  }
  if (directorState.recentVerificationActions < gate.trueRecentVerifyActions) {
    return '临近收束时你少了一次回读，最后这道门始终没对上。';
  }
  if (directorState.plotItemCount < gate.truePlotItems) {
    return '关键物证还没聚齐，证据链断在半途，收束信号没能亮起。';
  }
  if (directorState.deepZoneProgress < gate.trueDeepZone) {
    return '你在核心坐标尚未钉死前就强行收束，路径随即滑脱。';
  }
  if (directorState.threatClock > gate.trueThreatMax) {
    return '红衣的压迫越过阈值，走廊被重新改写，最终通道没能稳住。';
  }
  if (turnNumber >= hardEndingTurn - 1) {
    return '最后那道可逆缝隙在你补完复核前先一步合上。';
  }
  return '你的最终行动没能织成有效路线，闭环条件不足，门在你面前关上了。';
};

const buildChongshanFallEndingHint = (reasonCode: ChongshanFallReasonCode): string => {
  if (reasonCode === 'fall_unstable_seal') {
    return '堕入结局「裂隙反涌」：封印阵列失稳，裂缝倒卷回来，连撤离路也被吞没。';
  }
  if (reasonCode === 'fall_rule_chain_break') {
    return '堕入结局「断链收束」：你到了终局门前，却因闭环缺口被硬生生拽回黑暗。';
  }
  if (reasonCode === 'fall_rule_conflict') {
    return '堕入结局「伪证闭环」：你把未核验的规则当成真相，封印在最后一瞬反咬了你。';
  }
  return '堕入结局「盲区回廊」：你在伪线索里多停了一步，终章窗口合上，你被医院留在这条轮回里。';
};

const buildChongshanFallCauseHint = (
  reasonCode: ChongshanFallReasonCode,
  context?: ChongshanFallHintContext,
): string => {
  if (reasonCode === 'fall_sanity_depleted') {
    return '你的理智先一步见底，污染在闭环完成前就把你吞没。';
  }
  if (reasonCode === 'fall_deadline_exhausted') {
    return '你赶到时，最后一道门已经合拢，终章窗口没再给你第二次机会。';
  }
  if (reasonCode === 'fall_rule_chain_break') {
    return '校验链在关键处断了，路径没能托住你，直接滑向堕入线。';
  }
  if (reasonCode === 'fall_unstable_seal') {
    return '封印始终在抖，外层压迫又逼得太近，眼前这条路被反向吞回。';
  }
  if (reasonCode === 'fall_rule_conflict') {
    return '你踩中了高危规则冲突，哪怕意识还清醒，路也被当场掐断。';
  }
  if (context) {
    return inferChongshanRouteIncompleteCause(context);
  }
  return '你的最终行动没能织成有效路线，闭环条件不足，门最终没有为你打开。';
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

const softenMechanicalNarrativeTone = (narrative: string): string => {
  let next = (narrative || '').trim();
  const rewrites: Array<{ pattern: RegExp; replacement: string }> = [
    {
      pattern: /你已到终局窗口[:：]?[^。\n]*。?/g,
      replacement: '空气忽然发紧，你知道接下来的决定会把路彻底分开。',
    },
    {
      pattern: /终章冲刺已开始[:：]?[^。\n]*。?/g,
      replacement: '走廊尽头的光像被谁拧紧，真正的收束时刻逼近了。',
    },
    {
      pattern: /请在剩余\d+回合内做出最终抉择，?故事必须收束到胜利或死亡。?/g,
      replacement: '再迟疑一步，医院会替你写下结局。',
    },
    {
      pattern: /这一步将直接决定你是活着离开、被伪通道截获，还是尝试触发更高难度的封缄结局。?/g,
      replacement: '这一步会决定你是带着伤口离开，还是被伪通道留下。',
    },
    {
      pattern: /你必须在这之前做出最终抉择。?/g,
      replacement: '再晚一步，门会替你做决定。',
    },
    {
      pattern: /终章保护：系统已注入稳封校验选项，建议先稳住封印再决定冲刺路线。?/g,
      replacement: '风向明显在逼你冒进，但更稳的路仍是先把封印压住。',
    },
    {
      pattern: /【阶段校验】[^\n]*/g,
      replacement: '',
    },
    {
      pattern: /【闭环面板】[^\n]*/g,
      replacement: '',
    },
    {
      pattern: /【缺失项】/g,
      replacement: '',
    },
    {
      pattern: /【下一步】/g,
      replacement: '',
    },
    {
      pattern: /【终章提醒】[^\n]*/g,
      replacement: '',
    },
    {
      pattern: /【节奏建议】[^\n]*/g,
      replacement: '',
    },
  ];

  for (const { pattern, replacement } of rewrites) {
    next = next.replace(pattern, replacement);
  }

  return next.replace(/\n{3,}/g, '\n\n').trim();
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
  fallReasonContext?: ChongshanFallHintContext | null;
}): string => {
  const { isGameOver, isVictory } = params;

  if (!isGameOver) {
    return softenMechanicalNarrativeTone(stripTerminalHints(params.narrative));
  }

  const base = softenMechanicalNarrativeTone(stripTerminalHints(params.narrative));
  if (isVictory) {
    const victoryTier = params.victoryTier || inferChongshanVictoryTierFromNarrative(base);
    return appendNarrativeHint(base, buildChongshanEndingHint(victoryTier));
  }

  const fallReason = params.fallReasonCode || 'fall_route_incomplete';
  const sanitized = softenMechanicalNarrativeTone(sanitizeChongshanDefeatNarrative(base));
  const withEnding = appendNarrativeHint(sanitized, buildChongshanFallEndingHint(fallReason));
  return appendNarrativeHint(withEnding, buildChongshanFallCauseHint(fallReason, params.fallReasonContext || undefined));
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
  const isChongshan = isChongshanStory(storyTitle, storySlug);
  const actionRecords = parseChoiceRecordsFromHistory(history);
  const actionTypes = actionRecords.map((record) => record.actionType);
  const lastActionType = actionTypes[actionTypes.length - 1] || 'investigate';
  const riskyCount = actionTypes.filter((type) => type === 'risky').length;
  const investigateCount = actionTypes.filter((type) => type === 'investigate').length;
  const consecutiveRisky = countTrailingAction(actionTypes, 'risky');
  const consecutiveInvestigate = countTrailingAction(actionTypes, 'investigate');
  const riskyRatio = actionTypes.length ? riskyCount / actionTypes.length : 0;
  const investigateRatio = actionTypes.length ? investigateCount / actionTypes.length : 0;

  const plotItemKeywords = buildPlotItemKeywords(storyTitle, storySlug);
  const plotItemCount = inventory.filter((item) => looksLikePlotItem(item, plotItemKeywords)).length;
  const clueItemCount = inventory.filter((item) => item.type === 'document' || item.type === 'photo').length;

  const strictVerificationActionsRaw = actionRecords.filter((record) => {
    const verifyText = textIncludesAny(record.text, VERIFY_KEYWORDS);
    return verifyText && (record.actionType === 'investigate' || record.actionType === 'item');
  }).length + (textIncludesAny(currentAction, VERIFY_KEYWORDS) ? 1 : 0);
  const investigateOverload = isChongshan
    ? Math.max(0, consecutiveInvestigate - CHONGSHAN_INVESTIGATE_STREAK_SOFT_CAP)
    : 0;
  const verificationDecay = investigateOverload > 0
    ? Math.ceil(investigateOverload / CHONGSHAN_INVESTIGATE_VERIFY_DECAY_STEP)
    : 0;
  const strictVerificationActions = Math.max(0, strictVerificationActionsRaw - verificationDecay);
  const ruleVerificationProgress = strictVerificationActions >= 5 ? 3 : strictVerificationActions >= 3 ? 2 : strictVerificationActions >= 1 ? 1 : 0;

  const deepZoneHits = history.filter((line) => textIncludesAny(line, DEEP_ZONE_KEYWORDS)).length;
  const deepZoneProgress = clamp(Math.floor((deepZoneHits + (textIncludesAny(currentAction, DEEP_ZONE_KEYWORDS) ? 1 : 0)) / 2), 0, 3);

  const hasExitIntent = textIncludesAny(currentAction, EXIT_KEYWORDS) || history.slice(-3).some((line) => textIncludesAny(line, EXIT_KEYWORDS));
  const hasRitualIntent = textIncludesAny(currentAction, RITUAL_KEYWORDS) || history.slice(-3).some((line) => textIncludesAny(line, RITUAL_KEYWORDS));
  const sanityPressure = currentSanity <= 50 ? (currentSanity <= 30 ? 2 : 1) : 0;
  const investigatePressure = investigateOverload > 0
    ? Math.ceil(investigateOverload / CHONGSHAN_INVESTIGATE_THREAT_STEP)
    : 0;
  const threatClock = clamp(
    Math.floor(turnNumber / 3) + consecutiveRisky + Math.floor(riskyRatio * 2) + sanityPressure + investigatePressure - ruleVerificationProgress,
    0,
    6,
  );

  const recentWindow = actionRecords.slice(-4);
  const recentVerificationActions = recentWindow.filter((record) => textIncludesAny(record.text, VERIFY_KEYWORDS)).length;
  const recentActionWindow = actionRecords.slice(-CHONGSHAN_ENDING_ACTION_WINDOW_TURNS);
  const recentMoveActions = recentActionWindow.filter((record) => record.actionType === 'move').length;
  const recentItemActions = recentActionWindow.filter((record) => record.actionType === 'item').length;
  const sealStability = clamp((ruleVerificationProgress * 2) + deepZoneProgress + Math.min(plotItemCount, 3) - threatClock, -3, 6);
  const strictEndingWindow = directorMode !== 'lab' || isChongshan;
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
    investigateRatio,
    consecutiveInvestigate,
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
    recentMoveActions,
    recentItemActions,
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
  const actionMixReady = state.recentMoveActions >= CHONGSHAN_ENDING_MIN_MOVE_ACTIONS
    && state.recentItemActions >= CHONGSHAN_ENDING_MIN_ITEM_ACTIONS;
  const canAttemptTrueEnding = state.plotItemCount >= gate.truePlotItems
    && state.strictVerificationActions >= gate.trueVerifyActions
    && state.recentVerificationActions >= gate.trueRecentVerifyActions
    && state.deepZoneProgress >= gate.trueDeepZone
    && (!isLab ? state.hasRitualIntent : true)
    && state.sealStability >= gate.trueSealStability
    && state.threatClock <= gate.trueThreatMax
    && actionMixReady;
  const canAttemptEscapeEnding = state.hasExitIntent
    && state.strictVerificationActions >= gate.escapeVerifyActions
    && state.recentVerificationActions >= gate.escapeRecentVerifyActions
    && state.plotItemCount >= gate.escapePlotItems
    && state.sealStability >= gate.escapeSealStability
    && state.threatClock <= gate.escapeThreatMax
    && actionMixReady;
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
- Consecutive Investigate Actions: ${state.consecutiveInvestigate}
- Investigate Ratio: ${state.investigateRatio.toFixed(2)}
- Minimum ending turn: ${state.minEndingTurn}
- Minimum victory turn floor (Chongshan hard rule): ${CHONGSHAN_MIN_VICTORY_TURN}
- Recent Verification Actions (last 4 turns): ${state.recentVerificationActions}
- Recent Move Actions (last ${CHONGSHAN_ENDING_ACTION_WINDOW_TURNS} turns): ${state.recentMoveActions}
- Recent Item Actions (last ${CHONGSHAN_ENDING_ACTION_WINDOW_TURNS} turns): ${state.recentItemActions}
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
7) If ending requirements are not met, do NOT output victory. Provide partial progress or failure outcome instead.
8) In ending window, pure investigation loops are insufficient. Victory requires at least ${CHONGSHAN_ENDING_MIN_MOVE_ACTIONS} move action(s) and ${CHONGSHAN_ENDING_MIN_ITEM_ACTIONS} item action(s) within the last ${CHONGSHAN_ENDING_ACTION_WINDOW_TURNS} turns.`;
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
    tuned.narrative = appendNarrativeHint(tuned.narrative, '这页记录像被两只手写过，前后互相咬反；它更像诱饵，不像出口。');
  }

  if (tuned.new_evidence.length > 0 && directorState.threatClock >= 4 && actionType !== 'risky' && !preserveCriticalEvidence) {
    tuned.new_evidence = [buildDecoyEvidence(turnNumber)];
    tuned.narrative = appendNarrativeHint(tuned.narrative, '威胁抬高后，安静角落里更容易捡到“被放好的答案”，先别轻信。');
  }

  if (tuned.new_evidence.length > 0 && inventory.length >= expectedEvidenceCap && !allowHeavyDiscovery && !preserveCriticalEvidence) {
    tuned.new_evidence = [buildDecoyEvidence(turnNumber)];
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你翻出的旧纸彼此打架，像有人故意把真话拆开；它还不足以指路。');
  }

  const expectedRuleCap = Math.max(3, Math.floor(turnNumber / 3) + 1);
  if (tuned.new_rules.length > 0 && currentRules.length >= expectedRuleCap && actionType !== 'investigate' && actionType !== 'item') {
    tuned.new_rules = [];
  }
  const projectedRulesCount = currentRules.length + tuned.new_rules.length;
  const projectedInventoryCount = inventory.length + tuned.new_evidence.length;

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
  let resolvedChongshanRoute: ChongshanRoute = detectChongshanRoute(currentAction);
  let pendingRescueChoices: Choice[] | null = null;
  let rescueWindowOpened = false;
  if (isChongshan) {
    const modelSignaledEnding = tuned.is_game_over;
    const chongshanRoute = resolvedChongshanRoute;
    if (turnNumber >= directorState.minEndingTurn - 1 && !modelSignaledEnding) {
      tuned.narrative = appendNarrativeHint(tuned.narrative, buildLateBranchingHint());
    }
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
      const highProgressRecoverable = isHighProgressRecoverableState({ directorState, gate });
      const nearMissRecoverable = isNearMissRouteOrChain({
        reasonCode: resolvedChongshanFallReason,
        directorState,
        gate,
      });
      const highProgressSoftLanding = shouldOpenHighProgressSoftLanding({
        reasonCode: resolvedChongshanFallReason,
        projectedSanity,
        projectedRulesCount,
        projectedInventoryCount,
        rescueAlreadyUsed,
        isOvertime,
        turnNumber,
        hardEndingTurn,
      });
      const recoverableByReason = resolvedChongshanFallReason === 'fall_rule_chain_break'
        || resolvedChongshanFallReason === 'fall_rule_conflict'
        || resolvedChongshanFallReason === 'fall_route_incomplete'
        || (resolvedChongshanFallReason === 'fall_unstable_seal' && highProgressRecoverable)
        || nearMissRecoverable
        || highProgressSoftLanding;
      const canOpenRescueWindow = !rescueAlreadyUsed
        && !isOvertime
        && projectedSanity > 0
        && turnNumber < hardEndingTurn
        && (turnNumber <= directorState.minEndingTurn + CHONGSHAN_RESCUE_WINDOW_TURNS || highProgressSoftLanding)
        && recoverableByReason;

      if (canOpenRescueWindow) {
        tuned.is_game_over = false;
        tuned.is_victory = false;
        rescueWindowOpened = true;
        pendingRescueChoices = buildChongshanRescueChoices(resolvedChongshanFallReason);
        const reasonLabelMap: Record<ChongshanFallReasonCode, string> = {
          fall_sanity_depleted: '意识濒临坍塌',
          fall_deadline_exhausted: '最后门缝将合',
          fall_rule_chain_break: '核验链松脱',
          fall_unstable_seal: '封印反向抽动',
          fall_rule_conflict: '禁忌冲突已触发',
          fall_route_incomplete: '路线失去咬合',
        };
        const actionHintMap: Record<ChongshanFallReasonCode, string> = {
          fall_sanity_depleted: '先做低风险稳态动作，把呼吸和节奏拉回来。',
          fall_deadline_exhausted: '别再绕路，直接做能落下收束的动作，门缝不会再等太久。',
          fall_rule_chain_break: '先回核验点补齐三联校验，再继续往前。',
          fall_unstable_seal: '先回控制桥稳住锚点与阀位，封印压住后再推进。',
          fall_rule_conflict: '先处理冲突规则，撤销禁忌步骤，再恢复主线。',
          fall_route_incomplete: '先重建“核验-封缝-撤离”顺序，别继续追伪线。',
        };
        tuned.narrative = appendNarrativeHint(
          tuned.narrative,
          `你已经踩到失手边缘（${reasonLabelMap[resolvedChongshanFallReason]}）。井壁脉冲还会再跳${CHONGSHAN_RESCUE_WINDOW_TURNS}次，这道缝里仍留着一次补救机会。`,
        );
        tuned.narrative = appendNarrativeHint(
          tuned.narrative,
          actionHintMap[resolvedChongshanFallReason],
        );
        if (highProgressSoftLanding) {
          tuned.narrative = appendNarrativeHint(
            tuned.narrative,
            '你已经摸到主链的边缘，医院暂时没有立刻吞掉你；把最后一处缺口补上，就还有翻盘机会。',
          );
        }
        resolvedChongshanFallReason = null;
      } else {
        tuned.is_game_over = true;
        tuned.is_victory = false;
        tuned.narrative = appendNarrativeHint(tuned.narrative, buildChongshanFallEndingHint(resolvedChongshanFallReason));
        tuned.narrative = appendNarrativeHint(
          tuned.narrative,
          buildChongshanFallCauseHint(resolvedChongshanFallReason, {
            directorState,
            route: resolvedChongshanRoute,
            hasEndingIntent,
            gate,
            turnNumber,
            hardEndingTurn,
          }),
        );
      }
    }
  }

  if (isChongshan && !tuned.is_game_over && !pendingRescueChoices) {
    const rescueAlreadyUsed = hasRescueActionInHistory(directorState) || hasRescueAction(currentAction);
    const unstablePreemptTurn = Math.max(4, directorState.minEndingTurn - CHONGSHAN_UNSTABLE_RESCUE_PREEMPT_TURN_OFFSET);
    const inUnstableState = directorState.sealStability <= 0 || directorState.threatClock >= 4;
    const nearEnding = turnNumber >= unstablePreemptTurn;
    const canPreemptUnstableRescue = !rescueAlreadyUsed
      && !isOvertime
      && projectedSanity > 0
      && inUnstableState
      && nearEnding
      && turnNumber < hardEndingTurn;
    if (canPreemptUnstableRescue) {
      pendingRescueChoices = buildChongshanRescueChoices('fall_unstable_seal');
      rescueWindowOpened = true;
      tuned.narrative = appendNarrativeHint(
        tuned.narrative,
        `封印开始反向抽动，井壁脉冲还会再跳${Math.max(0, hardEndingTurn - turnNumber)}次；现在补链，仍有机会把它按回去。`,
      );
      tuned.narrative = appendNarrativeHint(
        tuned.narrative,
        '先回控制桥稳住封印，再决定要不要冲向出口。',
      );
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

  if (isChongshan && !tuned.is_game_over && turnNumber >= directorState.minEndingTurn - 1) {
    tuned.narrative = appendNarrativeHint(tuned.narrative, buildLateBranchingHint());
  }

  if (isChongshan && tuned.is_victory && turnNumber < CHONGSHAN_MIN_VICTORY_TURN) {
    tuned.is_victory = false;
    tuned.is_game_over = false;
    lockedChongshanVictory = false;
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你刚要收束，井环却回吐冷光。时机未到，裂缝拒绝闭合，你还能感觉到主链还差最后一口气。');
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
      `走廊灯开始成片熄灭，整层在逼你表态。井壁脉冲还会再跳${Math.max(0, hardEndingTurn - turnNumber)}次；再晚一步，门会替你做决定。`,
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
      tuned.narrative = appendNarrativeHint(tuned.narrative, '最后那道缓冲缝隙已经闭合，你没来得及补完终链，封印在眼前彻底失手。');
    }
  }

  const shouldInjectVerificationChoice = turnNumber >= 4
    && !tuned.is_game_over
    && directorState.strictVerificationActions < gate.trueVerifyActions
    && !hasVerificationChoice(tuned.choices);
  if (shouldInjectVerificationChoice) {
    const verificationChoice = buildVerificationChoice({
      turnNumber,
      locationName: tuned.location_name,
    });
    const replaceIndex = tuned.choices.findIndex((choice) => choice.actionType === 'move');
    const targetIndex = replaceIndex >= 0 ? replaceIndex : tuned.choices.length - 1;
    tuned.choices[targetIndex] = verificationChoice;

    if (directorState.strictVerificationActions <= 2) {
      const secondaryChoice = buildVerificationItemChoice({
        turnNumber,
        locationName: tuned.location_name,
      });
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
    tuned.narrative = appendNarrativeHint(tuned.narrative, '你还没摸到深区的真正坐标。先进入东楼/地下二层把定位补齐，再谈收束。');
  }

  const shouldForceSafeChoiceInLatePhase = isChongshan
    && !tuned.is_game_over
    && turnNumber >= hardEndingTurn - CHONGSHAN_SAFE_CHOICE_ENFORCE_WINDOW
    && (directorState.threatClock >= 4 || directorState.sealStability <= 1 || directorState.consecutiveRisky >= 2);
  if (shouldForceSafeChoiceInLatePhase && !hasStabilizeChoice(tuned.choices)) {
    const stabilizeChoice = buildStabilizeChoice({
      turnNumber,
      locationName: tuned.location_name,
    });
    const riskyIndex = tuned.choices.findIndex((choice) => choice.actionType === 'risky');
    const targetIndex = riskyIndex >= 0 ? riskyIndex : Math.max(0, tuned.choices.length - 1);
    tuned.choices[targetIndex] = stabilizeChoice;
    tuned.narrative = appendNarrativeHint(
      tuned.narrative,
      '风向明显在逼你冒进，但眼下更稳的是先稳住封印，再决定是否冲刺。',
    );
  }

  if (pendingRescueChoices && !tuned.is_game_over) {
    tuned.choices = ensureChoiceShape(pendingRescueChoices, tuned.location_name);
    if (!rescueWindowOpened) {
      tuned.narrative = appendNarrativeHint(tuned.narrative, '裂缝短暂松动了。先把补链动作做完，再继续向终章推进。');
    }
  }

  if (
    isChongshan
    && !tuned.is_game_over
    && directorState.consecutiveInvestigate >= CHONGSHAN_INVESTIGATE_STREAK_SOFT_CAP + 2
  ) {
    tuned.narrative = appendNarrativeHint(
      tuned.narrative,
      '你连续停在原地核对太久了。医院会利用这段迟滞重排通道，下一步最好带上位移或执行动作。',
    );
  }

  const shouldEnforceActionMixNearEnding = isChongshan
    && !tuned.is_game_over
    && !pendingRescueChoices
    && turnNumber >= directorState.minEndingTurn - 1
    && (
      directorState.recentMoveActions < CHONGSHAN_ENDING_MIN_MOVE_ACTIONS
      || directorState.recentItemActions < CHONGSHAN_ENDING_MIN_ITEM_ACTIONS
    );
  if (shouldEnforceActionMixNearEnding) {
    const needsMove = directorState.recentMoveActions < CHONGSHAN_ENDING_MIN_MOVE_ACTIONS;
    const needsItem = directorState.recentItemActions < CHONGSHAN_ENDING_MIN_ITEM_ACTIONS;

    if (needsMove && !tuned.choices.some((choice) => choice.actionType === 'move')) {
      const targetIndex = tuned.choices.findIndex((choice) =>
        choice.actionType !== 'risky'
        && !textIncludesAny(choice.text, VERIFY_KEYWORDS)
        && !textIncludesAny(choice.text, ENDING_ACTION_KEYWORDS));
      const moveChoice = buildDeepZoneChoice(directorState.deepZoneProgress);
      tuned.choices[targetIndex >= 0 ? targetIndex : Math.max(0, tuned.choices.length - 1)] = moveChoice;
    }

    if (needsItem && !tuned.choices.some((choice) => choice.actionType === 'item')) {
      const targetIndex = tuned.choices.findIndex((choice) =>
        choice.actionType !== 'risky'
        && choice.actionType !== 'move');
      const itemChoice = buildStabilizeChoice({
        turnNumber,
        locationName: tuned.location_name,
      });
      tuned.choices[targetIndex >= 0 ? targetIndex : 0] = itemChoice;
    }

    tuned.narrative = appendNarrativeHint(
      tuned.narrative,
      '要把结局真正落地，除了核验，你还需要拿出“位移确认 + 执行封缝”这两步实操动作。',
    );
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
        route: resolvedChongshanRoute,
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
        route: resolvedChongshanRoute,
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
      fallReasonContext: resolvedChongshanFallReason
        ? {
          directorState,
          route: resolvedChongshanRoute,
          hasEndingIntent,
          gate,
          turnNumber,
          hardEndingTurn,
        }
        : null,
    });
  }

  if (isChongshan && !tuned.is_game_over && turnNumber >= directorState.minEndingTurn - 1) {
    tuned.choices = rebalanceLatePhaseChoices({
      choices: tuned.choices,
      locationName: tuned.location_name,
      turnNumber,
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
  const runtimeApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const envApiKey = typeof process.env.API_KEY === 'string' ? process.env.API_KEY.trim() : '';
  const effectiveApiKey = provider === 'gemini' ? (runtimeApiKey || envApiKey) : runtimeApiKey;

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
    if (!effectiveApiKey) {
      throw new Error('API Key required for Gemini provider');
    }
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
        apiKey: effectiveApiKey || undefined,
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
  const runtimeApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const envApiKey = typeof process.env.API_KEY === 'string' ? process.env.API_KEY.trim() : '';

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
  const effectiveApiKey = effectiveProvider === 'gemini' ? (runtimeApiKey || envApiKey) : runtimeApiKey;

  if (effectiveProvider === 'gemini') {
    if (!effectiveApiKey) {
      throw new Error('API Key required for Gemini provider');
    }
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (effectiveApiKey) {
    headers.Authorization = `Bearer ${effectiveApiKey}`;
  }
  const response = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers,
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
  if (!baseUrl) {
    return [];
  }

  try {
    const cleanUrl = normalizeOpenAIBaseUrl(baseUrl);
    const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const headers: Record<string, string> = {};
    if (normalizedApiKey) {
      headers.Authorization = `Bearer ${normalizedApiKey}`;
    }
    const response = await fetch(`${cleanUrl}/models`, {
      headers,
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
  try {
    if (provider === 'gemini') {
      const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
      if (!normalizedApiKey) {
        return false;
      }
      const options: any = { apiKey: normalizedApiKey };
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
    const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (normalizedApiKey) {
      headers.Authorization = `Bearer ${normalizedApiKey}`;
    }
    const response = await fetch(`${cleanUrl}/chat/completions`, {
      method: 'POST',
      headers,
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
    const hasApiKey = Boolean(apiKey && apiKey.trim());
    const hasBaseUrl = Boolean(baseUrl && baseUrl.trim());
    if (!hasApiKey || !hasBaseUrl) {
      console.error('[aiEngine.generateImageServer] openai config missing', {
        provider,
        model: model || 'dall-e-3',
        hasApiKey,
        hasBaseUrl,
      });
      throw new Error('OpenAI image provider needs baseUrl and apiKey');
    }
    try {
      return await generateOpenAIImageServer(prompt, apiKey, baseUrl, model || 'dall-e-3');
    } catch (error: any) {
      console.error('[aiEngine.generateImageServer] openai generation failed', {
        provider,
        model: model || 'dall-e-3',
        hasApiKey,
        hasBaseUrl,
        errorMessage: error?.message || 'unknown',
      });
      throw error;
    }
  }

  try {
    return await generatePollinationsImageServer(prompt, pollinationsApiKey, pollinationsModel || 'flux');
  } catch (error: any) {
    console.error('[aiEngine.generateImageServer] pollinations generation failed', {
      provider: 'pollinations',
      model: pollinationsModel || 'flux',
      hasApiKey: Boolean(pollinationsApiKey && pollinationsApiKey.trim()),
      errorMessage: error?.message || 'unknown',
    });
    throw error;
  }
};
