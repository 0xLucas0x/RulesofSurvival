'use client';

import React, { useState, useEffect } from 'react';
import '../lib/i18n';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';

interface LeaderboardItem {
    rank: number;
    userId: string;
    walletAddress: string;
    walletMasked: string;
    compositeScore?: number;
    victories: number;
    completedRuns?: number;
    activeDays?: number;
    avgTurns?: number;
}

interface LeaderboardResponse {
    board: 'composite' | 'clear' | 'active';
    window: '7d' | 'all';
    actorType: 'HUMAN' | 'AGENT' | 'ALL';
    items: LeaderboardItem[];
    error?: string;
}

export const Leaderboard: React.FC = () => {
    const { t, i18n } = useTranslation();
    const [board, setBoard] = useState<'composite' | 'clear' | 'active'>('composite');
    const [windowOption, setWindowOption] = useState<'7d' | 'all'>('all');
    const [actorType, setActorType] = useState<'HUMAN' | 'AGENT' | 'ALL'>('ALL');
    const [data, setData] = useState<LeaderboardItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/v1/leaderboard?board=${board}&window=${windowOption}&actorType=${actorType}&limit=50`);
                if (!res.ok) {
                    throw new Error(t('leaderboard.error'));
                }
                const json: LeaderboardResponse = await res.json();
                if (json.error) {
                    throw new Error(json.error);
                }
                if (isMounted) {
                    setData(json.items || []);
                }
            } catch (err: any) {
                if (isMounted) {
                    setError(err.message || t('leaderboard.error'));
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        fetchData();
        return () => {
            isMounted = false;
        };
    }, [board, windowOption, actorType, t]);

    const handleLanguageChange = (lang: string) => {
        i18n.changeLanguage(lang);
    };

    const currentLanguage = i18n.language;

    return (
        <div className="relative min-h-screen w-screen overflow-hidden bg-black text-gray-300 font-mono flex flex-col">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Noto+Sans+SC:wght@400;700&family=Creepster&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap');
                
                :root {
                    --primary: #b91c1c;
                    --accent-teal: #2dd4bf;
                }
                
                .font-horror { font-family: "Creepster", cursive; }
                .font-sc { font-family: "Noto Sans SC", sans-serif; }
                .font-tech { font-family: "Share Tech Mono", monospace; }

                .scanlines {
                    background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.5) 50%);
                    background-size: 100% 4px;
                    pointer-events: none;
                }

                .metric-glow {
                    text-shadow: 0 0 15px rgba(185, 28, 28, 0.8), 0 0 5px rgba(255, 255, 255, 0.2);
                }

                .hud-frame {
                    position: relative;
                    background: rgba(0, 0, 0, 0.7);
                    border: 1px solid rgba(185, 28, 28, 0.3);
                }
                .hud-frame::before {
                    content: ''; position: absolute; top: -1px; left: -1px; width: 10px; height: 10px;
                    border-top: 2px solid var(--primary); border-left: 2px solid var(--primary);
                }
                .hud-frame::after {
                    content: ''; position: absolute; bottom: -1px; right: -1px; width: 10px; height: 10px;
                    border-bottom: 2px solid var(--primary); border-right: 2px solid var(--primary);
                }
                
                /* Custom Scrollbar */
                ::-webkit-scrollbar {
                  width: 8px;
                }
                ::-webkit-scrollbar-track {
                  background: rgba(0,0,0,0.5);
                  border-left: 1px solid rgba(185, 28, 28, 0.2);
                }
                ::-webkit-scrollbar-thumb {
                  background: rgba(185, 28, 28, 0.3);
                  border-radius: 4px;
                }
                ::-webkit-scrollbar-thumb:hover {
                  background: rgba(185, 28, 28, 0.6);
                }
            `}</style>

            {/* Background Layers */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute inset-0 bg-[url('/hospital_corridor_blur.png')] bg-cover bg-center opacity-40 blur-sm filter contrast-125 saturate-50" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/90 via-black/80 to-black/95" />
                <div className="absolute inset-0 scanlines opacity-30" />
                <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_20%,rgba(0,0,0,1)_100%)]" />
            </div>

            {/* Header */}
            <header className="relative z-50 flex items-center justify-between px-6 py-4 border-b border-red-900/30 bg-black/60 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <Link href="/" className="h-6 px-3 border border-red-500/50 flex items-center justify-center bg-black/40 hover:bg-red-900/40 transition-colors group cursor-pointer gap-2">
                        <span className="material-symbols-outlined text-red-500 text-[14px] group-hover:-translate-x-1 transition-transform">arrow_back</span>
                        <span className="text-red-500 text-xs font-tech font-bold tracking-widest uppercase">{t('leaderboard.back')}</span>
                    </Link>
                </div>

                <div className="flex items-center gap-6 text-[10px] font-bold tracking-[0.2em] text-gray-400 font-sc">
                    {/* Language Switcher */}
                    <div className="flex items-center border border-white/20 rounded overflow-hidden">
                        <button
                            onClick={() => handleLanguageChange('en')}
                            className={`px-2 py-1 transition-colors ${currentLanguage === 'en' ? 'bg-red-900/50 text-white' : 'hover:bg-white/10'}`}
                        >
                            EN
                        </button>
                        <div className="w-[1px] h-full bg-white/20"></div>
                        <button
                            onClick={() => handleLanguageChange('zh')}
                            className={`px-2 py-1 transition-colors ${currentLanguage === 'zh' ? 'bg-red-900/50 text-white' : 'hover:bg-white/10'}`}
                        >
                            中文
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-8 w-full max-w-6xl mx-auto h-full overflow-hidden">

                <div className="text-center mb-8 relative">
                    <h1 className="font-horror text-4xl md:text-6xl text-red-600 tracking-tighter mb-2 metric-glow relative z-10">
                        {t('leaderboard.title')}
                    </h1>
                </div>

                {/* Filters */}
                <div className="w-full max-w-4xl flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                    {/* Board Type Toggle */}
                    <div className="flex bg-black/60 border border-red-900/30 p-1 rounded backdrop-blur-sm font-sc text-sm">
                        {(['composite', 'clear', 'active'] as const).map((type) => (
                            <button
                                key={type}
                                onClick={() => setBoard(type)}
                                className={`px-4 py-1.5 transition-all rounded-sm ${board === type
                                    ? 'bg-red-900/50 text-white font-bold border border-red-500/50 shadow-[0_0_10px_rgba(185,28,28,0.5)]'
                                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-transparent'
                                    }`}
                            >
                                {t(`leaderboard.board_${type}`)}
                            </button>
                        ))}
                    </div>

                    {/* Actor Type Toggle */}
                    <div className="flex bg-black/60 border border-blue-900/30 p-1 rounded backdrop-blur-sm font-sc text-sm">
                        {(['ALL', 'HUMAN', 'AGENT'] as const).map((type) => (
                            <button
                                key={type}
                                onClick={() => setActorType(type)}
                                className={`px-3 py-1.5 transition-all rounded-sm ${actorType === type
                                    ? 'bg-blue-900/50 text-blue-300 font-bold border border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]'
                                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-transparent'
                                    }`}
                            >
                                {t(`leaderboard.actor_${type.toLowerCase()}`)}
                            </button>
                        ))}
                    </div>

                    {/* Window Toggle */}
                    <div className="flex bg-black/60 border border-teal-900/30 p-1 rounded backdrop-blur-sm font-tech uppercase text-xs">
                        {(['7d', 'all'] as const).map((win) => (
                            <button
                                key={win}
                                onClick={() => setWindowOption(win)}
                                className={`px-3 py-1.5 transition-all rounded-sm ${windowOption === win
                                    ? 'bg-teal-900/50 text-teal-300 font-bold border border-teal-500/50 shadow-[0_0_10px_rgba(45,212,191,0.3)]'
                                    : 'text-gray-600 hover:text-gray-400 hover:bg-white/5 border border-transparent'
                                    }`}
                            >
                                {t(`leaderboard.window_${win}`)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Data Table */}
                <div className="hud-frame w-full max-w-4xl flex-1 max-h-full flex flex-col bg-black/40 backdrop-blur-md overflow-hidden p-1">
                    <div className="overflow-x-auto w-full h-full flex flex-col">
                        <table className="w-full text-left font-tech text-sm uppercase">
                            <thead className="text-gray-500 border-b border-red-900/50 sticky top-0 bg-black/90 z-20">
                                <tr>
                                    <th className="p-4 w-20 text-center font-bold">#</th>
                                    <th className="p-4 text-gray-300">{t('leaderboard.agent_id')}</th>
                                    {board !== 'active' && <th className="p-4 text-right text-red-500">{t('leaderboard.victories')}</th>}
                                    {board === 'composite' && <th className="p-4 text-right text-teal-400">{t('leaderboard.score')}</th>}
                                    {(board === 'composite' || board === 'active') && <th className="p-4 text-right text-gray-400">{t('leaderboard.runs')}</th>}
                                    {(board === 'composite' || board === 'active') && <th className="p-4 text-right text-gray-400">{t('leaderboard.active_days')}</th>}
                                    {board === 'clear' && <th className="p-4 text-right text-teal-400">{t('leaderboard.avg_turns')}</th>}
                                </tr>
                            </thead>
                            <tbody className="overflow-y-auto w-full">
                                {loading ? (
                                    <tr>
                                        <td colSpan={7} className="p-8 text-center text-red-500/50 animate-pulse font-sc">
                                            {t('leaderboard.loading')}
                                        </td>
                                    </tr>
                                ) : error ? (
                                    <tr>
                                        <td colSpan={7} className="p-8 text-center text-red-600 font-sc bg-red-950/20">
                                            {error}
                                        </td>
                                    </tr>
                                ) : data.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="p-8 text-center text-gray-600 font-sc">
                                            {t('leaderboard.no_data')}
                                        </td>
                                    </tr>
                                ) : (
                                    data.map((item, idx) => (
                                        <tr
                                            key={item.userId}
                                            className="border-b border-white/5 hover:bg-white/5 transition-colors group cursor-default"
                                        >
                                            <td className="p-4 text-center">
                                                <span className={`inline-flex items-center justify-center w-8 h-8 rounded-sm font-bold ${idx === 0 ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.3)]' :
                                                    idx === 1 ? 'bg-gray-400/20 text-gray-300 border border-gray-400/50' :
                                                        idx === 2 ? 'bg-amber-700/20 text-amber-600 border border-amber-700/50' :
                                                            'text-gray-600'
                                                    }`}>
                                                    {item.rank}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-2 h-2 rounded-full ${item.victories > 0 ? 'bg-teal-500 animate-pulse' : 'bg-red-800'}`}></div>
                                                    <span className="font-mono text-gray-300 tracking-wider">
                                                        {item.walletMasked}
                                                    </span>
                                                </div>
                                            </td>

                                            {board !== 'active' && (
                                                <td className="p-4 text-right font-bold text-red-400 group-hover:text-red-300 transition-colors">
                                                    {item.victories}
                                                </td>
                                            )}

                                            {board === 'composite' && (
                                                <td className="p-4 text-right font-bold text-teal-500 group-hover:text-teal-300 transition-colors">
                                                    {item.compositeScore?.toLocaleString()}
                                                </td>
                                            )}

                                            {(board === 'composite' || board === 'active') && (
                                                <td className="p-4 text-right text-gray-500 group-hover:text-gray-300 transition-colors">
                                                    {item.completedRuns}
                                                </td>
                                            )}

                                            {(board === 'composite' || board === 'active') && (
                                                <td className="p-4 text-right text-gray-500 group-hover:text-gray-300 transition-colors">
                                                    {item.activeDays}
                                                </td>
                                            )}

                                            {board === 'clear' && (
                                                <td className="p-4 text-right text-teal-500 group-hover:text-teal-300 transition-colors font-bold">
                                                    {item.avgTurns?.toFixed(1) || '-'}
                                                </td>
                                            )}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>
        </div>
    );
};
