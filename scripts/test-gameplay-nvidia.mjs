#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

const envFilePath = process.env.GAME_TEST_ENV_FILE
  ? path.resolve(process.cwd(), process.env.GAME_TEST_ENV_FILE)
  : path.resolve(process.cwd(), '.env.gameplay');

loadEnvFile(envFilePath);

const GAME_API_BASE = process.env.GAME_API_BASE || 'http://localhost:3000';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'z-ai/glm4.7';
const NVIDIA_BASE_URL_RAW = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1/chat/completions';
const TEST_GAMES = Number.parseInt(process.env.TEST_GAMES || '8', 10);
const MAX_TURNS = Number.parseInt(process.env.TEST_MAX_TURNS || '16', 10);

if (!NVIDIA_API_KEY) {
  console.error('Missing NVIDIA_API_KEY. Set it before running the script.');
  process.exit(1);
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
      type: 'document',
    },
  ],
  choices: [
    { id: '1', text: '查看四周', actionType: 'investigate' },
    { id: '2', text: '走向护士站', actionType: 'move' },
    { id: '3', text: '检查挂号单', actionType: 'item' },
  ],
};

const normalizeNvidiaBaseUrl = (input) => {
  let url = input.trim().replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) {
    url = url.slice(0, -'/chat/completions'.length);
  }
  return url;
};

const isSpecialRuleDrop = (choice, narrative = '') => {
  const specialKeywords = ['完整守则', '整页守则', '规则汇编', '值班手册', '患者守则原件', '公告栏整版'];
  return (
    (choice.actionType === 'investigate' || choice.actionType === 'item') &&
    specialKeywords.some((kw) => narrative.includes(kw))
  );
};

const pickChoice = (choices) => {
  if (!Array.isArray(choices) || choices.length === 0) {
    return { id: 'fallback', text: '原地观察', actionType: 'investigate' };
  }

  const risky = choices.filter((c) => c.actionType === 'risky');
  const investigate = choices.filter((c) => c.actionType === 'investigate');
  const others = choices.filter((c) => c.actionType !== 'risky' && c.actionType !== 'investigate');
  const roll = Math.random();

  if (roll < 0.35 && risky.length > 0) {
    return risky[Math.floor(Math.random() * risky.length)];
  }
  if (roll < 0.75 && investigate.length > 0) {
    return investigate[Math.floor(Math.random() * investigate.length)];
  }

  return choices[Math.floor(Math.random() * choices.length)] || others[0] || choices[0];
};

const postJson = async (url, payload) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return data;
};

const runSingleGame = async (index) => {
  let sanity = INITIAL_STATE.sanity;
  let location = INITIAL_STATE.location;
  let narrative = INITIAL_STATE.narrative;
  let rules = [...INITIAL_STATE.rules];
  let inventory = [...INITIAL_STATE.inventory];
  let choices = [...INITIAL_STATE.choices];
  let turn = 0;
  let isGameOver = false;
  let isVictory = false;
  const history = [];

  while (!isGameOver && turn < MAX_TURNS) {
    const choice = pickChoice(choices);
    history.push(`Turn ${turn}: Location: ${location}. Narrative: ${narrative}. Choice Made: ${choice.text} (${choice.actionType})`);

    const response = await postJson(`${GAME_API_BASE}/api/v1/game/turn`, {
      history,
      currentAction: choice.text,
      currentRules: rules,
      provider: 'openai',
      apiKey: NVIDIA_API_KEY,
      baseUrl: normalizeNvidiaBaseUrl(NVIDIA_BASE_URL_RAW),
      model: NVIDIA_MODEL,
      currentSanity: sanity,
      inventory,
    });

    const incomingRules = response.new_rules || [];
    const cappedIncoming = isSpecialRuleDrop(choice, response.narrative)
      ? incomingRules.slice(0, 2)
      : incomingRules.slice(0, 1);
    const uniqueIncoming = cappedIncoming.filter((r) => !rules.includes(r));

    sanity = Math.max(0, Math.min(100, sanity + (response.sanity_change || 0)));
    location = response.location_name || location;
    narrative = response.narrative || narrative;
    rules = [...rules, ...uniqueIncoming];

    const incomingEvidence = response.new_evidence || [];
    inventory = [...inventory, ...incomingEvidence];
    if (response.consumed_item_id) {
      inventory = inventory.filter((item) => item.id !== response.consumed_item_id);
    }

    choices = Array.isArray(response.choices) && response.choices.length > 0
      ? response.choices
      : [{ id: 'fallback', text: '原地观察', actionType: 'investigate' }];

    isGameOver = sanity <= 0 || !!response.is_game_over;
    isVictory = !!response.is_victory;
    turn += 1;
  }

  const ending = isVictory ? 'victory' : isGameOver ? 'game_over' : 'timeout';
  return {
    game: index + 1,
    ending,
    turns: turn,
    finalSanity: sanity,
    rulesCount: rules.length,
    inventoryCount: inventory.length,
  };
};

const main = async () => {
  console.log('Checking API health...');
  const healthRes = await fetch(`${GAME_API_BASE}/api/v1/health`);
  if (!healthRes.ok) {
    throw new Error(`Health check failed: ${healthRes.status}`);
  }

  console.log(`Running ${TEST_GAMES} scripted games with NVIDIA model ${NVIDIA_MODEL}...`);

  const results = [];
  for (let i = 0; i < TEST_GAMES; i++) {
    const result = await runSingleGame(i);
    results.push(result);
    console.log(
      `Game #${result.game} | ending=${result.ending} | turns=${result.turns} | sanity=${result.finalSanity} | rules=${result.rulesCount} | inventory=${result.inventoryCount}`,
    );
  }

  const summary = results.reduce(
    (acc, r) => {
      acc.totalTurns += r.turns;
      acc.totalSanity += r.finalSanity;
      acc.totalRules += r.rulesCount;
      acc.totalInventory += r.inventoryCount;
      acc[r.ending] += 1;
      return acc;
    },
    {
      victory: 0,
      game_over: 0,
      timeout: 0,
      totalTurns: 0,
      totalSanity: 0,
      totalRules: 0,
      totalInventory: 0,
    },
  );

  console.log('\n=== Summary ===');
  console.log(`victory: ${summary.victory}`);
  console.log(`game_over: ${summary.game_over}`);
  console.log(`timeout: ${summary.timeout}`);
  console.log(`avg turns: ${(summary.totalTurns / results.length).toFixed(2)}`);
  console.log(`avg final sanity: ${(summary.totalSanity / results.length).toFixed(2)}`);
  console.log(`avg rules discovered: ${(summary.totalRules / results.length).toFixed(2)}`);
  console.log(`avg inventory size: ${(summary.totalInventory / results.length).toFixed(2)}`);
};

main().catch((error) => {
  console.error('Script failed:', error.message);
  process.exit(1);
});
