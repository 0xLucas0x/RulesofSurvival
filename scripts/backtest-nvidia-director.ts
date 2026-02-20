import { PrismaClient } from '@prisma/client';
import { DEFAULT_GAME_CONFIG } from '../gameConfig';
import { generateNextTurnServer } from '../lib/server/aiEngine';
import { composeStorySystemInstruction } from '../lib/server/storyPrompt';
import type { Choice, Evidence } from '../types';

type EndingTier = 'perfect' | 'normal' | 'pass' | 'fall' | 'unknown';
type TestStrategy = 'mixed' | 'seal' | 'verify' | 'escape';

const SPECIAL_RULE_DROP_KEYWORDS = ['完整守则', '整页守则', '规则汇编', '值班手册', '患者守则原件', '公告栏整版'];

const TOTAL_GAMES = Number.parseInt(process.env.TEST_GAMES || '30', 10);
const MAX_TURNS = Number.parseInt(process.env.TEST_MAX_TURNS || '15', 10);
const TURN_TIMEOUT_MS = Number.parseInt(process.env.TEST_TURN_TIMEOUT_MS || '90000', 10);
const TEST_STRATEGY = ((process.env.TEST_STRATEGY || 'mixed').trim().toLowerCase() as TestStrategy);
const PROVIDER = 'openai' as const;
const BASE_URL = (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1/chat/completions')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/chat\/completions$/, '');
const MODEL = (process.env.NVIDIA_MODEL || 'z-ai/glm4.7').trim();
const API_KEY = (process.env.NVIDIA_API_KEY || '').trim();

if (!API_KEY) {
  throw new Error('Missing NVIDIA_API_KEY');
}

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

const findChoiceByKeywords = (choices: Choice[], keywords: string[]): Choice | null => {
  const hit = choices.find((choice) => keywords.some((kw) => choice.text.includes(kw)));
  return hit || null;
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

const pickChoiceByStrategy = (choices: Choice[], turn: number): Choice => {
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

  while (!isGameOver && turn < MAX_TURNS + 3) {
    const choice = pickChoiceByStrategy(choices, turn);
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
    inventory = [...inventory, ...incomingEvidence];
    if (response.consumed_item_id) {
      inventory = inventory.filter((item) => item.id !== response.consumed_item_id);
    }

    sanity = Math.max(0, Math.min(100, sanity + (Number(response.sanity_change) || 0)));
    location = response.location_name || location;
    narrative = response.narrative || narrative;
    choices = Array.isArray(response.choices) && response.choices.length
      ? response.choices
      : [{ id: 'fallback', text: '原地观察', actionType: 'investigate' }];

    isVictory = !!response.is_victory;
    isGameOver = sanity <= 0 || !!response.is_game_over;
    turn += 1;
  }

  const ending = isVictory ? 'victory' : isGameOver ? 'game_over' : 'timeout';
  const tier = inferEndingTier(narrative, isVictory);

  return {
    game: gameNo,
    ending,
    tier,
    turns: turn,
    finalSanity: sanity,
    rulesCount: rules.length,
    inventoryCount: inventory.length,
  };
};

const main = async () => {
  console.log(`Backtesting ${TOTAL_GAMES} games | model=${MODEL} | baseUrl=${BASE_URL} | strategy=${TEST_STRATEGY}`);
  const systemInstructionOverride = await resolveStoryInstructionOverride();
  console.log(`Using story instruction override: ${systemInstructionOverride ? 'yes' : 'no'}`);
  const results: Array<{
    game: number;
    ending: 'victory' | 'game_over' | 'timeout' | 'error';
    tier: EndingTier;
    turns: number;
    finalSanity: number;
    rulesCount: number;
    inventoryCount: number;
    error?: string;
  }> = [];
  for (let i = 0; i < TOTAL_GAMES; i += 1) {
    let game;
    try {
      game = await runSingleGame(i + 1, systemInstructionOverride);
    } catch (error: any) {
      game = {
        game: i + 1,
        ending: 'error' as const,
        tier: 'fall' as const,
        turns: 0,
        finalSanity: 0,
        rulesCount: 0,
        inventoryCount: 0,
        error: error?.message || 'Unknown error',
      };
    }
    results.push(game);
    console.log(
      `Game #${game.game} | ending=${game.ending} | tier=${game.tier} | turns=${game.turns} | sanity=${game.finalSanity} | rules=${game.rulesCount} | inventory=${game.inventoryCount}${game.error ? ` | error=${game.error}` : ''}`,
    );
  }

  const completed = results.filter((r) => r.ending !== 'error');
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
  };

  const victoryRate = summary.completed ? (summary.victory / summary.completed) * 100 : 0;
  console.log('\n=== Summary ===');
  console.log(JSON.stringify({
    ...summary,
    victoryRatePercent: Number(victoryRate.toFixed(2)),
  }, null, 2));
};

main().catch((error) => {
  console.error('Backtest failed:', error);
  process.exit(1);
});
