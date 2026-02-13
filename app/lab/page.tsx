'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_STATE } from '../../constants';
import { DEFAULT_GAME_CONFIG } from '../../gameConfig';
import type { Choice, Evidence, GeminiResponse, StoryEvaluation } from '../../types';
import { evaluateStory } from '../../services/geminiService';
import {
  testLabDb,
  type LabGameRecord,
  type LabRunRecord,
  type LabRunStatus,
  type LabTurnRecord,
} from '../../lib/client/testLabDb';

type LiveGameEvent = {
  gameId: string;
  gameIndex: number;
  turn: number;
  choiceText: string;
  choiceType: string;
  narrative: string;
  choices: Choice[];
  sanityAfter: number;
  location: string;
  timestamp: string;
};

type Strategy = 'mixed' | 'investigate-first' | 'risky-first';

type LabConfig = {
  provider: 'gemini' | 'openai';
  baseUrl: string;
  apiKey: string;
  model: string;
  totalGames: number;
  concurrency: number;
  maxTurns: number;
  timeoutMs: number;
  strategy: Strategy;
};

const DEFAULT_CONFIG: LabConfig = {
  provider: 'openai',
  baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
  apiKey: '',
  model: 'z-ai/glm4.7',
  totalGames: 20,
  concurrency: 4,
  maxTurns: 16,
  timeoutMs: 45000,
  strategy: 'mixed',
};

const specialRuleDropKeywords = ['完整守则', '整页守则', '规则汇编', '值班手册', '患者守则原件', '公告栏整版'];

const postJsonWithTimeout = async <T,>(url: string, payload: Record<string, unknown>, timeoutMs: number): Promise<T> => {
  const executeOnce = async (): Promise<T> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || `Request failed: ${response.status}`);
      }
      return data as T;
    } finally {
      window.clearTimeout(timer);
    }
  };

  try {
    return await executeOnce();
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      try {
        return await executeOnce();
      } catch (retryError: any) {
        if (retryError?.name === 'AbortError') {
          throw new Error(`Request timed out after ${timeoutMs}ms (retried once)`);
        }
        throw retryError;
      }
    }
    throw error;
  }
};

const normalizeBaseUrl = (input: string): string => {
  let url = input.trim().replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) {
    url = url.slice(0, -'/chat/completions'.length);
  }
  return url;
};

