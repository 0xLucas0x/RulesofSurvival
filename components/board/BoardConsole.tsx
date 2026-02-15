'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../lib/i18n';
import { useTranslation } from 'react-i18next';
import { fetchBoardSnapshot } from '../../services/geminiService';
import type { BoardEvent, BoardRunSnapshot } from '../../types';
import { formatRunLastEventText } from './boardText';
import { BoardEventLog } from './BoardEventLog';
import { BoardRunCard } from './BoardRunCard';

const MAX_EVENTS = 120;
const MAX_COMPLETED = 500;

const texts = {
  zh: {
    title: '观测控制台',
    subtitle: '公开实时看板',
    systemTime: '系统时间',
    stream: '实时流',
    connected: '在线',
    reconnecting: '重连中',
    activeTab: '进行中',
    completedTab: '已完结',
    actorFilter: '角色筛选',
    actorAll: '全部',
    actorHuman: '人类',
    actorAgent: '智能体',
    sectorTitle: '运行分区',
    selectedRun: '当前选中',
    empty: '暂无匹配的运行数据',
    updated: '最近同步',
    boardHint: '公开看板仅展示脱敏信息',
    fallback: '实时流断开，已退化为轮询同步',
    openGame: '返回游戏',
    api: '接口时间',
    iconWarning: '告警面板',
    iconMap: '区域地图',
    iconHeart: '生命监测',
    iconSensors: '传感器',
    iconOverride: '紧急接管',
  },
  en: {
    title: 'Observer Console',
    subtitle: 'Public Live Board',
    systemTime: 'System Time',
    stream: 'Stream',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    activeTab: 'Active',
    completedTab: 'Completed',
    actorFilter: 'Actor Filter',
    actorAll: 'All',
    actorHuman: 'HUMAN',
    actorAgent: 'AGENT',
    sectorTitle: 'Run Sectors',
    selectedRun: 'Selected Run',
    empty: 'No runs match current filters',
    updated: 'Last Sync',
    boardHint: 'Public board shows masked identities only',
    fallback: 'Stream disconnected, polling snapshot fallback is active',
    openGame: 'Back To Game',
    api: 'API Time',
    iconWarning: 'Warning Panel',
    iconMap: 'Area Map',
    iconHeart: 'Vital Monitor',
    iconSensors: 'Sensors',
    iconOverride: 'Emergency Override',
  },
};

