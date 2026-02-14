import { useTranslation } from 'react-i18next';

interface HeaderProps {
  sanity: number;
  location: string;
  onOpenEvidence: () => void;
  onOpenSettings: () => void;
  hasNewEvidence?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ sanity, location, onOpenEvidence, onOpenSettings, hasNewEvidence }) => {
  const { t } = useTranslation();
  let sanityColor = "bg-green-500";
  // We can't really look up 'stable'/'volatile' without keys, but sanityText technically isn't used in the updated render likely, 
  // or if passed to something else. 
  // Wait, I see `sanityText` variable but it is NOT used in the returned JSX in the original file!
  // Line 68 uses `sanity` (number) but not `sanityText`.
  // Wait, I should check if `sanityText` is used.
  // Checking Step 91, lines 65-73:
  /*
  <span className="flex items-center gap-2">
    <span className={`w-2 h-2 rounded-full ${sanityColor} animate-pulse shadow-[0_0_8px_currentColor]`}></span>
    <span className="hidden md:inline">理智值:</span> {sanity}%
  </span>
  */
  // So `sanityText` is unused variable. I can remove it or ignore it.

  if (sanity < 70) {
    sanityColor = "bg-yellow-500";
  }
  if (sanity < 30) {
    sanityColor = "bg-red-600";
  }

  return (
    <header className="h-16 bg-metal-dark border-b-4 border-rust flex items-center justify-between px-6 z-30 relative shadow-lg shrink-0">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 bg-hospital-white rounded-full flex items-center justify-center border-2 border-rust text-blood-fresh">
          <span className="material-symbols-outlined text-xl font-bold">local_hospital</span>
        </div>
        <span className="hidden md:inline font-header text-hospital-white tracking-widest text-lg md:text-xl shadow-black drop-shadow-md truncate">
          {t('landing.agency')} | SYS.v0.9
        </span>
        <span className="md:hidden font-header text-hospital-white tracking-widest text-lg">
          {t('landing.agency')}
        </span>
      </div>

      <div className="flex items-center gap-4 md:gap-6">
        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-3 py-1 bg-black/40 hover:bg-black/60 border border-metal-grey/50 hover:border-metal-grey rounded transition-all group"
          title={t('hud.settings')}
        >
          <span className="material-symbols-outlined text-metal-grey group-hover:text-white transition-colors">settings</span>
        </button>

        {/* Evidence Button */}
        <button
          onClick={onOpenEvidence}
          className="flex items-center gap-2 px-3 py-1 bg-black/40 hover:bg-black/60 border border-rust/50 hover:border-rust rounded transition-all group relative"
        >
          <span className="material-symbols-outlined text-rust-light group-hover:text-white transition-colors">folder_open</span>
          <span className="hidden md:inline font-header text-rust-light group-hover:text-white text-sm tracking-widest">{t('hud.evidence')}</span>

          {hasNewEvidence && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
            </span>
          )}
        </button>

        {/* Status Indicators */}
        <div className="flex flex-col md:flex-row items-end md:items-center md:gap-6 font-header text-xs tracking-widest text-hospital-white/70">
          <span className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${sanityColor} animate-pulse shadow-[0_0_8px_currentColor]`}></span>
            <span className="hidden md:inline">{t('hud.sanity')}:</span> {sanity}%
          </span>
          <span className="uppercase text-rust-light font-bold truncate max-w-[100px] md:max-w-[150px] text-right">
            {location}
          </span>
        </div>
      </div>
    </header>
  );
};
