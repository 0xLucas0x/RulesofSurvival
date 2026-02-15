import React from 'react';
import type { BoardEvent } from '../../types';
import { eventTypeLabel, formatBoardClock, formatBoardEventMessage, type BoardLang } from './boardText';

type BoardEventLogProps = {
  events: BoardEvent[];
  lang: BoardLang;
};

const eventColor = (event: BoardEvent): string => {
  if (event.type === 'victory') return 'text-emerald-400';
  if (event.type === 'death') return 'text-red-400';
  if (event.type === 'sanity_critical') return 'text-yellow-300';
  if (event.type === 'item_acquired') return 'text-cyan-300';
  if (event.type === 'run_started') return 'text-slate-300';
  return 'text-red-300';
};

export const BoardEventLog: React.FC<BoardEventLogProps> = ({ events, lang }) => {
  return (
    <footer className="relative h-44 shrink-0 overflow-hidden border-t-2 border-red-500 bg-black/95 shadow-[0_-8px_20px_rgba(0,0,0,0.8)]">
      <div className="absolute left-0 top-0 bg-red-500 px-2 py-0.5 text-[10px] font-bold text-black">
        {lang === 'zh' ? '事件流' : 'EVENT LOG'}
      </div>
      <div className="h-full overflow-y-auto p-4 pt-6 font-mono text-sm custom-scrollbar">
        {events.length === 0 && (
          <div className="text-sm text-slate-500">
            {lang === 'zh' ? '暂无事件，等待新的探索动态...' : 'No events yet, waiting for new run updates...'}
          </div>
        )}
        <div className="space-y-1">
          {events.map((event) => (
            <div key={event.id} className={`flex gap-3 text-xs ${eventColor(event)}`}>
              <span className="w-[72px] shrink-0 text-slate-500">[{formatBoardClock(event.createdAt, lang)}]</span>
              <span className="w-[58px] shrink-0 text-slate-500">{eventTypeLabel(event.type, lang)}</span>
              <span className="truncate">{formatBoardEventMessage(event, lang)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 h-8 w-full bg-gradient-to-t from-black to-transparent" />
    </footer>
  );
};