const sortRuns = (runs: BoardRunSnapshot[]): BoardRunSnapshot[] => {
  return [...runs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

const dedupeEvents = (events: BoardEvent[]): BoardEvent[] => {
  const map = new Map<string, BoardEvent>();
  for (const event of events) {
    if (!map.has(event.id)) {
      map.set(event.id, event);
    }
  }
  return [...map.values()].slice(0, MAX_EVENTS);
};

const patchRunFromEvent = (current: BoardRunSnapshot | undefined, event: BoardEvent): BoardRunSnapshot => {
  return {
    runId: event.runId,
    actorType: event.actorType,
    status: event.status,
    walletMasked: event.walletMasked,
    turnNo: event.turnNo,
    dayNo: event.dayNo,
    sanity: event.sanity,
    location: event.location,
    startedAt: current?.startedAt || event.createdAt,
    endedAt: event.status === 'active' ? null : current?.endedAt || event.createdAt,
    updatedAt: event.createdAt,
    isVictory: event.type === 'victory' ? true : event.type === 'death' ? false : current?.isVictory || null,
    lastActionText: current?.lastActionText || '',
    lastActionType: current?.lastActionType || '',
    lastNarrative: current?.lastNarrative || '',
    lastEventText: event.message,
    lastEventType: event.type,
    lastEventItemName: event.itemName,
  };
};

export const BoardConsole = () => {
  const { i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage || i18n.language).startsWith('en') ? 'en' : 'zh';
  const t = texts[lang];

  const [runsById, setRunsById] = useState<Record<string, BoardRunSnapshot>>({});
  const [events, setEvents] = useState<BoardEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamNonce, setStreamNonce] = useState(0);
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [actorFilter, setActorFilter] = useState<'all' | 'human' | 'agent'>('all');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [clock, setClock] = useState(new Date());
  const [serverTime, setServerTime] = useState('');

  const reconnectTimerRef = useRef<number | null>(null);
  const lastEventIdRef = useRef('0-0');

  const hydrateSnapshot = useCallback(async (setBusy = false) => {
    if (setBusy) {
      setIsLoading(true);
    }

    try {
      const snapshot = await fetchBoardSnapshot();
      setServerTime(snapshot.serverTime);

      const completed = sortRuns(snapshot.completedRuns).slice(0, MAX_COMPLETED);
      const active = sortRuns(snapshot.activeRuns);
      const map: Record<string, BoardRunSnapshot> = {};

      for (const run of [...active, ...completed]) {
        map[run.runId] = run;
      }

      setRunsById(map);
      setEvents((prev) => dedupeEvents([...snapshot.recentEvents, ...prev]));
      if (snapshot.recentEvents[0]?.id) {
        lastEventIdRef.current = snapshot.recentEvents[0].id;
      }

      const first = active[0] || completed[0];
      if (first) {
        setSelectedRunId((prev) => prev || first.runId);
      }
    } catch (error) {
      console.error('[board] snapshot failed', error);
    } finally {
      if (setBusy) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void hydrateSnapshot(true);
  }, [hydrateSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (streamConnected) {
      return;
    }

    const timer = window.setInterval(() => {
      void hydrateSnapshot(false);
    }, 3000);

    return () => window.clearInterval(timer);
  }, [hydrateSnapshot, streamConnected]);

  useEffect(() => {
    const cursor = lastEventIdRef.current || '$';
    const source = new EventSource(`/api/v1/board/stream?lastEventId=${encodeURIComponent(cursor)}`);

    const handleReady = (event: MessageEvent) => {
      setStreamConnected(true);
      try {
        const data = JSON.parse(event.data || '{}') as { cursor?: string };
        if (data.cursor) {
          lastEventIdRef.current = data.cursor;
        }
      } catch {
        // noop
      }
    };

    const handleEvent = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data || '{}') as BoardEvent;
        if (!payload.id) {
          return;
        }

        lastEventIdRef.current = payload.id;
        setEvents((prev) => dedupeEvents([payload, ...prev]));
        setRunsById((prev) => {
          const next = { ...prev };
          next[payload.runId] = patchRunFromEvent(prev[payload.runId], payload);
          return next;
        });

        setSelectedRunId((prev) => prev || payload.runId);
      } catch (error) {
        console.error('[board] parse event failed', error);
      }
    };

    const eventTypes = [
      'run_started',
      'turn_milestone',
      'item_acquired',
      'victory',
      'death',
      'sanity_critical',
    ];

    source.addEventListener('ready', handleReady as EventListener);
    eventTypes.forEach((type) => source.addEventListener(type, handleEvent as EventListener));

    source.onopen = () => {
      setStreamConnected(true);
    };

    source.onerror = () => {
      setStreamConnected(false);
      source.close();

      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }

      reconnectTimerRef.current = window.setTimeout(() => {
        setStreamNonce((value) => value + 1);
      }, 2000);
    };

    return () => {
      source.close();
      eventTypes.forEach((type) => source.removeEventListener(type, handleEvent as EventListener));
      source.removeEventListener('ready', handleReady as EventListener);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [streamNonce]);

  const activeRuns = useMemo(() => {
    return sortRuns(Object.values(runsById).filter((run) => run.status === 'active'));
  }, [runsById]);

  const completedRuns = useMemo(() => {
    return sortRuns(Object.values(runsById).filter((run) => run.status !== 'active')).slice(0, MAX_COMPLETED);
  }, [runsById]);

  const tabRuns = tab === 'active' ? activeRuns : completedRuns;
  const filteredRuns = tabRuns.filter((run) => actorFilter === 'all' || run.actorType === actorFilter);
  const selectedRun = runsById[selectedRunId] || filteredRuns[0] || null;

  const formatTime = (date: Date) => date.toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour12: false });

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#0d0d0d] text-slate-200">
      <style>{`
        .board-scanline {
          background: linear-gradient(
            to bottom,
            rgba(255,255,255,0),
            rgba(255,255,255,0) 50%,
            rgba(0,0,0,0.22) 50%,
            rgba(0,0,0,0.22)
          ),
          linear-gradient(
            90deg,
            rgba(255, 0, 0, 0.05),
            rgba(0, 255, 255, 0.015),
            rgba(0, 0, 255, 0.05)
          );
          background-size: 100% 4px, 3px 100%;
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 30;
          opacity: 0.7;
        }

        @keyframes board-flicker {
          0% { opacity: 0.98; }
          6% { opacity: 0.94; }
          12% { opacity: 0.89; }
          18% { opacity: 0.96; }
          26% { opacity: 0.99; }
          100% { opacity: 0.98; }
        }

        .monitor-flicker {
          animation: board-flicker 4s infinite;
        }

        .board-ticker-wrap {
          width: 100%;
          overflow: hidden;
          white-space: nowrap;
        }

        .board-ticker-track {
          display: inline-block;
          white-space: nowrap;
          animation: boardTicker 15s linear infinite;
        }

        @keyframes boardTicker {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-100%, 0, 0); }
        }
      `}</style>

      <div className="board-scanline" />

      <header className="relative z-20 flex h-14 items-center justify-between border-b border-red-500/30 bg-[#141414] px-6">
        <div className="flex items-center gap-4">
          <div className="h-3 w-3 animate-pulse rounded-full bg-red-500 shadow-[0_0_10px_#ea2a33]" />
          <h1 className="text-lg font-bold tracking-[0.15em] text-white">
            {t.title} <span className="text-red-400">v5.0</span>
          </h1>
          <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300">
            {t.subtitle}
          </span>
        </div>

        <div className="flex items-center gap-4 text-[10px] font-mono tracking-wider">
          <div className="text-right">
            <div className="text-slate-500">{t.systemTime}</div>
            <div className="text-white">{formatTime(clock)}</div>
          </div>
          <div className="text-right">
            <div className="text-slate-500">{t.stream}</div>
            <div className={streamConnected ? 'text-emerald-400' : 'text-yellow-300'}>
              {streamConnected ? t.connected : t.reconnecting}
            </div>
          </div>
          <div className="text-right">
            <div className="text-slate-500">{t.api}</div>
            <div className="text-slate-200">{serverTime ? formatTime(new Date(serverTime)) : '--:--:--'}</div>
          </div>
          <button
            onClick={() => {
              window.location.href = '/';
            }}
            className="rounded border border-slate-600 px-2 py-1 text-slate-300 transition-colors hover:border-white hover:text-white"
          >
            {t.openGame}
          </button>
          <div className="flex items-center overflow-hidden rounded border border-slate-600">
            <button
              onClick={() => i18n.changeLanguage('zh')}
              className={`px-2 py-1 ${lang === 'zh' ? 'bg-red-900/40 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              中文
            </button>
            <button
              onClick={() => i18n.changeLanguage('en')}
              className={`px-2 py-1 ${lang === 'en' ? 'bg-red-900/40 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              EN
            </button>
          </div>
        </div>
      </header>

      {!streamConnected && !isLoading && (
        <div className="relative z-20 border-b border-yellow-500/30 bg-yellow-900/30 px-4 py-2 text-xs text-yellow-200">
          {t.fallback}
        </div>
      )}

      <div className="relative z-20 flex flex-1 overflow-hidden monitor-flicker">
        <aside className="w-72 shrink-0 border-r border-red-500/20 bg-[#141414]">
          <div className="border-b border-red-500/20 bg-red-500/5 p-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-red-400">{t.sectorTitle}</h2>
          </div>

          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                onClick={() => setTab('active')}
                className={`rounded border px-2 py-1 ${tab === 'active' ? 'border-red-500 bg-red-500/20 text-red-200' : 'border-slate-700 text-slate-400 hover:border-red-500/40'}`}
              >
                {t.activeTab} ({activeRuns.length})
              </button>
              <button
                onClick={() => setTab('completed')}
                className={`rounded border px-2 py-1 ${tab === 'completed' ? 'border-red-500 bg-red-500/20 text-red-200' : 'border-slate-700 text-slate-400 hover:border-red-500/40'}`}
              >
                {t.completedTab} ({completedRuns.length})
              </button>
            </div>

            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">{t.actorFilter}</div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                {[
                  ['all', t.actorAll],
                  ['human', t.actorHuman],
                  ['agent', t.actorAgent],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setActorFilter(value as 'all' | 'human' | 'agent')}
                    className={`rounded border px-2 py-1 ${actorFilter === value ? 'border-cyan-500 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 text-slate-400 hover:border-cyan-500/40'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[calc(100vh-360px)] space-y-2 overflow-y-auto custom-scrollbar pr-1">
              {filteredRuns.map((run) => (
                <button
                  key={run.runId}
                  onClick={() => setSelectedRunId(run.runId)}
                  className={`w-full rounded border px-3 py-2 text-left text-xs transition-colors ${selectedRunId === run.runId
                      ? 'border-red-500 bg-red-500/15 text-red-200'
                      : 'border-slate-700 bg-black/40 text-slate-300 hover:border-red-500/40'
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono">{run.walletMasked}</span>
                    <span className="text-[10px] text-slate-500">T{run.turnNo}</span>
                  </div>
                  <div className="mt-1 truncate text-[10px] text-slate-500">
                    {formatRunLastEventText(run, lang) || run.location}
                  </div>
                </button>
              ))}

              {!filteredRuns.length && !isLoading && (
                <div className="rounded border border-dashed border-slate-700 p-3 text-center text-xs text-slate-500">
                  {t.empty}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-red-500/20 p-4 text-[11px] text-slate-500">
            <div className="mb-1 uppercase tracking-wider text-red-400">{t.selectedRun}</div>
            <div className="truncate font-mono text-slate-300">{selectedRun?.runId || '--'}</div>
            <div className="mt-2">{t.updated}: {selectedRun ? formatTime(new Date(selectedRun.updatedAt)) : '--:--:--'}</div>
            <div className="mt-2 text-[10px] text-slate-600">{t.boardHint}</div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto bg-[#0d0d0d] p-6 custom-scrollbar">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="h-[410px] animate-pulse rounded border border-slate-800 bg-[#1a1a1a]" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredRuns.map((run, idx) => (
                <BoardRunCard
                  key={run.runId}
                  run={run}
                  index={idx}
                  lang={lang}
                  selected={run.runId === selectedRun?.runId}
                  onSelect={setSelectedRunId}
                />
              ))}
            </div>
          )}
        </main>

        <aside className="hidden w-16 shrink-0 border-l border-red-500/20 bg-[#141414] py-4 md:flex md:flex-col md:items-center md:space-y-4">
          {[
            ['warning', t.iconWarning],
            ['map', t.iconMap],
            ['monitor_heart', t.iconHeart],
            ['sensors', t.iconSensors],
          ].map(([icon, label], idx) => (
            <button
              key={icon}
              className={`flex h-10 w-10 items-center justify-center rounded border bg-slate-800 transition-colors ${idx === 0
                  ? 'border-red-500/60 text-red-400 hover:bg-red-500/20'
                  : 'border-slate-700 text-slate-400 hover:border-cyan-500/50 hover:text-cyan-300'
                }`}
              title={label}
            >
              <span className="material-symbols-outlined text-lg">{icon}</span>
            </button>
          ))}
          <div className="my-2 h-full w-px bg-slate-800" />
          <button
            className="flex h-10 w-10 items-center justify-center rounded border border-red-500/50 bg-red-500/10 text-red-300 transition-colors hover:bg-red-500/20"
            title={t.iconOverride}
          >
            <span className="material-symbols-outlined text-lg">emergency</span>
          </button>
        </aside>
      </div>

      <BoardEventLog events={events} lang={lang} />
    </div>
  );
};
