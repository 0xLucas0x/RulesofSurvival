import React, { useState, useEffect, useRef } from 'react';

interface GameIntroProps {
    onStart: () => void;
}

interface IntroLine {
    text: string;
    style: 'normal' | 'dim' | 'danger' | 'clue' | 'title' | 'rule' | 'system';
    delay?: number;
    glitch?: boolean;
}

const INTRO_LINES: IntroLine[] = [
    { text: 'intro.system_boot', style: 'system', delay: 0 },
    { text: 'intro.loading', style: 'system', delay: 500 },
    { text: 'intro.interference', style: 'danger', delay: 800, glitch: true },
    { text: 'intro.rerouting', style: 'system', delay: 500 },
    { text: '', style: 'normal', delay: 600 },
    { text: 'intro.line1', style: 'normal', delay: 400 },
    { text: '', style: 'normal', delay: 300 },
    { text: 'intro.line2', style: 'normal', delay: 300 },
    { text: 'intro.line3', style: 'normal', delay: 400, glitch: true },
    { text: '', style: 'normal', delay: 400 },
    { text: 'intro.line4', style: 'normal', delay: 400 },
    { text: 'intro.line5', style: 'normal', delay: 300 },
    { text: 'intro.patient_id', style: 'title', delay: 800, glitch: true },
    { text: '', style: 'normal', delay: 600 },
    { text: 'intro.line6', style: 'dim', delay: 400 },
    { text: 'intro.line7', style: 'dim', delay: 300 },
    { text: 'intro.line8', style: 'danger', delay: 500 },
    { text: '', style: 'normal', delay: 500 },
    { text: 'intro.line9', style: 'normal', delay: 400 },
    { text: '', style: 'normal', delay: 300 },
    { text: '┌──────────────────────────────┐', style: 'rule', delay: 400 },
    { text: 'intro.rule_title', style: 'rule', delay: 300 },
    { text: '├──────────────────────────────┤', style: 'rule', delay: 150 },
    { text: 'intro.rule1', style: 'rule', delay: 400 },
    { text: 'intro.rule2', style: 'rule', delay: 300 },
    { text: 'intro.rule3', style: 'rule', delay: 150 },
    { text: 'intro.rule4', style: 'rule', delay: 400 },
    { text: '└──────────────────────────────┘', style: 'rule', delay: 300 },
    { text: '', style: 'normal', delay: 600 },
    { text: 'intro.line10', style: 'normal', delay: 300 },
    { text: 'intro.line11', style: 'normal', delay: 300 },
    { text: '', style: 'normal', delay: 400 },
    { text: 'intro.clue', style: 'clue', delay: 600, glitch: true },
    { text: '', style: 'normal', delay: 1000 },
    { text: 'intro.line12', style: 'danger', delay: 400 },
    { text: 'intro.danger', style: 'danger', delay: 600, glitch: true },
];

const getLineStyle = (style: IntroLine['style']): string => {
    switch (style) {
        case 'system':
            return 'font-mono text-sm tracking-[0.2em] text-emerald-500/70 uppercase';
        case 'dim':
            return 'text-emerald-500/50 italic font-body';
        case 'danger':
            return 'text-red-500 font-bold font-header tracking-wider drop-shadow-[0_0_8px_rgba(220,38,38,0.9)]';
        case 'clue':
            return 'text-yellow-400 font-hand text-2xl italic tracking-wide underline decoration-dotted decoration-yellow-700 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]';
        case 'title':
            return 'text-red-500 font-header text-4xl tracking-[0.5em] font-bold text-center py-4 border-y border-red-900/40 bg-red-950/30 text-shadow-red glitch-title';
        case 'rule':
            return 'font-mono text-sm text-emerald-200/80 tracking-wider bg-emerald-950/20';
        default:
            return 'text-emerald-100/90 font-body text-lg';
    }
};

import { useTranslation } from 'react-i18next';

