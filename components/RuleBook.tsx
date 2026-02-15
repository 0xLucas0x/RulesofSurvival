import { useTranslation } from 'react-i18next';

interface RuleBookProps {
  rules: string[];
}

export const RuleBook: React.FC<RuleBookProps> = ({ rules }) => {
  const { t } = useTranslation();
  return (
    <aside className="hidden lg:flex w-80 bg-[#1a0f0f] border-r border-red-900/30 flex-col shrink-0 relative shadow-2xl overflow-hidden backdrop-blur-sm">

      {/* Background Texture - Digital Noise */}
      <div className="absolute inset-0 opacity-5 pointer-events-none"
        style={{ backgroundImage: "url('https://www.transparenttextures.com/patterns/carbon-fibre.png')" }}></div>
      <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/80 pointer-events-none"></div>

      {/* Medical Header Bar */}
      <div className="relative pt-6 pb-4 px-6 border-b border-red-900/20 bg-red-950/10">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[10px] font-tech text-red-400 tracking-[0.3em] uppercase animate-pulse">
            {t('rulebook.secure_file')}
          </span>
          <span className="material-symbols-outlined text-red-500 text-sm">local_hospital</span>
        </div>

        <h2 className="text-xl font-header font-bold text-red-50 uppercase tracking-widest mb-1 flex items-center gap-2">
          <span className="w-1 h-4 bg-red-600"></span>
          {t('rulebook.title')}
        </h2>
        <p className="text-[10px] font-mono text-red-300 tracking-wider">
          {t('rulebook.auth')}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar pb-20 relative">
        {/* Subtle grid line backdrop */}
        <div className="absolute inset-0 pointer-events-none opacity-5"
          style={{ backgroundImage: 'linear-gradient(0deg, transparent 24%, rgba(255, 255, 255, .3) 25%, rgba(255, 255, 255, .3) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, .3) 75%, rgba(255, 255, 255, .3) 76%, transparent 77%, transparent)', backgroundSize: '30px 30px' }}>
        </div>

        <div className="space-y-4 relative z-10">
          {rules.map((rule, index) => (
            <div key={index} className="group relative pl-4 border-l border-red-900/20 hover:border-red-500/50 transition-colors py-1">
              {/* Number Indicator */}
              <span className="absolute -left-[5px] top-2 w-[9px] h-[1px] bg-red-600 group-hover:bg-red-400 group-hover:w-[15px] transition-all"></span>

              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-mono text-red-500 group-hover:text-red-300 uppercase tracking-widest">
                  {t('rulebook.rule_prefix')}{index + 1}
                </span>
                <p className="text-sm leading-relaxed font-body text-gray-300 group-hover:text-white transition-colors group-hover:font-bold">
                  {rule}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer Glitch Block */}
        <div className="mt-8 border-t border-dashed border-red-900/30 pt-4 opacity-80">
          <div className="text-[9px] font-mono text-red-400/80 uppercase tracking-widest mb-2">
            {t('rulebook.corruption')}
          </div>
          <div className="h-2 w-full bg-red-900/10 overflow-hidden relative">
            <div className="absolute inset-0 bg-red-500/20 w-1/3 animate-[pulse_2s_infinite]"></div>
          </div>
        </div>
      </div>
    </aside>
  );
};