const pickChoiceByStrategy = (choices: Choice[], strategy: Strategy): Choice => {
  if (!choices.length) {
    return { id: 'fallback', text: '原地观察', actionType: 'investigate' };
  }

  const risky = choices.filter((c) => c.actionType === 'risky');
  const investigate = choices.filter((c) => c.actionType === 'investigate');
  const safe = choices.filter((c) => c.actionType === 'move' || c.actionType === 'item');

  if (strategy === 'risky-first' && risky.length) {
    return risky[Math.floor(Math.random() * risky.length)];
  }

  if (strategy === 'investigate-first' && investigate.length) {
    return investigate[Math.floor(Math.random() * investigate.length)];
  }

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

const isSpecialRuleDrop = (choice: Choice, narrative = ''): boolean => {
  return (
    (choice.actionType === 'investigate' || choice.actionType === 'item') &&
    specialRuleDropKeywords.some((kw) => narrative.includes(kw))
  );
};

export default function TestLabPage() {
  const [config, setConfig] = useState<LabConfig>(DEFAULT_CONFIG);
  const [runs, setRuns] = useState<LabRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [games, setGames] = useState<LabGameRecord[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string>('');
  const [turns, setTurns] = useState<LabTurnRecord[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveGameEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [statusText, setStatusText] = useState('Idle');
  const stopRef = useRef(false);

  // UI state for redesigned layout
  const [expandedGames, setExpandedGames] = useState<Set<string>>(new Set());
  const [configCollapsed, setConfigCollapsed] = useState(false);
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set());
  const [expandedLiveEvents, setExpandedLiveEvents] = useState<Set<string>>(new Set());

  const toggleLiveEvent = useCallback((gameId: string) => {
    setExpandedLiveEvents((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) { next.delete(gameId); } else { next.add(gameId); }
      return next;
    });
  }, []);

  const toggleGame = useCallback((gameId: string) => {
    setExpandedGames((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) { next.delete(gameId); } else { next.add(gameId); }
      return next;
    });
    // Load turns when expanding
    setSelectedGameId(gameId);
  }, []);

  const toggleTurnNarrative = useCallback((turnId: string) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) { next.delete(turnId); } else { next.add(turnId); }
      return next;
    });
  }, []);

  const selectedRun = useMemo(() => runs.find((r) => r.id === selectedRunId), [runs, selectedRunId]);
  const selectedGame = useMemo(() => games.find((g) => g.id === selectedGameId), [games, selectedGameId]);
  const liveEventsSorted = useMemo(
    () => [...liveEvents].sort((a, b) => a.gameIndex - b.gameIndex),
    [liveEvents],
  );

  const refreshRuns = async () => {
    const items = await testLabDb.getRuns();
    setRuns(items);
    if (!selectedRunId && items.length) {
      setSelectedRunId(items[0].id);
    }
  };

  const refreshGames = async (runId: string) => {
    const items = await testLabDb.getGamesByRun(runId);
    setGames(items);
    if (items.length && !items.find((g) => g.id === selectedGameId)) {
      setSelectedGameId(items[0].id);
    }
  };

  const refreshTurns = async (gameId: string) => {
    const items = await testLabDb.getTurnsByGame(gameId);
    setTurns(items);
  };

  const exportRunData = async () => {
    if (!selectedRun) return;
    const runGames = await testLabDb.getGamesByRun(selectedRun.id);
    const allTurns: Record<string, LabTurnRecord[]> = {};
    for (const game of runGames) {
      allTurns[game.id] = await testLabDb.getTurnsByGame(game.id);
    }
    const exportData = {
      run: selectedRun,
      games: runGames,
      turns: allTurns,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lab-run-${selectedRun.createdAt.slice(0, 19).replace(/[T:]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const raw = localStorage.getItem('test_lab_config');
    if (raw) {
      try {
        setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(raw) });
      } catch {
        setConfig(DEFAULT_CONFIG);
      }
    }

    refreshRuns();
  }, []);

  useEffect(() => {
    localStorage.setItem('test_lab_config', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    if (selectedRunId) {
      refreshGames(selectedRunId);
    } else {
      setGames([]);
    }
  }, [selectedRunId]);

  useEffect(() => {
    if (selectedGameId) {
      refreshTurns(selectedGameId);
    } else {
      setTurns([]);
    }
  }, [selectedGameId]);

  const upsertRunWithProgress = async (
    baseRun: LabRunRecord,
    status: LabRunStatus,
    completedGames: number,
    failedGames: number,
    snapshots: LabGameRecord[],
  ) => {
    const doneGames = snapshots.filter((g) => g.ending !== 'error');
    const avgTurns = doneGames.length ? doneGames.reduce((s, g) => s + g.turns, 0) / doneGames.length : 0;
    const avgFinalSanity = doneGames.length ? doneGames.reduce((s, g) => s + g.finalSanity, 0) / doneGames.length : 0;
    const scored = snapshots.filter((g) => typeof g.evaluation?.overall === 'number');
    const avgScore = scored.length ? scored.reduce((s, g) => s + (g.evaluation?.overall || 0), 0) / scored.length : 0;

    const run: LabRunRecord = {
      ...baseRun,
      status,
      progress: {
        totalGames: baseRun.progress.totalGames,
        completedGames,
        failedGames,
        avgTurns,
        avgFinalSanity,
        avgScore,
      },
    };
    await testLabDb.putRun(run);
    await refreshRuns();
  };

  const runSingleGame = async (runId: string, gameIndex: number): Promise<LabGameRecord> => {
    const gameId = `${runId}-g-${String(gameIndex + 1).padStart(4, '0')}`;
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
    const evalTimeline: Array<{
      turn: number;
      choiceText: string;
      choiceType: string;
      sanityAfter: number;
      newRulesCount: number;
      narrative: string;
    }> = [];

    const OVERTIME_LIMIT = 3; // allow up to 3 extra turns past maxTurns

    while (!isGameOver && turn < config.maxTurns + OVERTIME_LIMIT && !stopRef.current) {
      const isOvertime = turn >= config.maxTurns;
      const choice = pickChoiceByStrategy(choices, config.strategy);
      history.push(`Turn ${turn}: Location: ${location}. Narrative: ${narrative}. Choice Made: ${choice.text} (${choice.actionType})`);

      const stateBefore = {
        sanity,
        location,
        rulesCount: rules.length,
        inventoryCount: inventory.length,
      };

      const start = performance.now();
      const response = await postJsonWithTimeout<GeminiResponse>('/api/v1/game/turn', {
        history,
        currentAction: choice.text,
        currentRules: rules,
        provider: config.provider,
        apiKey: config.apiKey,
        baseUrl: normalizeBaseUrl(config.baseUrl),
        model: config.model,
        currentSanity: sanity,
        inventory,
        gameConfig: {
          ...DEFAULT_GAME_CONFIG,
          maxTurns: config.maxTurns,
        },
        labMode: true,
        isOvertime,
      }, config.timeoutMs);
      const latencyMs = Math.round(performance.now() - start);

      const incomingRules = response.new_rules || [];
      const cappedIncomingRules = isSpecialRuleDrop(choice, response.narrative)
        ? incomingRules.slice(0, 2)
        : incomingRules.slice(0, 1);
      const uniqueIncomingRules = cappedIncomingRules.filter((r) => !rules.includes(r));

      sanity = Math.max(0, Math.min(100, sanity + response.sanity_change));
      location = response.location_name || location;
      narrative = response.narrative || narrative;
      rules = [...rules, ...uniqueIncomingRules];

      const incomingEvidence = response.new_evidence || [];
      inventory = [...inventory, ...incomingEvidence];
      if (response.consumed_item_id) {
        inventory = inventory.filter((item) => item.id !== response.consumed_item_id);
      }

      choices = response.choices?.length ? response.choices : [{ id: 'fallback', text: '原地观察', actionType: 'investigate' }];

      isGameOver = sanity <= 0 || !!response.is_game_over;
      isVictory = !!response.is_victory;

      const stateAfter = {
        sanity,
        location,
        rulesCount: rules.length,
        inventoryCount: inventory.length,
      };

      const turnRecord: LabTurnRecord = {
        id: `${gameId}-t-${String(turn).padStart(3, '0')}`,
        runId,
        gameId,
        turn,
        createdAt: new Date().toISOString(),
        choice,
        stateBefore,
        stateAfter,
        response: {
          sanity_change: response.sanity_change,
          is_game_over: response.is_game_over,
          is_victory: response.is_victory,
          new_rules: uniqueIncomingRules,
          new_evidence: incomingEvidence?.map((ev) => ({ id: ev.id, name: ev.name, type: ev.type })),
          narrative: response.narrative,
          choices: response.choices?.map((c) => ({ id: c.id, text: c.text, actionType: c.actionType })) || [],
        },
        latencyMs,
      };

      await testLabDb.putTurn(turnRecord);
      evalTimeline.push({
        turn,
        choiceText: choice.text,
        choiceType: choice.actionType,
        sanityAfter: sanity,
        newRulesCount: uniqueIncomingRules.length,
        narrative: (response.narrative || '').slice(0, 280),
      });

      if (selectedGameId === gameId) {
        setTurns((prev) => [...prev, turnRecord]);
      }

      setLiveEvents((prev) => {
        const nextEvent: LiveGameEvent = {
          gameId,
          gameIndex,
          turn,
          choiceText: choice.text,
          choiceType: choice.actionType,
          narrative: response.narrative || '',
          choices: response.choices || [],
          sanityAfter: sanity,
          location,
          timestamp: new Date().toISOString(),
        };
        const filtered = prev.filter((event) => event.gameId !== gameId);
        return [nextEvent, ...filtered].slice(0, 30);
      });

      turn += 1;
    }

    const ending: LabGameRecord['ending'] = isVictory ? 'victory' : isGameOver ? 'game_over' : 'timeout';
    const gameRecord: LabGameRecord = {
      id: gameId,
      runId,
      index: gameIndex,
      ending,
      turns: turn,
      finalSanity: sanity,
      rulesCount: rules.length,
      inventoryCount: inventory.length,
      createdAt: new Date().toISOString(),
    };

    if (!stopRef.current) {
      try {
        const evalResult: StoryEvaluation = await evaluateStory({
          provider: config.provider,
          apiKey: config.apiKey,
          baseUrl: normalizeBaseUrl(config.baseUrl),
          model: config.model,
          session: {
            ending,
            turns: turn,
            finalSanity: sanity,
            rulesCount: rules.length,
            inventoryCount: inventory.length,
            timeline: evalTimeline,
          },
        });
        gameRecord.evaluation = {
          overall: evalResult.overall,
          summary: evalResult.summary,
        };
      } catch (error: any) {
        gameRecord.evaluation = {
          overall: 0,
          summary: `评估失败: ${error?.message || 'Unknown error'}`,
        };
      }
    }

    await testLabDb.putGame(gameRecord);
    return gameRecord;
  };

  const handleStart = async () => {
    if (isRunning) {
      return;
    }


    stopRef.current = false;
    setIsRunning(true);

    const runId = `run-${Date.now()}`;
    setSelectedRunId(runId);
    setSelectedGameId('');
    setTurns([]);
    setLiveEvents([]);

    const baseRun: LabRunRecord = {
      id: runId,
      createdAt: new Date().toISOString(),
      status: 'running',
      config,
      progress: {
        totalGames: config.totalGames,
        completedGames: 0,
        failedGames: 0,
        avgTurns: 0,
        avgFinalSanity: 0,
        avgScore: 0,
      },
    };

    await testLabDb.putRun(baseRun);
    await refreshRuns();

    let cursor = 0;
    let completed = 0;
    let failed = 0;
    const snapshots: LabGameRecord[] = [];

    const worker = async () => {
      while (!stopRef.current) {
        const gameIndex = cursor;
        cursor += 1;
        if (gameIndex >= config.totalGames) {
          break;
        }

        setStatusText(`Running game ${gameIndex + 1}/${config.totalGames}...`);
        try {
          const game = await runSingleGame(runId, gameIndex);
          snapshots.push(game);
          completed += 1;
          if (!selectedGameId) {
            setSelectedGameId(game.id);
          }
        } catch (error: any) {
          failed += 1;
          const failedRecord: LabGameRecord = {
            id: `${runId}-g-${String(gameIndex + 1).padStart(4, '0')}`,
            runId,
            index: gameIndex,
            ending: 'error',
            turns: 0,
            finalSanity: 0,
            rulesCount: 0,
            inventoryCount: 0,
            error: error?.message || 'Unknown error',
            createdAt: new Date().toISOString(),
          };
          snapshots.push(failedRecord);
          await testLabDb.putGame(failedRecord);
        }

        await upsertRunWithProgress(baseRun, 'running', completed, failed, snapshots);
        await refreshGames(runId);
      }
    };

    const workers = Array.from({ length: Math.max(1, Math.min(config.concurrency, config.totalGames)) }, () => worker());
    await Promise.all(workers);

    const finalStatus: LabRunStatus = stopRef.current ? 'stopped' : failed > 0 ? 'failed' : 'completed';
    await upsertRunWithProgress(baseRun, finalStatus, completed, failed, snapshots);
    await refreshGames(runId);
    setStatusText(stopRef.current ? 'Stopped.' : 'Completed.');
    setIsRunning(false);
  };

  const handleStop = () => {
    stopRef.current = true;
    setStatusText('Stopping...');
  };

  // --- Inline helpers ---
  const sanityColor = (s: number) => s > 60 ? '#22c55e' : s > 30 ? '#eab308' : '#ef4444';
  const sanityBarBg = (s: number) => s > 60 ? 'bg-emerald-500' : s > 30 ? 'bg-yellow-500' : 'bg-red-500';

  const endingBadge = (ending: string, isRunning = false) => {
    if (isRunning && !ending) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-900/60 text-blue-300 border-blue-700">
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" /> 运行中
        </span>
      );
    }
    const map: Record<string, { icon: string; label: string; cls: string }> = {
      victory: { icon: '🏆', label: '胜利', cls: 'bg-emerald-900/60 text-emerald-300 border-emerald-700' },
      game_over: { icon: '💀', label: '死亡', cls: 'bg-red-900/60 text-red-300 border-red-700' },
      timeout: { icon: '⏱', label: '超时', cls: 'bg-yellow-900/60 text-yellow-300 border-yellow-700' },
      error: { icon: '❌', label: '错误', cls: 'bg-gray-800/60 text-gray-400 border-gray-600' },
    };
    const b = map[ending] || map.error;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${b.cls}`}>
        {b.icon} {b.label}
      </span>
    );
  };

  const SanityBar = ({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) => {
    const h = size === 'sm' ? 'h-1.5' : 'h-2';
    return (
      <div className={`w-full ${h} bg-gray-800 rounded-full overflow-hidden`}>
        <div className={`${h} ${sanityBarBg(value)} rounded-full transition-all duration-500`} style={{ width: `${value}%` }} />
      </div>
    );
  };

  const runStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      running: 'bg-blue-900/60 text-blue-300 border-blue-700',
      completed: 'bg-emerald-900/60 text-emerald-300 border-emerald-700',
      failed: 'bg-red-900/60 text-red-300 border-red-700',
      stopped: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] || map.stopped}`}>
        {status === 'running' && <span className="w-1.5 h-1.5 bg-blue-400 rounded-full mr-1.5 animate-pulse" />}
        {status}
      </span>
    );
  };

  const actionTypeBadge = (type: string) => {
    const map: Record<string, string> = {
      risky: 'bg-red-900/50 text-red-300 border-red-800',
      investigate: 'bg-cyan-900/50 text-cyan-300 border-cyan-800',
      move: 'bg-gray-700/50 text-gray-300 border-gray-600',
      item: 'bg-amber-900/50 text-amber-300 border-amber-800',
    };
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${map[type] || map.move}`}>{type}</span>
    );
  };

  return (
    <div className="min-h-screen bg-[#0b0f12] text-gray-100 p-4 md:p-6">
      <div className="max-w-[1600px] mx-auto space-y-5">

        {/* ── Header ───────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">🧪 Test Lab</h1>
            {isRunning && (
              <span className="flex items-center gap-1.5 text-xs text-blue-300">
                <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                {statusText}
              </span>
            )}
            {!isRunning && statusText !== 'Idle' && (
              <span className="text-xs text-gray-400">{statusText}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleStart}
              disabled={isRunning}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              ▶ 开始测试
            </button>
            <button
              onClick={handleStop}
              disabled={!isRunning}
              className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              ■ 停止
            </button>
          </div>
        </div>

        {/* ── Config Panel (Collapsible) ───────────────── */}
        <section className="border border-gray-700/60 bg-gray-900/40 rounded-xl overflow-hidden backdrop-blur-sm">
          <button
            onClick={() => setConfigCollapsed(!configCollapsed)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-300 hover:bg-gray-800/40 transition-colors"
          >
            <span>⚙️ 配置参数</span>
            <span className="text-gray-500 text-xs">{configCollapsed ? '▶ 展开' : '▼ 收起'}</span>
          </button>
          {!configCollapsed && (
            <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 border-t border-gray-800">
              {[
                { label: 'Base URL', id: 'lab-base-url', value: config.baseUrl, onChange: (v: string) => setConfig((c) => ({ ...c, baseUrl: v })), ph: 'https://...' },
                { label: 'Model', id: 'lab-model', value: config.model, onChange: (v: string) => setConfig((c) => ({ ...c, model: v })), ph: 'z-ai/glm4.7' },
                { label: 'API Key', id: 'lab-api-key', value: config.apiKey, onChange: (v: string) => setConfig((c) => ({ ...c, apiKey: v })), ph: 'nvapi-...', type: 'password' },
              ].map((f) => (
                <label key={f.id} className="flex flex-col gap-1 text-xs text-gray-400 col-span-1">
                  {f.label}
                  <input
                    id={f.id}
                    className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:border-emerald-600 focus:outline-none transition-colors"
                    value={f.value}
                    onChange={(e) => f.onChange(e.target.value)}
                    placeholder={f.ph}
                    type={f.type || 'text'}
                  />
                </label>
              ))}
              <label className="flex flex-col gap-1 text-xs text-gray-400">
                Provider
                <select id="lab-provider" className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:border-emerald-600 focus:outline-none" value={config.provider} onChange={(e) => setConfig((c) => ({ ...c, provider: e.target.value as LabConfig['provider'] }))}>
                  <option value="openai">openai-compatible</option>
                  <option value="gemini">gemini</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-400">
                Strategy
                <select id="lab-strategy" className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:border-emerald-600 focus:outline-none" value={config.strategy} onChange={(e) => setConfig((c) => ({ ...c, strategy: e.target.value as Strategy }))}>
                  <option value="mixed">mixed</option>
                  <option value="investigate-first">investigate-first</option>
                  <option value="risky-first">risky-first</option>
                </select>
              </label>
              {[
                { label: '游戏数量', id: 'lab-total-games', value: config.totalGames, onChange: (v: number) => setConfig((c) => ({ ...c, totalGames: v || 1 })), min: 1 },
                { label: '并发数', id: 'lab-concurrency', value: config.concurrency, onChange: (v: number) => setConfig((c) => ({ ...c, concurrency: v || 1 })), min: 1 },
                { label: '最大回合', id: 'lab-max-turns', value: config.maxTurns, onChange: (v: number) => setConfig((c) => ({ ...c, maxTurns: v || 1 })), min: 1 },
                { label: '超时 (ms)', id: 'lab-timeout-ms', value: config.timeoutMs, onChange: (v: number) => setConfig((c) => ({ ...c, timeoutMs: v || 10000 })), min: 1000, step: 1000 },
              ].map((f) => (
                <label key={f.id} className="flex flex-col gap-1 text-xs text-gray-400">
                  {f.label}
                  <input id={f.id} className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:border-emerald-600 focus:outline-none" type="number" min={f.min} step={f.step} value={f.value} onChange={(e) => f.onChange(Number(e.target.value))} />
                </label>
              ))}
            </div>
          )}
        </section>

        {/* ── Run Selector + Dashboard ──────────────────── */}
        <section className="border border-gray-700/60 bg-gray-900/40 rounded-xl p-4 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm text-gray-400">📋 测试批次</span>
            <select
              className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:border-emerald-600 focus:outline-none flex-1 max-w-xs"
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
            >
              <option value="">选择批次...</option>
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.createdAt.replace('T', ' ').slice(0, 19)} — {run.status} ({run.progress.completedGames}/{run.progress.totalGames})
                </option>
              ))}
            </select>
            {selectedRun && runStatusBadge(selectedRun.status)}
            {selectedRun && (
              <button
                onClick={exportRunData}
                className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-950/60 text-gray-300 hover:border-emerald-600 hover:text-emerald-400 transition-colors"
              >
                ⬇ 导出数据
              </button>
            )}
          </div>

          {selectedRun && (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
              {[
                { label: '进度', value: `${selectedRun.progress.completedGames} / ${selectedRun.progress.totalGames}`, sub: `失败 ${selectedRun.progress.failedGames}` },
                { label: '平均回合', value: selectedRun.progress.avgTurns.toFixed(1) },
                { label: '平均理性值', value: selectedRun.progress.avgFinalSanity.toFixed(0), color: sanityColor(selectedRun.progress.avgFinalSanity) },
                { label: '平均评分', value: selectedRun.progress.avgScore.toFixed(1), color: '#60a5fa' },
              ].map((stat) => (
                <div key={stat.label} className="bg-gray-950/60 rounded-lg p-3 border border-gray-800">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{stat.label}</div>
                  <div className="text-lg font-semibold" style={stat.color ? { color: stat.color } : undefined}>{stat.value}</div>
                  {stat.sub && <div className="text-[10px] text-gray-500">{stat.sub}</div>}
                </div>
              ))}
              {/* Progress bar */}
              <div className="col-span-2 bg-gray-950/60 rounded-lg p-3 border border-gray-800">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">完成进度</div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-2 bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-700"
                    style={{ width: `${selectedRun.progress.totalGames ? (selectedRun.progress.completedGames / selectedRun.progress.totalGames) * 100 : 0}%` }}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {selectedRun.progress.totalGames ? Math.round((selectedRun.progress.completedGames / selectedRun.progress.totalGames) * 100) : 0}%
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Live Activity Ticker ──────────────────────── */}
        {liveEventsSorted.length > 0 && (
          <section className="border border-gray-700/60 bg-gray-900/40 rounded-xl p-3 backdrop-blur-sm">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">⚡ 实时动态 · {liveEventsSorted.length} 个游戏</div>
            <div className="flex flex-wrap gap-2">
              {liveEventsSorted.map((event) => {
                const isLiveExpanded = expandedLiveEvents.has(event.gameId);
                return (
                  <div
                    key={event.gameId}
                    className={`bg-gray-950/70 border border-blue-800/50 rounded-lg overflow-hidden transition-all duration-200 ${isLiveExpanded ? 'w-full' : 'w-[220px]'
                      }`}
                  >
                    <button
                      onClick={() => toggleLiveEvent(event.gameId)}
                      className="w-full text-left px-3 py-2.5 hover:bg-gray-800/30 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse shrink-0" />
                          <span className="text-sm font-medium text-gray-200">Game #{event.gameIndex + 1}</span>
                        </div>
                        <span className="text-gray-600 text-[10px]">{isLiveExpanded ? '▲' : '▼'}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-sm font-semibold text-cyan-300">回合 {event.turn}</span>
                        <span className="text-sm font-semibold" style={{ color: sanityColor(event.sanityAfter) }}>♥ {event.sanityAfter}</span>
                        <span className="text-xs text-gray-500 truncate">{event.location}</span>
                      </div>
                    </button>
                    {isLiveExpanded && (
                      <div className="border-t border-gray-800/50 px-3 py-2.5">
                        <div className="text-xs text-cyan-400 mb-1">选择: {event.choiceText} <span className="text-gray-600">({event.choiceType})</span></div>
                        <div className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed mt-1.5 max-h-[200px] overflow-y-auto">{event.narrative}</div>
                        {event.choices.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="text-[10px] text-gray-500">可选:</span>
                            {event.choices.map((c) => (
                              <span key={c.id} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400">{c.text}</span>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const el = document.getElementById(`game-card-${event.gameId}`);
                            if (el) {
                              toggleGame(event.gameId);
                              setTimeout(() => {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }, 100);
                            }
                          }}
                          className={`mt-2 text-[10px] ${games.some((g) => g.id === event.gameId)
                            ? 'text-emerald-400 hover:text-emerald-300'
                            : 'text-gray-600 cursor-not-allowed'
                            }`}
                          disabled={!games.some((g) => g.id === event.gameId)}
                        >
                          {games.some((g) => g.id === event.gameId) ? '查看完整时间线 →' : '⏳ 游戏结束后可查看完整时间线'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Game Cards Grid ──────────────────────────── */}
        <section>
          {games.length === 0 && !isRunning ? (
            <div className="text-center py-16 text-gray-600">
              <div className="text-4xl mb-3">🧪</div>
              <div className="text-sm">选择一个批次或开始新的测试</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {games.map((game) => {
                const isExpanded = expandedGames.has(game.id);
                const gameTurns = isExpanded && selectedGameId === game.id ? turns : [];
                const isGameRunning = liveEvents.some((e) => e.gameId === game.id);

                // Distinct border + bg for each state
                const cardStyle = isExpanded
                  ? 'col-span-1 md:col-span-2 xl:col-span-3 border-cyan-800/60 bg-gray-900/60'
                  : game.ending === 'error'
                    ? 'border-red-800/60 bg-red-950/20 hover:border-red-700'
                    : game.ending === 'victory'
                      ? 'border-emerald-800/50 bg-emerald-950/15 hover:border-emerald-600'
                      : game.ending === 'game_over'
                        ? 'border-gray-600/60 bg-gray-900/40 hover:border-gray-500'
                        : isGameRunning
                          ? 'border-blue-800/60 bg-blue-950/15 hover:border-blue-600'
                          : 'border-gray-700/60 bg-gray-900/40 hover:border-gray-600';

                const leftBorderColor = isExpanded ? 'border-l-cyan-500'
                  : game.ending === 'error' ? 'border-l-red-500'
                    : game.ending === 'victory' ? 'border-l-emerald-500'
                      : game.ending === 'game_over' ? 'border-l-gray-500'
                        : isGameRunning ? 'border-l-blue-500'
                          : 'border-l-gray-700';

                return (
                  <div
                    key={game.id}
                    id={`game-card-${game.id}`}
                    className={`border border-l-4 ${leftBorderColor} rounded-xl overflow-hidden transition-all duration-300 ${cardStyle}`}
                  >
                    {/* Card Header (always visible) */}
                    <button
                      onClick={() => toggleGame(game.id)}
                      className="w-full text-left p-4 flex items-center gap-4 hover:bg-gray-800/30 transition-colors"
                    >
                      <div className="text-lg font-semibold text-gray-400 w-8 text-center shrink-0">
                        #{game.index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          {isGameRunning && <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse shrink-0" />}
                          {endingBadge(game.ending, isGameRunning)}
                          <span className="text-sm font-semibold text-gray-300">{game.turns} 回合</span>
                          {game.evaluation && (
                            <span className="text-xs text-blue-400 font-medium">⭐ {game.evaluation.overall}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5 flex-1 max-w-[200px]">
                            <span className="text-xs text-gray-400 shrink-0">理性</span>
                            <SanityBar value={game.finalSanity} />
                            <span className="text-sm font-bold font-mono shrink-0" style={{ color: sanityColor(game.finalSanity) }}>{game.finalSanity}</span>
                          </div>
                          <span className="text-[10px] text-gray-600">规则 {game.rulesCount} · 物品 {game.inventoryCount}</span>
                        </div>
                        {game.evaluation?.summary && !isExpanded && (
                          <div className="text-xs text-gray-500 mt-1 truncate">{game.evaluation.summary}</div>
                        )}
                        {game.error && (
                          <div className="text-xs text-red-400 mt-1 truncate">{game.error}</div>
                        )}
                      </div>
                      <div className="text-gray-600 text-xs shrink-0">
                        {isExpanded ? '▲ 收起' : '▼ 展开'}
                      </div>
                    </button>

                    {/* Expanded: Full Evaluation + Timeline */}
                    {isExpanded && (
                      <div className="border-t border-gray-800 px-4 pb-4">
                        {/* Evaluation Summary */}
                        {game.evaluation && (
                          <div className="mt-3 p-3 bg-gray-950/60 rounded-lg border border-gray-800">
                            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">📝 评估摘要</div>
                            <div className="text-sm text-gray-300">{game.evaluation.summary}</div>
                          </div>
                        )}

                        {/* Turn Timeline */}
                        <div className="mt-4">
                          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">📖 回合时间线</div>
                          {gameTurns.length === 0 ? (
                            <div className="text-xs text-gray-600 py-2">加载中...</div>
                          ) : (
                            <div className="space-y-1.5">
                              {gameTurns.map((turn) => {
                                const sanityDelta = turn.stateAfter.sanity - turn.stateBefore.sanity;
                                const isNarrativeExpanded = expandedTurns.has(turn.id);
                                return (
                                  <div key={turn.id} className="bg-gray-950/50 rounded-lg border border-gray-800/60 overflow-hidden">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); toggleTurnNarrative(turn.id); }}
                                      className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-800/30 transition-colors"
                                    >
                                      <span className="text-[10px] font-mono text-gray-600 w-6 shrink-0">T{turn.turn}</span>
                                      {actionTypeBadge(turn.choice.actionType)}
                                      <span className="text-xs text-gray-300 truncate flex-1">{turn.choice.text}</span>
                                      <span className="text-[10px] font-mono shrink-0" style={{ color: sanityColor(turn.stateAfter.sanity) }}>
                                        ♥{turn.stateAfter.sanity}
                                        {sanityDelta !== 0 && (
                                          <span className={sanityDelta > 0 ? 'text-emerald-400' : 'text-red-400'}>
                                            {' '}{sanityDelta > 0 ? '+' : ''}{sanityDelta}
                                          </span>
                                        )}
                                      </span>
                                      <span className="text-[10px] text-gray-600 shrink-0">{turn.latencyMs}ms</span>
                                      <span className="text-gray-600 text-[10px]">{isNarrativeExpanded ? '▲' : '▼'}</span>
                                    </button>
                                    {isNarrativeExpanded && (
                                      <div className="px-3 pb-3 border-t border-gray-800/40">
                                        <div className="text-xs text-gray-400 mt-2 whitespace-pre-wrap leading-relaxed">{turn.response.narrative}</div>
                                        {turn.response.new_rules && turn.response.new_rules.length > 0 && (
                                          <div className="mt-2">
                                            <span className="text-[10px] text-amber-400">新规则:</span>
                                            {turn.response.new_rules.map((r, i) => (
                                              <div key={i} className="text-[10px] text-amber-300/70 ml-2">• {r}</div>
                                            ))}
                                          </div>
                                        )}
                                        {turn.response.choices && turn.response.choices.length > 0 && (
                                          <div className="mt-2 flex flex-wrap gap-1.5">
                                            {turn.response.choices.map((c) => (
                                              <span key={c.id} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400">
                                                {c.text}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
