import React, { useState, useEffect, useRef } from 'react';
import { Choice } from '../types';

interface MainDisplayProps {
  imagePrompt: string;
  narrative: string;
  isLoading: boolean;
  choices: Choice[];
  onMakeChoice: (choice: Choice) => void;
  isGameOver: boolean;
  isVictory?: boolean;
  pollinationsApiKey?: string;
  pollinationsModel?: string;
  imageProvider?: 'pollinations' | 'openai';
  imageModel?: string;
  imageBaseUrl?: string;
  imageApiKey?: string;
  // LLM credentials (for fallback when image-specific ones are empty)
  llmProvider?: 'gemini' | 'openai';
  llmBaseUrl?: string;
  llmApiKey?: string;
  enableImageGen?: boolean;
}

const getActionIcon = (type: string) => {
  switch (type) {
    case 'move': return 'directions_run';
    case 'investigate': return 'visibility';
    case 'item': return 'back_hand';
    case 'risky': return 'skull';
    default: return 'radio_button_checked';
  }
};

const getActionLabel = (type: string) => {
  switch (type) {
    case 'move': return '移动';
    case 'investigate': return '调查';
    case 'item': return '物品';
    case 'risky': return '高危';
    default: return '常规';
  }
};

const getActionStyles = (type: string) => {
  switch (type) {
    case 'move':
      return 'border-blue-800/60 text-blue-100 hover:bg-blue-900/40 hover:border-blue-400';
    case 'investigate':
      return 'border-amber-800/60 text-amber-100 hover:bg-amber-900/40 hover:border-amber-400';
    case 'item':
      return 'border-emerald-800/60 text-emerald-100 hover:bg-emerald-900/40 hover:border-emerald-400';
    case 'risky':
      return 'border-red-800/80 text-red-100 bg-red-950/20 hover:bg-red-900/50 hover:border-red-500 animate-[pulse_3s_infinite]';
    default:
      return 'border-gray-700 text-gray-300 hover:bg-gray-800';
  }
};

// --- Typewriter Component ---
interface Segment {
  type: 'text' | 'danger' | 'dialogue' | 'clue';
  content: string;
}

const TypewriterText: React.FC<{ text: string, speed?: number }> = ({ text, speed = 30 }) => {
  const [displayedSegments, setDisplayedSegments] = useState<Segment[]>([]);
  const [isDone, setIsDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reset state when text changes
    setDisplayedSegments([]);
    setIsDone(false);

    // 1. Parse the text into segments
    const regex = /<(danger|dialogue|clue)>(.*?)<\/\1>|([^<]+)/g;
    let match;
    const parsedSegments: Segment[] = [];

    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        // Matched a tag
        parsedSegments.push({ type: match[1] as any, content: match[2] });
      } else if (match[3]) {
        // Matched plain text
        parsedSegments.push({ type: 'text', content: match[3] });
      }
    }

    // 2. Animate loop
    let currentSegmentIndex = 0;
    let currentCharIndex = 0;
    const totalSegments = parsedSegments.map(s => ({ ...s, content: "" })); // Start empty

    setDisplayedSegments([...totalSegments]);

    const interval = setInterval(() => {
      if (currentSegmentIndex >= parsedSegments.length) {
        clearInterval(interval);
        setIsDone(true);
        return;
      }

      const targetSegment = parsedSegments[currentSegmentIndex];

      // Add one character
      totalSegments[currentSegmentIndex].content = targetSegment.content.substring(0, currentCharIndex + 1);

      // Update state
      setDisplayedSegments([...totalSegments]);

      // Move cursor
      currentCharIndex++;

      // Check if segment is finished
      if (currentCharIndex >= targetSegment.content.length) {
        currentSegmentIndex++;
        currentCharIndex = 0;
      }

      // Auto-scroll
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }

    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return (
    <div ref={containerRef} className="text-lg md:text-xl leading-relaxed font-body tracking-wide whitespace-pre-line text-justify overflow-y-auto custom-scrollbar pb-2 max-h-[45vh] pr-2">
      {displayedSegments.map((seg, i) => {
        if (!seg.content) return null;

        let className = "text-gray-300 transition-colors duration-300";
        if (seg.type === 'danger') className = "text-red-600 font-header font-bold animate-[pulse_2s_infinite] tracking-widest text-shadow-red";
        if (seg.type === 'dialogue') className = "text-cyan-200 font-hand italic text-xl md:text-2xl tracking-wider";
        if (seg.type === 'clue') className = "text-yellow-500 font-bold underline decoration-dotted decoration-yellow-700 decoration-2 underline-offset-4";

        return <span key={i} className={className}>{seg.content}</span>;
      })}
      {!isDone && <span className="inline-block w-2 h-4 bg-red-500 ml-1 animate-pulse align-middle shadow-[0_0_8px_#ef4444]"></span>}
    </div>
  );
};