export const GameIntro: React.FC<GameIntroProps> = ({ onStart }) => {
    const { t } = useTranslation();
    const [visibleLines, setVisibleLines] = useState(0);
    const [showButton, setShowButton] = useState(false);
    const [isExiting, setIsExiting] = useState(false);
    const [powerOn, setPowerOn] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // CRT power-on
    useEffect(() => {
        const t = setTimeout(() => setPowerOn(true), 300);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        if (!powerOn) return;

        let timeoutId: ReturnType<typeof setTimeout>;
        let currentLine = 0;

        const showNextLine = () => {
            if (currentLine >= INTRO_LINES.length) {
                setTimeout(() => setShowButton(true), 1200);
                return;
            }
            // Increased base delay by 25% (80ms -> 100ms) + explicit delay scaling
            const delay = (INTRO_LINES[currentLine].delay ?? 200) * 1.25;
            currentLine++;
            setVisibleLines(currentLine);

            requestAnimationFrame(() => {
                if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
            });

            timeoutId = setTimeout(showNextLine, delay + 100);
        };

        timeoutId = setTimeout(showNextLine, 1500);
        return () => clearTimeout(timeoutId);
    }, [powerOn]);

    const handleStart = () => {
        setIsExiting(true);
        setTimeout(() => onStart(), 600);
    };

    const handleSkip = () => {
        if (showButton) return;
        setVisibleLines(INTRO_LINES.length);
        setShowButton(true);
    };

    return (
        <div
            className={`fixed inset-0 z-[100] bg-[#050a05] flex items-center justify-center transition-opacity duration-700 ${isExiting ? 'opacity-0' : 'opacity-100'}`}
            onClick={handleSkip}
        >
            <style>{`
        /* Stronger Glitch: Larger displacement, more opacity variation */
        @keyframes intro-glitch {
          0% { transform: translate(0); opacity: 1; }
          10% { transform: translate(-3px, 3px); opacity: 0.7; }
          20% { transform: translate(-3px, -3px); opacity: 1; }
          30% { transform: translate(3px, 3px); opacity: 0.7; }
          40% { transform: translate(3px, -3px); opacity: 1; }
          50% { transform: translate(-2px, 2px); opacity: 0.8; }
          60% { transform: translate(4px, -2px); opacity: 0.6; }
          70% { transform: translate(-4px, 1px); opacity: 1; }
          80% { transform: translate(2px, -3px); opacity: 0.8; }
          90% { transform: translate(-1px, 3px); opacity: 1; }
          100% { transform: translate(0); opacity: 1; }
        }
        
        /* Stronger RGB Shift: Larger shadow offsets */
        @keyframes intro-rgb-shift {
          0% { text-shadow: 3px 0 #ff0000, -3px 0 #00ffff; }
          25% { text-shadow: -3px 0 #ff0000, 3px 0 #00ffff; }
          50% { text-shadow: 3px 0 #ff0000, -3px 0 #00ffff; }
          75% { text-shadow: -3px 0 #ff0000, 3px 0 #00ffff; }
          100% { text-shadow: 3px 0 #ff0000, -3px 0 #00ffff; }
        }

        .glitch-text {
          animation: intro-glitch 0.2s cubic-bezier(.25, .46, .45, .94) both infinite;
        }
        .glitch-title {
          animation: intro-rgb-shift 0.15s infinite alternate, intro-glitch 0.4s infinite;
        }
        .crt-line-scroll {
          animation: crt-line 5s linear infinite;
        }
        @keyframes crt-line {
          0% { top: -5%; opacity: 0; }
          5% { opacity: 0.5; }
          95% { opacity: 0.5; }
          100% { top: 105%; opacity: 0; }
        }
        /* Intense Red Glow for corrupted text */
        .text-shadow-red {
          text-shadow: 0 0 15px rgba(220, 38, 38, 0.9), 2px 2px 0px rgba(0,0,0,0.8);
        }
      `}</style>

            {/* CRT Monitor Frame */}
            <div className={`relative w-full h-full max-w-5xl max-h-[90vh] mx-4 transition-all duration-700 ${powerOn ? 'scale-100 opacity-100' : 'scale-y-[0.005] opacity-0'}`}>

                {/* Screen Bezel & Glass */}
                <div className="absolute inset-0 rounded-lg border-[2px] border-[#333] bg-black overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)]">

                    {/* Phosphor Glow Backlight - Slightly stronger for contrast against glitches */}
                    <div className="absolute inset-0 pointer-events-none opacity-25"
                        style={{
                            background: 'radial-gradient(circle, rgba(16,185,129,0.15) 0%, rgba(0,0,0,0) 80%)'
                        }}
                    ></div>

                    {/* Scanlines */}
                    <div className="absolute inset-0 pointer-events-none z-20 opacity-20"
                        style={{
                            background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.2))',
                            backgroundSize: '100% 4px'
                        }}
                    ></div>

                    {/* Screen Curvature Vignette */}
                    <div className="absolute inset-0 pointer-events-none z-30 opacity-80"
                        style={{
                            background: 'radial-gradient(circle at center, transparent 60%, rgba(0,0,0,0.8) 100%)'
                        }}
                    ></div>

                    {/* Scrolling Scan Line */}
                    <div className="absolute w-full h-1 bg-white/10 z-20 crt-line-scroll"></div>

                    {/* Content Area */}
                    <div
                        ref={scrollRef}
                        className="relative z-10 h-full overflow-y-auto px-8 py-10 custom-scrollbar"
                    >
                        {/* Header Status Bar */}
                        <div className="flex justify-between items-center border-b border-emerald-900/50 pb-2 mb-6 font-mono text-xs text-emerald-600/60 uppercase tracking-widest">
                            <span>System_V.0.9.3 // Override</span>
                            <div className="flex items-center gap-2">
                                <span>Memory: 64kb</span>
                                <div className={`w-2 h-2 bg-emerald-500 rounded-full ${powerOn ? 'animate-pulse' : ''}`}></div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {INTRO_LINES.slice(0, visibleLines).map((line, i) => (
                                <div
                                    key={i}
                                    className={`
                    ${getLineStyle(line.style)} 
                    ${line.text === '' ? 'h-4' : ''}
                    ${line.glitch ? 'glitch-text text-shadow-red' : ''}
                    transition-all duration-100 origin-left
                  `}
                                    style={{
                                        animation: line.glitch ? 'none' : 'fadeSlideIn 0.3s ease-out forwards',
                                    }}
                                >
                                    {/* Prompt arrow for system lines */}
                                    {line.style === 'system' && <span className="mr-3 select-none opacity-50">{'>'}</span>}
                                    {line.text.startsWith('intro.') ? t(line.text) : line.text}
                                </div>
                            ))}
                        </div>

                        {/* Blinking Cursor */}
                        {!showButton && powerOn && (
                            <div className="mt-4 animate-pulse">
                                <span className="inline-block w-3 h-5 bg-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
                            </div>
                        )}

                        {/* Bottom Spacer */}
                        <div className="h-24"></div>

                        {/* Enter Button */}
                        {showButton && (
                            <div className="fixed bottom-12 left-0 right-0 flex justify-center z-50 animate-[fadeSlideIn_0.8s_ease-out]">
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleStart(); }}
                                    className="
                    group relative px-16 py-5 
                    bg-black/90 backdrop-blur-sm
                    border border-emerald-500/50 hover:border-emerald-400
                    text-emerald-500 font-header text-xl tracking-[0.4em] font-bold uppercase
                    transition-all duration-200
                    hover:bg-emerald-900/20 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]
                    active:scale-95
                  "
                                >
                                    <div className="absolute -top-1 -left-1 w-2 h-2 border-t border-l border-emerald-500"></div>
                                    <div className="absolute -top-1 -right-1 w-2 h-2 border-t border-r border-emerald-500"></div>
                                    <div className="absolute -bottom-1 -left-1 w-2 h-2 border-b border-l border-emerald-500"></div>
                                    <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b border-r border-emerald-500"></div>

                                    <span className="relative z-10 group-hover:text-emerald-100 transition-colors">
                                        {t('landing.enter')}
                                    </span>

                                    {/* Button Glitch Hover */}
                                    <div className="absolute inset-0 bg-emerald-400/10 opacity-0 group-hover:opacity-100 transition-opacity mix-blend-overlay animate-pulse"></div>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
