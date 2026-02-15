import { useTranslation } from 'react-i18next';

interface HeaderProps {
  sanity: number;
  location: string;
  onOpenEvidence: () => void;
  onOpenSettings: () => void;
  onLogout?: () => void;
  showSettings?: boolean;
  walletAddress?: string;
  hasNewEvidence?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  sanity,
  location,
  onOpenEvidence,
  onOpenSettings,
  onLogout,
  showSettings = true,
  walletAddress,
  hasNewEvidence,
}) => {
  const { t } = useTranslation();
  let sanityColor = 'bg-green-500';

  if (sanity < 70) sanityColor = 'bg-yellow-500';
  if (sanity < 30) sanityColor = 'bg-red-600';

  return (
    <header className="bg-black/95 border-b border-red-900/30 px-3 md:px-6 py-2 md:py-0 md:h-16 z-30 relative shadow-lg shrink-0 flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-0 backdrop-blur-md">
      <div className="w-full md:w-auto flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2 md:gap-3">
          <div className="w-8 h-8 bg-red-900/20 rounded border border-red-500/50 flex items-center justify-center text-red-500 shrink-0">
            <span className="material-symbols-outlined text-xl">biotech</span>
          </div>
          <div className="flex flex-col">
            <span className="hidden md:inline font-tech font-bold text-gray-200 tracking-widest text-sm uppercase">
              {t('landing.agency')}
            </span>
            <span className="text-[10px] font-mono text-red-500/60 tracking-[0.2em] uppercase">
              System.v0.9.4 // {t('landing.division')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          {showSettings && (
            <button
              onClick={onOpenSettings}
              className="flex items-center justify-center w-8 h-8 bg-black/40 hover:bg-white/10 border border-white/20 hover:border-white/50 rounded transition-all group"
              title={t('hud.settings')}
            >
              <span className="material-symbols-outlined text-gray-400 group-hover:text-white transition-colors text-[18px]">settings</span>
            </button>
          )}

          {onLogout && (
            <button
              onClick={onLogout}
              className="flex items-center justify-center w-8 h-8 bg-black/40 hover:bg-red-900/40 border border-red-900/30 hover:border-red-500/50 rounded transition-all group"
              title="Logout"
            >
              <span className="material-symbols-outlined text-red-900/60 group-hover:text-red-400 transition-colors text-[18px]">logout</span>
            </button>
          )}

          <button
            onClick={onOpenEvidence}
            className="flex items-center gap-2 px-2.5 md:px-3 py-1 bg-black/40 hover:bg-teal-900/20 border border-teal-900/30 hover:border-teal-500/50 rounded transition-all group relative"
          >
            <span className="material-symbols-outlined text-teal-600/70 group-hover:text-teal-400 transition-colors text-[18px]">folder_open</span>
            <span className="hidden md:inline font-tech text-teal-600/70 group-hover:text-teal-400 text-xs tracking-widest uppercase">{t('hud.evidence')}</span>

            {hasNewEvidence && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="w-full md:w-auto flex items-center justify-between md:justify-end gap-3 md:gap-6 font-tech text-[10px] md:text-xs tracking-widest text-gray-500 uppercase">
        <span className="flex items-center gap-2 shrink-0 border-r border-white/10 pr-4">
          <span className={`w-1.5 h-1.5 rounded-full ${sanityColor} animate-pulse shadow-[0_0_5px_currentColor]`}></span>
          <span>
            {t('hud.sanity')}: <span className={sanity < 30 ? 'text-red-500 font-bold' : 'text-gray-300'}>{sanity}%</span>
          </span>
        </span>
        <span className="text-gray-400 truncate text-right max-w-[40vw] md:max-w-[200px] border-r border-white/10 pr-4">
          LOC: <span className="text-gray-300">{location}</span>
        </span>
        {walletAddress && (
          <span className="text-gray-600 font-mono truncate text-right max-w-[25vw] md:max-w-[100px]">
            ID: {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
          </span>
        )}
      </div>
    </header>
  );
};