export const MainDisplay: React.FC<MainDisplayProps> = ({
  imagePrompt,
  narrative,
  isLoading,
  choices,
  onMakeChoice,
  isGameOver,
  isVictory,
  pollinationsApiKey,
  pollinationsModel = 'flux',
  imageProvider,
  imageModel,
  imageBaseUrl,
  imageApiKey,
  llmProvider,
  llmBaseUrl,
  llmApiKey,
  enableImageGen = true
}) => {
  // Use Pollinations AI or OpenAI for dynamic image generation
  const [imageUrl, setImageUrl] = useState<string>('');
  const [isImageLoading, setIsImageLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchImage = async () => {
      // Skip image generation if disabled
      if (!enableImageGen) {
        setImageUrl('');
        return;
      }

      // Define the prompt and base URL
      const fullPrompt = imagePrompt + ", horror style, cinematic lighting, gritty, dark atmosphere, 8k, photorealistic, night vision or surveillance camera style";

      // Default to Pollinations if not specified
      const currentProvider = imageProvider || 'pollinations';

      // Resolve effective credentials: fall back to LLM credentials if image-specific ones are empty
      const effectiveImageBaseUrl = imageBaseUrl || (llmProvider === 'openai' ? llmBaseUrl : '') || '';
      const effectiveImageApiKey = imageApiKey || (llmProvider === 'openai' ? llmApiKey : '') || '';

      console.log("[MainDisplay] Image Gen triggered. Provider:", currentProvider);
      console.log("[MainDisplay] Config:", {
        key: effectiveImageApiKey ? "Set" : "Missing",
        url: effectiveImageBaseUrl || "Missing",
        model: imageModel,
        usingLlmFallback: (!imageBaseUrl || !imageApiKey) && llmProvider === 'openai'
      });

      if (currentProvider === 'openai') {
        if (!effectiveImageApiKey || !effectiveImageBaseUrl) {
          console.warn("[MainDisplay] OpenAI Image Provider selected but missing configuration (no image or LLM credentials found)");
          return;
        }
        setIsImageLoading(true);
        try {
          const { generateOpenAIImage } = await import('../services/geminiService');
          const b64Image = await generateOpenAIImage(fullPrompt, effectiveImageApiKey, effectiveImageBaseUrl, imageModel || 'dall-e-3');
          if (active) setImageUrl(b64Image);
        } catch (e) {
          console.error("OpenAI Image Gen Error:", e);
        } finally {
          if (active) setIsImageLoading(false);
        }
        return;
      }

      // Pollinations Logic — use direct img src URL (avoids CORS)
      // img tags are not subject to CORS, so we can pass the key as a query param
      const encodedPrompt = encodeURIComponent(fullPrompt);
      const seed = Math.floor(Math.random() * 1000000);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&model=${pollinationsModel}&nologo=true&seed=${seed}${pollinationsApiKey ? `&key=${pollinationsApiKey}` : ''}`;

      if (active) setImageUrl(imageUrl);
    };

    fetchImage();

    return () => {
      active = false;
      // Ideally revoke object URL here but we need to track it.
    };
  }, [imagePrompt, pollinationsApiKey, pollinationsModel, imageProvider, imageModel, imageBaseUrl, imageApiKey, llmProvider, llmBaseUrl, llmApiKey, enableImageGen]);

  // Determine grid layout based on choice count
  const gridClasses = choices.length === 4
    ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-2"
    : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  // Visual Theme Adjustment based on Victory/Defeat
  const themeColor = isVictory ? "text-emerald-500" : "text-red-600";
  const borderColor = isVictory ? "border-emerald-500/50" : "border-red-800/60";
  const overlayColor = isVictory ? "bg-emerald-900" : "bg-red-900";

  return (
    <section className="flex-1 flex flex-col relative overflow-hidden bg-black h-full font-sans">

      {/* Glitch animation styles */}
      <style>{`
        @keyframes glitch-anim {
          0% { transform: translate(0); }
          2% { transform: translate(2px, -1px); }
          4% { transform: translate(-2px, 1px); }
          6% { transform: translate(1px, 2px); }
          8% { transform: translate(-1px, -2px); }
          10% { transform: translate(0); }
          100% { transform: translate(0); }
        }
        @keyframes glitch-skew {
          0% { transform: skew(0deg); }
          2% { transform: skew(2deg); }
          4% { transform: skew(-1deg); }
          6% { transform: skew(3deg); }
          8% { transform: skew(-2deg); }
          10% { transform: skew(0deg); }
          100% { transform: skew(0deg); }
        }
        @keyframes glitch-color-r {
          0% { transform: translate(0); opacity: 0.8; }
          2% { transform: translate(3px, -1px); opacity: 0.6; }
          4% { transform: translate(-2px, 1px); opacity: 0.8; }
          6% { transform: translate(1px, 2px); opacity: 0.5; }
          8% { transform: translate(-3px, -1px); opacity: 0.7; }
          10% { transform: translate(0); opacity: 0.8; }
          100% { transform: translate(0); opacity: 0.8; }
        }
        @keyframes glitch-color-b {
          0% { transform: translate(0); opacity: 0.8; }
          2% { transform: translate(-3px, 1px); opacity: 0.7; }
          4% { transform: translate(2px, -1px); opacity: 0.5; }
          6% { transform: translate(-1px, -2px); opacity: 0.8; }
          8% { transform: translate(3px, 1px); opacity: 0.6; }
          10% { transform: translate(0); opacity: 0.8; }
          100% { transform: translate(0); opacity: 0.8; }
        }
        @keyframes scanline {
          0% { top: -10%; }
          100% { top: 110%; }
        }
        @keyframes flicker {
          0%, 100% { opacity: 0.35; }
          5% { opacity: 0.2; }
          10% { opacity: 0.4; }
          15% { opacity: 0.15; }
          20% { opacity: 0.35; }
          50% { opacity: 0.3; }
          80% { opacity: 0.25; }
          95% { opacity: 0.4; }
        }
        .glitch-active {
          animation: glitch-anim 0.3s infinite linear alternate-reverse, glitch-skew 0.5s infinite linear alternate-reverse;
        }
        .glitch-active::before,
        .glitch-active::after {
          content: '';
          position: absolute;
          inset: 0;
          background: inherit;
          background-size: cover;
          background-position: center;
        }
        .glitch-active::before {
          animation: glitch-color-r 0.3s infinite linear alternate-reverse;
          mix-blend-mode: multiply;
          background-color: rgba(255, 0, 0, 0.15);
        }
        .glitch-active::after {
          animation: glitch-color-b 0.3s infinite linear alternate-reverse;
          mix-blend-mode: multiply;
          background-color: rgba(0, 0, 255, 0.15);
        }
      `}</style>

      {/* --- Immersive Background Layer --- */}
      <div className="absolute inset-0 z-0 select-none">
        <img
          key={imagePrompt}
          src={imageUrl}
          alt="Environment"
          className={`w-full h-full object-cover transition-all duration-700 ${isImageLoading
            ? 'opacity-30 blur-[2px] scale-105 glitch-active'
            : isLoading
              ? 'opacity-40 blur-sm scale-105'
              : 'opacity-60 scale-100'
            }`}
          style={{ filter: `contrast(120%) saturate(${isImageLoading ? '20%' : '40%'}) sepia(30%) ${isImageLoading ? 'hue-rotate(15deg)' : ''}` }}
        />
        {/* Scanline overlay during image loading */}
        {isImageLoading && (
          <>
            <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ mixBlendMode: 'overlay' }}>
              <div
                className="absolute w-full"
                style={{
                  height: '30%',
                  background: 'linear-gradient(to bottom, transparent 0%, rgba(74,93,78,0.15) 50%, transparent 100%)',
                  animation: 'scanline 1.5s linear infinite',
                }}
              />
            </div>
            {/* Horizontal glitch lines */}
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
              animation: 'flicker 0.5s infinite',
            }} />
          </>
        )}
        {/* Vignette & Gradients to make text readable */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/80"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-transparent"></div>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.6) 100%)" }}></div>
      </div>

      {/* --- HUD Elements (Camera Overlay) --- */}
      <div className={`absolute top-4 left-4 z-10 flex flex-col font-header ${themeColor} text-xs md:text-sm tracking-[0.2em] opacity-80 pointer-events-none`}>
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 ${isVictory ? 'bg-emerald-500' : 'bg-red-600'} rounded-full animate-pulse shadow-[0_0_8px_currentColor]`}></span>
          {isGameOver ? (isVictory ? '传输完成' : '连接中断') : '录制中'}
        </span>
        <span className="text-hospital-white/60 mt-1">机位_04 [夜视模式]</span>
      </div>
      <div className="absolute top-4 right-4 z-10 font-header text-hospital-white/50 text-xs md:text-sm tracking-widest pointer-events-none text-right">
        <div>{new Date().toLocaleTimeString('zh-CN', { hour12: false })}</div>
        <div className="text-[10px] mt-1 opacity-50">ISO 12800 • f/1.4</div>
      </div>

      {/* --- Loading Indicator (Centered) --- */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none bg-black/20 backdrop-blur-[2px]">
          <div className="font-header text-hospital-white text-lg md:text-xl animate-pulse tracking-[0.3em] bg-black/80 px-8 py-4 border border-white/20 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
            <span className="inline-block w-2 h-2 bg-red-500 mr-3 animate-bounce"></span>
            数据传输中...
          </div>
        </div>
      )}

      {/* --- Main Content Area (Bottom Aligned) --- */}
      <div className="flex-1 flex flex-col justify-end z-10 relative p-4 md:p-8 space-y-6 overflow-hidden max-w-6xl mx-auto w-full">

        {/* Narrative Box - Floating above controls */}
        <div className="w-full flex flex-col justify-end min-h-0">
          {/* Terminal Window Style */}
          <div className={`relative group bg-black/80 border ${isVictory ? 'border-emerald-500/30' : 'border-white/10'} shadow-2xl backdrop-blur-sm transition-all duration-500 hover:border-white/20`}>

            {/* Corner Brackets */}
            <div className={`absolute -top-[1px] -left-[1px] w-4 h-4 border-t-2 border-l-2 ${borderColor} z-10`}></div>
            <div className={`absolute -top-[1px] -right-[1px] w-4 h-4 border-t-2 border-r-2 ${borderColor} z-10`}></div>
            <div className={`absolute -bottom-[1px] -left-[1px] w-4 h-4 border-b-2 border-l-2 ${borderColor} z-10`}></div>
            <div className={`absolute -bottom-[1px] -right-[1px] w-4 h-4 border-b-2 border-r-2 ${borderColor} z-10`}></div>

            {/* Header Bar */}
            <div className="h-6 bg-white/5 border-b border-white/10 flex items-center justify-between px-3">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 ${isVictory ? 'bg-emerald-500' : 'bg-red-900'} rounded-full`}></div>
                <span className="font-header text-[10px] text-white/40 tracking-widest uppercase">系统日志_自动存档.txt</span>
              </div>
              <span className={`font-mono text-[10px] ${isVictory ? 'text-emerald-500/60' : 'text-red-500/60'}`}>{Math.floor(Math.random() * 9999)}-X</span>
            </div>

            {/* Content Area */}
            <div className="p-5 md:p-6 relative">
              {/* Background Grid Line */}
              <div className="absolute inset-0 pointer-events-none opacity-5"
                style={{ backgroundImage: 'linear-gradient(0deg, transparent 24%, rgba(255, 255, 255, .3) 25%, rgba(255, 255, 255, .3) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, .3) 75%, rgba(255, 255, 255, .3) 76%, transparent 77%, transparent), linear-gradient(90deg, transparent 24%, rgba(255, 255, 255, .3) 25%, rgba(255, 255, 255, .3) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, .3) 75%, rgba(255, 255, 255, .3) 76%, transparent 77%, transparent)', backgroundSize: '30px 30px' }}>
              </div>

              <TypewriterText text={narrative} />

              {isGameOver && (
                <div className={`mt-4 pt-4 border-t ${isVictory ? 'border-emerald-900/50' : 'border-red-900/30'} shrink-0 text-center`}>
                  <p className={`${isVictory ? 'text-emerald-400 shadow-emerald-900' : 'text-red-600 shadow-red-900'} font-header text-2xl animate-pulse tracking-[0.2em] drop-shadow-lg`}>
                    {isVictory ? '✔ 档案归档 // 生还确认' : '⚠ 信号丢失 // 连接断开'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Control Panel (Integrated HUD Style) */}
        <div className={`w-full grid ${gridClasses} gap-4 shrink-0 pb-2`}>
          {choices.map((choice) => {
            const isRisky = choice.actionType === 'risky';
            return (
              <button
                key={choice.id}
                onClick={() => onMakeChoice(choice)}
                disabled={isLoading || isGameOver}
                className={`
                  group relative flex items-stretch text-left
                  min-h-[4rem] h-auto w-full
                  border bg-black/60 backdrop-blur-md
                  transition-all duration-200
                  ${isLoading || isGameOver ? 'opacity-40 grayscale cursor-not-allowed' : 'active:translate-y-[2px] hover:bg-black/80'}
                  ${getActionStyles(choice.actionType)}
                `}
              >
                {/* Tech Deco Lines */}
                <div className="absolute top-0 left-0 w-[2px] h-full bg-current opacity-20 group-hover:opacity-100 transition-opacity"></div>
                <div className="absolute top-0 right-0 w-[2px] h-[8px] bg-current opacity-50"></div>
                <div className="absolute bottom-0 right-0 w-[2px] h-[8px] bg-current opacity-50"></div>
                <div className="absolute top-0 right-0 w-[8px] h-[2px] bg-current opacity-50"></div>
                <div className="absolute bottom-0 right-0 w-[8px] h-[2px] bg-current opacity-50"></div>

                {/* Icon Section - Boxy */}
                <div className={`
                  shrink-0 w-14 flex items-center justify-center border-r border-white/5
                  ${isRisky ? 'bg-red-950/30 text-red-500' : 'bg-white/5'}
                `}>
                  <span className="material-symbols-outlined text-2xl group-hover:scale-110 transition-transform opacity-70 group-hover:opacity-100">
                    {getActionIcon(choice.actionType)}
                  </span>
                </div>

                {/* Text Section */}
                <div className="flex-1 p-3 pl-4 flex flex-col justify-center">
                  <div className="text-[10px] font-mono opacity-40 mb-1 tracking-widest uppercase">
                    选项_0{choice.id} // {getActionLabel(choice.actionType)}
                  </div>
                  <span className="font-header text-sm md:text-base font-bold tracking-wider leading-tight w-full break-words group-hover:text-white transition-colors">
                    {choice.text}
                  </span>
                </div>

                {/* Hover Scanline (Vertical) */}
                <div className="absolute top-0 bottom-0 w-[1px] bg-white/20 left-0 group-hover:left-full transition-all duration-1000 ease-in-out opacity-0 group-hover:opacity-100"></div>
              </button>
            );
          })}

          {isGameOver && (
            <button
              onClick={() => window.location.reload()}
              className={`md:col-span-full h-16 ${isVictory ? 'bg-emerald-950/80 hover:bg-emerald-900 border-emerald-500 text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.2)]' : 'bg-red-950/80 hover:bg-red-900 border-red-500 text-red-100 shadow-[0_0_20px_rgba(220,38,38,0.2)]'} border font-header text-xl tracking-[0.3em] uppercase backdrop-blur-md transition-all flex items-center justify-center gap-4 group`}
            >
              <span className="material-symbols-outlined group-hover:rotate-180 transition-transform duration-500">restart_alt</span>
             // {isVictory ? '新游戏' : '系统重启'} //
            </button>
          )}
        </div>
      </div>
    </section>
  );
};