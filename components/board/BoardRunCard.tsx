import React from 'react';
import type { BoardRunSnapshot } from '../../types';
import { formatRunLastEventText, type BoardLang } from './boardText';

type BoardRunCardProps = {
  run: BoardRunSnapshot;
  index: number;
  lang: BoardLang;
  selected?: boolean;
  onSelect?: (runId: string) => void;
};

type CardProfile = 'critical' | 'stable' | 'combat' | 'offline' | 'unstable';

const FEED_IMAGES = {
  critical:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuBsqoFu5bQ1wP9c0VH5o3B9saufp4oKpLOiCy5KNLzqwdgepAwo5BNPzAcGQtiroASlKY_t2GBM9FEngLlWrChrwOOBLKExTtGQQSOXs7eve3qjQ_xbIQEufL8vmt9DM3_t5IeyMe86HJSw7bQ3gsb-jhC6O8lswT-NQeN6LEheozEj1gyXyIcOlaW0Lk4a53KV2n_7ctJknwyB-89voQC9AgBP8bfIOPMQAJPY_HZb67fKom_EDT99GsDyGbb3DXMX2dNofFoTLUA',
  stable:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuAyQFecnvCYcRXzcnIhzNIk8LffkEE0PCicrLrr_dBwA8002JbMZi3CImXm5fuoNfHUu5ABeZHW_BhzGnQ_GBQV4Jv2SeCCwvkyP3-GSaL3E7RZHS2ashLBUvafBsUw7T5D8zrzmNkUbbl136AY7zm50hDBx55PxC_MwggT63zWLRTAygxHK4kZ3xV1oJGAP9RgGH1Rwh7qNSMp1VsqiFZon0_LlgF_6MItN1Dd5FhClir0nRSyeeMV5QkHJe0vtZZ4smvtz36B6_A',
  combat:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuDrbDqIp7ZwdIUw3XQLBRPN4G2TK07z5tIQXyxDdalA7lpqO45dRoOtjbBao5BXN-EpuKNg_gV4As3MQhZUfayduvsGe6HMq7f9g5gja-NVpmKlYuNACsAb-SLHsNRt1bg_R_CNdpWA-l_u3-7G3d3eFhIjsh7bGnY-qHvdQkPsRJgZnFKEYlldRGRqnh5tFZ11Gr2fZYT0txrrSA6xs8MszdFdi3p-yIkwsK4JKfdR-JBarYZ4WOvL7k9OHXAbzwJN_GKQmUs2PaI',
  unstable:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuB1Lhmn8Nb09dOdCMWvNFfdEHfnDHxY9OBtPSKI1i7EAbXtMbsoVzSzIBM6q_t284MCNp5wtCUqyCRF1TEiHD2xTOmYFNYOtH5KV6kCJYMOpxelLMvmTdCeX7ZsKw5iHHpqBKIBZUmhSyAFAgbFnciME0S6saf3KoRdJ7UD03X1Vq41dGCyCe8_GeQGLEI294_q8zOhBXbvvOtaYSk-ZmtnEYXtP6Ky5qyvrONOsgJYSUc5cjLDRkQtz4pyaMd7UbgEMVErhlR9SRg',
  offline: 'https://media.giphy.com/media/oEI9uBYSzLpBK/giphy.gif',
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const profileFromRun = (run: BoardRunSnapshot, seed: number): CardProfile => {
  if (run.status === 'failed' || run.status === 'abandoned') return 'offline';
  if (run.status === 'completed') return 'stable';
  if (run.sanity <= 25) return 'critical';
  if (run.sanity <= 55) return seed % 2 === 0 ? 'combat' : 'unstable';
  return seed % 3 === 0 ? 'stable' : seed % 3 === 1 ? 'combat' : 'unstable';
};

const profileTone = (profile: CardProfile, lang: BoardLang) => {
  switch (profile) {
    case 'critical':
      return {
        border: 'border-red-500 shadow-[0_0_18px_rgba(234,42,51,0.25)]',
        header: 'from-red-500/30 to-transparent',
        badge: 'bg-red-500 text-white animate-pulse',
        badgeLabel: lang === 'zh' ? '危急' : 'CRITICAL',
        sync: 'bg-yellow-600',
        sanity: 'bg-red-500',
        signal: 'text-red-300',
        state: lang === 'zh' ? '噪点异常' : 'NOISE DETECTED',
      };
    case 'stable':
      return {
        border: 'border-emerald-500/30',
        header: 'from-emerald-500/20 to-transparent',
        badge: 'bg-emerald-700/40 text-emerald-200',
        badgeLabel: lang === 'zh' ? '稳定' : 'STABLE',
        sync: 'bg-emerald-500',
        sanity: 'bg-emerald-500',
        signal: 'text-emerald-300',
        state: lang === 'zh' ? '信号清晰' : 'CLEAR',
      };
    case 'combat':
      return {
        border: 'border-yellow-500/35',
        header: 'from-yellow-500/20 to-transparent',
        badge: 'bg-yellow-700/40 text-yellow-200',
        badgeLabel: lang === 'zh' ? '高危' : 'COMBAT',
        sync: 'bg-yellow-500',
        sanity: 'bg-yellow-500',
        signal: 'text-yellow-300',
        state: lang === 'zh' ? '敌对区域' : 'HOSTILE',
      };
    case 'offline':
      return {
        border: 'border-slate-600/70',
        header: 'from-slate-700/30 to-transparent',
        badge: 'bg-slate-700/50 text-slate-300',
        badgeLabel: lang === 'zh' ? '离线' : 'OFFLINE',
        sync: 'bg-slate-600',
        sanity: 'bg-slate-600',
        signal: 'text-slate-500',
        state: lang === 'zh' ? '信号丢失' : 'SIGNAL LOST',
      };
    default:
      return {
        border: 'border-cyan-500/35',
        header: 'from-cyan-500/20 to-transparent',
        badge: 'bg-cyan-700/40 text-cyan-200',
        badgeLabel: lang === 'zh' ? '在线' : 'LIVE',
        sync: 'bg-cyan-500',
        sanity: 'bg-emerald-500',
        signal: 'text-cyan-200',
        state: lang === 'zh' ? '扫描中' : 'SCANNING',
      };
  }
};

const imageClassByProfile = (profile: CardProfile): string => {
  if (profile === 'combat') return 'opacity-60 grayscale contrast-125 sepia';
  if (profile === 'stable') return 'opacity-50 grayscale contrast-125';
  if (profile === 'offline') return 'opacity-25 grayscale contrast-150';
  if (profile === 'critical') return 'opacity-60 grayscale contrast-125';
  return 'opacity-55 grayscale contrast-110';
};

const statusLabelByRun = (run: BoardRunSnapshot, lang: BoardLang): string => {
  if (run.status === 'active') return lang === 'zh' ? '实时监测' : 'LIVE FEED';
  if (run.status === 'completed') return lang === 'zh' ? '已归档·通关' : 'ARCHIVED VICTORY';
  if (run.status === 'failed') return lang === 'zh' ? '已归档·死亡' : 'ARCHIVED DEATH';
  if (run.status === 'abandoned') return lang === 'zh' ? '已放弃' : 'ABANDONED';
  return lang === 'zh' ? '存档' : 'ARCHIVE';
};

const formatActor = (actorType: BoardRunSnapshot['actorType']) => (actorType === 'agent' ? 'AGENT' : 'HUMAN');

export const BoardRunCard: React.FC<BoardRunCardProps> = ({ run, index, lang, selected = false, onSelect }) => {
  const seed = hashString(`${run.runId}-${index}`);
  const profile = profileFromRun(run, seed);
  const tone = profileTone(profile, lang);

  const syncRate = Math.max(4, Math.min(100, run.status === 'active' ? 100 - Math.max(0, 28 - run.sanity) : 100));
  const feedImage = FEED_IMAGES[profile];
  const tickerText = formatRunLastEventText(run, lang);
  const shouldTicker = profile === 'critical' || profile === 'combat';

  return (
    <div
      className={[
        'group relative flex h-[410px] cursor-pointer flex-col overflow-hidden rounded border bg-[#1c1c1c]',
        tone.border,
        selected ? 'ring-1 ring-red-400/70' : 'hover:border-red-500/55',
      ].join(' ')}
      onClick={() => onSelect?.(run.runId)}
    >
      <div className={`flex items-center justify-between border-b border-slate-700/60 bg-gradient-to-r ${tone.header} px-4 py-3`}>
        <div className="flex items-center gap-2 min-w-0 pr-2">
          <span className="material-symbols-outlined text-sm text-slate-300 shrink-0">{profile === 'offline' ? 'wifi_off' : 'radar'}</span>
          <h3 className="text-sm font-bold tracking-[0.14em] text-white truncate" title={`${formatActor(run.actorType)}_${run.walletMasked}`}>
            {formatActor(run.actorType)}_{run.walletMasked}
          </h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-bold tracking-wider ${tone.badge}`}>
            {tone.badgeLabel}
          </span>
          <span className="font-mono text-[10px] text-slate-400">#{run.runId.slice(-6).toUpperCase()}</span>
        </div>
      </div>

      <div className="relative h-44 overflow-hidden border-b border-slate-700/60 bg-black">
        <img
          className={`h-full w-full object-cover transition-transform duration-700 group-hover:scale-105 ${imageClassByProfile(profile)}`}
          src={feedImage}
          alt={lang === 'zh' ? '看板画面' : 'board feed'}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-90" />

        <div className="absolute left-2 top-2 z-10 rounded border border-red-500/40 bg-black/70 px-1.5 py-0.5 text-[9px] font-mono text-red-300">
          {statusLabelByRun(run, lang)}
        </div>

        {profile === 'offline' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
            <div className="rounded border border-white/20 bg-black/85 px-4 py-2 font-mono text-xs tracking-[0.14em] text-white">
              {lang === 'zh' ? '信号丢失' : 'SIGNAL LOST'}
            </div>
          </div>
        )}

        <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between text-[10px] font-mono">
          <span className="text-slate-400">{lang === 'zh' ? '位置' : 'LOC'}: {run.location || (lang === 'zh' ? '未知' : 'UNKNOWN')}</span>
          <span className={tone.signal}>{tone.state}</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-between p-4">
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-slate-400">{lang === 'zh' ? '同步率' : 'SYNC RATE'}</span>
              <span className="text-slate-200">{syncRate}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div className={`h-full ${tone.sync}`} style={{ width: `${syncRate}%` }} />
            </div>
          </div>

          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-bold text-red-400">{lang === 'zh' ? '理智' : 'SANITY'}</span>
              <span className="font-bold text-red-300">{profile === 'offline' ? '--' : `${run.sanity}%`}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full border border-red-500/25 bg-slate-800">
              <div className={`h-full ${tone.sanity}`} style={{ width: `${profile === 'offline' ? 0 : run.sanity}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-slate-400">
            <div className="rounded border border-slate-700 bg-black/65 px-2 py-1 text-center">
              <div className="text-[10px] text-slate-500">{lang === 'zh' ? '天数' : 'DAY'}</div>
              <div className="text-white">{run.dayNo}</div>
            </div>
            <div className="rounded border border-slate-700 bg-black/65 px-2 py-1 text-center">
              <div className="text-[10px] text-slate-500">{lang === 'zh' ? '回合' : 'TURN'}</div>
              <div className="text-white">{run.turnNo}</div>
            </div>
            <div className="rounded border border-slate-700 bg-black/65 px-2 py-1 text-center">
              <div className="text-[10px] text-slate-500">{lang === 'zh' ? '角色' : 'ROLE'}</div>
              <div className="text-white">{formatActor(run.actorType)}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 h-14 overflow-hidden rounded border border-slate-800 bg-black p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">
            {lang === 'zh' ? '当前动态' : 'Current Action'}
          </div>
          {shouldTicker ? (
            <div className="board-ticker-wrap">
              <div className="board-ticker-track pr-8 font-mono text-xs text-red-300">&gt;&gt; {tickerText} &gt;&gt; {tickerText} &gt;&gt;</div>
            </div>
          ) : (
            <div className="truncate font-mono text-xs text-slate-200">&gt;&gt; {tickerText}</div>
          )}
        </div>
      </div>
    </div>
  );
};
