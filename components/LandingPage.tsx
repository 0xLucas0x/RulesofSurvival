import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { LandingStats } from '../types';

interface LandingPageProps {
    onHumanEnter: () => void;
    isHumanEntering?: boolean;
    onAgentEnter: () => void;
    currentLanguage?: string;
    onLanguageChange?: (lang: string) => void;
    stats?: LandingStats | null;
}

export const LandingPage: React.FC<LandingPageProps> = ({
    onHumanEnter,
    isHumanEntering = false,
    onAgentEnter,
    currentLanguage = 'en',
    onLanguageChange,
    stats,
}) => {
    const { t } = useTranslation();
    const [hoveredSection, setHoveredSection] = useState<'human' | 'agent' | null>(null);
    const [currentTime, setCurrentTime] = useState('');

    useEffect(() => {
        const timer = setInterval(() => {
            const now = new Date();
            setCurrentTime(now.toLocaleTimeString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US', { hour12: false }));
        }, 1000);
        return () => clearInterval(timer);
    }, [currentLanguage]);

    return (
        <div className="relative min-h-screen w-screen overflow-hidden bg-black text-gray-300 font-mono flex flex-col">
            <style>{/* ... styles ... */}</style>
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

        .animate-float {
            animation: float 6s ease-in-out infinite;
        }
        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
      `}</style>

            {/* Background Layers */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute inset-0 bg-[url('/hospital_corridor_blur.png')] bg-cover bg-center opacity-60 blur-sm filter contrast-125 saturate-50" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/40 to-black/90" />
                <div className="absolute inset-0 scanlines opacity-30" />
                <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_20%,rgba(0,0,0,1)_100%)]" />
            </div>

            {/* Header */}
            <header className="relative z-50 flex items-center justify-between px-6 py-4 border-b border-red-900/30 bg-black/60 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="h-6 w-auto px-2 border border-red-500 flex items-center justify-center bg-red-900/20 animate-pulse">
                        <span className="text-red-500 text-xs font-tech font-bold tracking-widest">{t('landing.rec')}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-sm font-bold tracking-widest text-white font-sc">{t('landing.agency')}</span>
                        <span className="text-red-500 text-[10px] font-mono">{t('landing.division')}</span>
                    </div>
                </div>
                <div className="flex items-center gap-6 text-[10px] font-bold tracking-[0.2em] text-gray-400 font-sc">
                    <span className="hidden md:inline hover:text-red-500 cursor-pointer transition-colors">{t('landing.database')}</span>
                    <span className="hidden md:inline hover:text-red-500 cursor-pointer transition-colors">{t('landing.personnel')}</span>
                    <span className="hidden md:inline text-red-500 animate-pulse">{t('landing.monitoring')}</span>

                    {/* Language Switcher */}
                    <div className="flex items-center border border-white/20 rounded overflow-hidden">
                        <button
                            onClick={() => onLanguageChange?.('en')}
                            className={`px-2 py-1 transition-colors ${currentLanguage === 'en' ? 'bg-red-900/50 text-white' : 'hover:bg-white/10'}`}
                        >
                            EN
                        </button>
                        <div className="w-[1px] h-full bg-white/20"></div>
                        <button
                            onClick={() => onLanguageChange?.('zh')}
                            className={`px-2 py-1 transition-colors ${currentLanguage === 'zh' ? 'bg-red-900/50 text-white' : 'hover:bg-white/10'}`}
                        >
                            中文
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 w-full max-w-7xl mx-auto">

                {/* Hero Title */}
                <div className="text-center mb-16 relative group cursor-default">
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] text-red-500 font-mono tracking-[0.5em] border border-red-900/30 px-3 py-1 bg-black/50 backdrop-blur-sm">
                        {t('landing.gameTitle')}
                    </div>
                    <h1 className="font-horror text-6xl md:text-9xl text-red-600 tracking-tighter mb-2 metric-glow relative z-10 transition-transform duration-500 group-hover:scale-105">
                        {t('landing.restricted')}
                    </h1>
                    <h2 className="text-2xl md:text-3xl text-gray-200 font-sc font-bold tracking-[0.3em] opacity-80 decoration-red-900/50 underline underline-offset-8">
                        {t('landing.scenarioTitle')}
                    </h2>
                </div>

                {/* POI Markers (Decorative) */}
                <div className="absolute top-1/4 left-[10%] hidden lg:block animate-float" style={{ animationDelay: '0s' }}>
                    <div className="relative group cursor-help">
                        <div className="w-3 h-3 bg-red-600 rounded-full shadow-[0_0_15px_red] relative z-20"></div>
                        <div className="absolute -top-1 -left-1 w-5 h-5 border border-red-500 rounded-full animate-ping opacity-50"></div>
                        <div className="absolute left-6 top-1/2 -translate-y-1/2 bg-black/80 border border-red-900/50 p-2 text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                            <span className="text-red-400 block font-bold font-sc">Warning: Memetic Hazard</span>
                            <span className="text-gray-400 font-mono">Reality Stability: 87%</span>
                        </div>
                    </div>
                </div>
                <div className="absolute bottom-1/3 right-[15%] hidden lg:block animate-float" style={{ animationDelay: '2s' }}>
                    <div className="relative group cursor-help">
                        <div className="w-3 h-3 bg-teal-500 rounded-full shadow-[0_0_15px_cyan] relative z-20"></div>
                        <div className="absolute -top-1 -left-1 w-5 h-5 border border-teal-500 rounded-full animate-ping opacity-50"></div>
                        <div className="absolute right-6 top-1/2 -translate-y-1/2 bg-black/80 border border-teal-900/50 p-2 text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none text-right">
                            <span className="text-teal-400 block font-bold font-sc">Node Active</span>
                            <span className="text-gray-400 font-sc">Secure Link Established</span>
                        </div>
                    </div>
                </div>

                {/* Dual Entry System */}
                {/* Dual Entry System */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl px-4">

                    {/* Human/Investigator Entry */}
                    <div
                        className={`
                    relative group cursor-pointer transition-all duration-500 ease-out
                    ${hoveredSection === 'agent' ? 'opacity-30 blur-sm scale-95' : 'opacity-100 scale-100'}
                    ${isHumanEntering ? 'pointer-events-none opacity-70' : ''}
                `}
                        onMouseEnter={() => setHoveredSection('human')}
                        onMouseLeave={() => setHoveredSection(null)}
                        onClick={() => {
                            if (!isHumanEntering) {
                                onHumanEnter();
                            }
                        }}
                    >
                        <div className="hud-frame h-full p-8 bg-black/80 backdrop-blur-xl border-red-900/30 hover:bg-red-950/20 transition-all duration-300 group-hover:border-red-600 flex flex-col">
                            <div className="absolute top-4 right-4 text-red-600 opacity-20 group-hover:opacity-100 transition-opacity">
                                <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1}
                                        d="M12 12a5 5 0 100-10 5 5 0 000 10zM3 21a9 9 0 0118 0"
                                    />
                                </svg>
                            </div>
                            <h3 className="text-3xl font-bold text-white mb-2 font-sc group-hover:text-red-500 transition-colors">
                                {t('landing.investigator')}
                            </h3>
                            <div className="text-xs font-mono text-red-400 mb-6 tracking-widest">{t('landing.human_link')}</div>

                            <div className="space-y-4 font-sc text-sm text-gray-400 flex-grow">
                                <p className="border-l-2 border-red-900/50 pl-3 group-hover:border-red-500 transition-colors">
                                    <strong className="text-gray-200 block mb-1">{t('landing.manual_mode')}</strong>
                                    {t('landing.manual_desc')}
                                </p>
                                <p className="text-xs opacity-60">
                                    {t('landing.manual_warning')}
                                </p>
                            </div>

                            <div className="mt-6 flex items-center justify-between text-red-500 font-bold text-xs tracking-widest uppercase opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0">
                                <span className="font-sc">{isHumanEntering ? t('auth.checking_session') : t('landing.init_seq')}</span>
                                <span className="material-symbols-outlined text-sm">{isHumanEntering ? 'hourglass_top' : 'arrow_forward'}</span>
                            </div>
                        </div>
                    </div>

                    {/* AI/Agent Entry */}
                    <div
                        className={`
                    relative group cursor-pointer transition-all duration-500 ease-out
                    ${hoveredSection === 'human' ? 'opacity-30 blur-sm scale-95' : 'opacity-100 scale-100'}
                `}
                        onMouseEnter={() => setHoveredSection('agent')}
                        onMouseLeave={() => setHoveredSection(null)}
                        onClick={onAgentEnter}
                    >
                        <div className="hud-frame h-full p-8 bg-black/80 backdrop-blur-xl border-teal-900/30 hover:bg-teal-950/20 transition-all duration-300 group-hover:border-teal-500 flex flex-col">
                            <div className="absolute top-4 right-4 text-teal-600 opacity-20 group-hover:opacity-100 transition-opacity">
                                <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <h3 className="text-3xl font-bold text-white mb-2 font-sc group-hover:text-teal-400 transition-colors">
                                {t('landing.agent_mode')}
                            </h3>
                            <div className="text-xs font-mono text-teal-400 mb-6 tracking-widest">{t('landing.agent_api')}</div>

                            <div className="space-y-4 font-sc text-sm text-gray-400 flex-grow">
                                <p className="border-l-2 border-teal-900/50 pl-3 group-hover:border-teal-500 transition-colors">
                                    <strong className="text-gray-200 block mb-1">{t('landing.agent_mode')}</strong>
                                    {t('landing.agent_desc')}
                                </p>

                                {/* Command Block */}
                                <div className="mt-4 bg-black/60 border border-teal-500/30 rounded p-3 relative group/code font-mono text-[10px] overflow-hidden">
                                    <div className="flex justify-between items-center text-teal-500/50 mb-1">
                                        <span>TERMINAL_ACCESS</span>
                                        <span>BASH</span>
                                    </div>
                                    <code className="block text-teal-300 break-all pr-6">
                                        curl -s https://rulesofsurvival.game/skill.md
                                    </code>
                                    <button
                                        className="absolute bottom-0.5 right-2 p-1 hover:bg-teal-500/20 rounded text-teal-500 transition-colors z-20"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigator.clipboard.writeText("curl -s https://rulesofsurvival.game/skill.md");
                                        }}
                                        title="Copy Command"
                                    >
                                        <span className="material-symbols-outlined text-sm">content_copy</span>
                                    </button>
                                </div>
                            </div>

                            <div className="mt-6 flex items-center justify-between text-teal-500 font-bold text-xs tracking-widest uppercase opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0">
                                <span className="font-sc">{t('landing.console_access')}</span>
                                <span className="material-symbols-outlined text-sm">terminal</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Stats */}
                <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-4xl px-4 text-[10px] font-mono text-gray-500">
                    <div className="border border-white/10 p-2 bg-black/40">
                        <span className="block text-red-800 font-bold font-sc">{t('landing.area_status')}</span>
                        <span className="text-red-500 font-sc">
                            {stats ? `${Math.round(stats.allTime.victoryRate * 100)}% ${t('landing.monitoring')}` : t('landing.critical_failure')}
                        </span>
                    </div>
                    <div className="border border-white/10 p-2 bg-black/40">
                        <span className="block text-gray-600 font-bold font-sc">{t('landing.agents')}</span>
                        <span className="text-gray-300 font-sc">{stats ? stats.allTime.users.toLocaleString() : '1,402'} {t('landing.online')}</span>
                    </div>
                    <div className="border border-white/10 p-2 bg-black/40">
                        <span className="block text-gray-600 font-bold font-sc">{t('landing.system_time')}</span>
                        <span className="text-accent-teal">{currentTime}</span>
                    </div>
                    <div className="border border-white/10 p-2 bg-black/40">
                        <span className="block text-gray-600 font-bold font-sc">{t('landing.version')}</span>
                        <span className="text-gray-400">{stats ? `RUNS:${stats.allTime.runsCompleted}` : '0.9.4.2_ALPHA'}</span>
                    </div>
                </div>
            </main>

            {/* Decorative Footer */}
            <footer className="relative z-10 w-full p-2 border-t border-white/5 bg-black/80 flex justify-between items-center text-[9px] text-gray-600 font-mono tracking-widest uppercase">
                <div className="font-sc">© 2026 {t('landing.agency')} // {t('landing.division')}</div>
                <div className="flex gap-4 font-sc">
                    <span>{t('landing.secure_conn')}</span>
                    <span>{t('landing.no_logs')}</span>
                </div>
            </footer>
        </div>
    );
};
