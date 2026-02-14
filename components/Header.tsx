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
    <header className="bg-metal-dark border-b-4 border-rust px-3 md:px-6 py-2 md:py-0 md:h-16 z-30 relative shadow-lg shrink-0 flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-0">
      <div className="w-full md:w-auto flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2 md:gap-3">
          <div className="w-8 h-8 bg-hospital-white rounded-full flex items-center justify-center border-2 border-rust text-blood-fresh shrink-0">
            <span className="material-symbols-outlined text-xl font-bold">local_hospital</span>
          </div>
          <span className="hidden md:inline font-header text-hospital-white tracking-widest text-lg md:text-xl shadow-black drop-shadow-md truncate">
            {t('landing.agency')} | SYS.v0.9
          </span>
          <span className="md:hidden font-header text-hospital-white tracking-widest text-base truncate">
            {t('landing.agency')}
          </span>
        </div>

        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          {showSettings && (
            <button
              onClick={onOpenSettings}
              className="flex items-center justify-center px-2.5 md:px-3 py-1 bg-black/40 hover:bg-black/60 border border-metal-grey/50 hover:border-metal-grey rounded transition-all group"
              title={t('hud.settings')}
            >
              <span className="material-symbols-outlined text-metal-grey group-hover:text-white transition-colors text-[20px]">settings</span>
            </button>
          )}

          {onLogout && (
            <button
              onClick={onLogout}
              className="flex items-center justify-center px-2.5 md:px-3 py-1 bg-black/40 hover:bg-black/60 border border-red-900/50 hover:border-red-500 rounded transition-all group"
              title="Logout"
            >
              <span className="material-symbols-outlined text-red-300 group-hover:text-white transition-colors text-[20px]">logout</span>
            </button>
          )}

          <button
            onClick={onOpenEvidence}
            className="flex items-center gap-2 px-2.5 md:px-3 py-1 bg-black/40 hover:bg-black/60 border border-rust/50 hover:border-rust rounded transition-all group relative"
          >
            <span className="material-symbols-outlined text-rust-light group-hover:text-white transition-colors text-[20px]">folder_open</span>
            <span className="hidden md:inline font-header text-rust-light group-hover:text-white text-sm tracking-widest">{t('hud.evidence')}</span>

            {hasNewEvidence && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="w-full md:w-auto flex items-center justify-between md:justify-end gap-3 md:gap-6 font-header text-[11px] md:text-xs tracking-widest text-hospital-white/70">
        <span className="flex items-center gap-2 shrink-0">
          <span className={`w-2 h-2 rounded-full ${sanityColor} animate-pulse shadow-[0_0_8px_currentColor]`}></span>
          <span>
            {t('hud.sanity')}: {sanity}%
          </span>
        </span>
        <span className="uppercase text-rust-light font-bold truncate text-right max-w-[44vw] md:max-w-[150px]">
          {location}
        </span>
        {walletAddress && (
          <span className="uppercase text-hospital-white/50 font-mono text-[10px] truncate text-right max-w-[32vw] md:max-w-[120px]">
            {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
          </span>
        )}
      </div>
    </header>
  );
};
