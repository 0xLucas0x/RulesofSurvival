'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { SiweMessage } from 'siwe';
import './lib/i18n';
import { useTranslation } from 'react-i18next';
import { AuthUser, Choice, GameState, LandingStats, RunSummary } from './types';
import { INITIAL_STATE } from './constants';
import { Header } from './components/Header';
import { RuleBook } from './components/RuleBook';
import { MainDisplay } from './components/MainDisplay';
import { CRTLayer } from './components/CRTLayer';
import { EvidenceBoard } from './components/EvidenceBoard';
import { GameIntro } from './components/GameIntro';
import { LandingPage } from './components/LandingPage';
import {
  fetchAuthUser,
  fetchLandingStats,
  fetchSiweNonce,
  getCurrentRun,
  logoutAuth,
  startRun,
  submitRunTurn,
  verifySiweLogin,
} from './services/geminiService';

type WalletBridge = Pick<
  ReturnType<typeof useDynamicContext>,
  'primaryWallet' | 'setShowAuthFlow' | 'handleLogOut' | 'sdkHasLoaded'
>;

const hasDynamicEnv = Boolean(process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID);

const buildState = (state: Partial<GameState>): GameState => {
  return {
    ...INITIAL_STATE,
    ...state,
    isLoading: false,
  };
};

const AppShell: React.FC<{ wallet: WalletBridge }> = ({ wallet }) => {
  const { t, i18n } = useTranslation();
  const { primaryWallet, setShowAuthFlow, handleLogOut, sdkHasLoaded } = wallet;

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [walletAuthLoading, setWalletAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [gameState, setGameState] = useState<GameState>(buildState(INITIAL_STATE));
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [hasNewEvidence, setHasNewEvidence] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [imageUnlocked, setImageUnlocked] = useState(true);
  const [landingStats, setLandingStats] = useState<LandingStats | null>(null);
  const [pendingEntry, setPendingEntry] = useState<'human' | null>(null);
  const [isHumanEntryLoading, setIsHumanEntryLoading] = useState(false);

  const bootstrappedRef = useRef(false);
  const attemptedAutoLoginWalletRef = useRef<string | null>(null);

  const hydrateCurrentRun = useCallback(async (): Promise<boolean> => {
    const current = await getCurrentRun();
    if (!current.run) {
      return false;
    }

    setRunSummary(current.run.summary);
    setGameState(
      buildState({
        ...current.run.state,
        runId: current.run.summary.runId,
        lastSyncedTurn: current.run.summary.turnNo,
        isRecovering: false,
      }),
    );
    return true;
  }, []);

  const bootstrap = useCallback(async () => {
    if (bootstrappedRef.current) {
      return;
    }
    bootstrappedRef.current = true;

    setAuthLoading(true);
    try {
      const user = await fetchAuthUser();
      setAuthUser(user);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const loadLandingMetrics = useCallback(async () => {
    try {
      const stats = await fetchLandingStats();
      setLandingStats(stats);
    } catch {
      setLandingStats(null);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
    void loadLandingMetrics();
  }, [bootstrap, loadLandingMetrics]);

  const ensureActiveRun = useCallback(async (): Promise<RunSummary> => {
    if (runSummary?.status === 'active') {
      return runSummary;
    }

    const started = await startRun();
    setRunSummary(started.summary);
    setGameState(
      buildState({
        ...started.state,
        runId: started.summary.runId,
        lastSyncedTurn: started.summary.turnNo,
      }),
    );
    if (!started.recovered) {
      setAuthUser((prev) => (prev ? { ...prev, isFirstHumanEntry: false } : prev));
    }
    setImageUnlocked(true);
    return started.summary;
  }, [runSummary]);

  const prepareHumanEntry = useCallback(
    async (user: AuthUser) => {
      const restored = await hydrateCurrentRun();

      if (!restored) {
        if (user.isFirstHumanEntry) {
          setShowIntro(true);
        } else {
          await ensureActiveRun();
          setShowIntro(false);
        }
      } else {
        setShowIntro(false);
      }

      setShowAuthGate(false);
      setShowLanding(false);
      setPendingEntry(null);
    },
    [ensureActiveRun, hydrateCurrentRun],
  );

  const completeWalletLogin = useCallback(async () => {
    if (!primaryWallet) {
      setShowAuthFlow(true);
      return;
    }

    const walletAddress = primaryWallet.address;
    if (!walletAddress) {
      setAuthError(t('auth.errors.no_wallet_address'));
      return;
    }

    setAuthError(null);
    setWalletAuthLoading(true);

    try {
      const { nonce, chainId } = await fetchSiweNonce();
      const siwe = new SiweMessage({
        domain: window.location.host,
        address: walletAddress,
        statement: 'Sign in to Rule of Survival',
        uri: window.location.origin,
        version: '1',
        chainId,
        nonce,
      });

      const message = siwe.prepareMessage();
      const signature = await primaryWallet.signMessage(message);
      if (!signature) {
        throw new Error(t('auth.errors.signature_cancelled'));
      }

      const user = await verifySiweLogin(message, signature);
      setAuthUser(user);
      if (pendingEntry === 'human') {
        await prepareHumanEntry(user);
      } else {
        setShowAuthGate(false);
        setPendingEntry(null);
      }
      await loadLandingMetrics();
    } catch (error: any) {
      setAuthError(error?.message || t('auth.errors.login_failed'));
    } finally {
      setWalletAuthLoading(false);
    }
  }, [loadLandingMetrics, pendingEntry, prepareHumanEntry, primaryWallet, setShowAuthFlow, t]);

  const handleConnectWallet = useCallback(async () => {
    setAuthError(null);

    if (!process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID) {
      setAuthError(t('auth.errors.dynamic_not_configured'));
      return;
    }

    if (!sdkHasLoaded) {
      setAuthError(t('auth.errors.provider_loading'));
      return;
    }

    if (!primaryWallet) {
      setShowAuthFlow(true);
      return;
    }

    attemptedAutoLoginWalletRef.current = primaryWallet.address?.toLowerCase() ?? null;
    await completeWalletLogin();
  }, [completeWalletLogin, primaryWallet, sdkHasLoaded, setShowAuthFlow, t]);

  useEffect(() => {
    const walletAddress = primaryWallet?.address?.toLowerCase();
    if (!walletAddress || !showAuthGate || authUser || pendingEntry !== 'human') {
      return;
    }
    if (attemptedAutoLoginWalletRef.current === walletAddress) {
      return;
    }

    attemptedAutoLoginWalletRef.current = walletAddress;
    void completeWalletLogin();
  }, [authUser, completeWalletLogin, pendingEntry, primaryWallet, showAuthGate]);

  const handleLogout = useCallback(async () => {
    await logoutAuth();
    try {
      await handleLogOut();
    } catch (error) {
      console.error('Dynamic wallet logout failed', error);
    }
    setAuthUser(null);
    setRunSummary(null);
    setGameState(buildState(INITIAL_STATE));
    setShowLanding(true);
    setShowAuthGate(false);
    setShowIntro(false);
    setPendingEntry(null);
    attemptedAutoLoginWalletRef.current = null;
  }, [handleLogOut]);

  const startNarrative = useCallback(async () => {
    if (!authUser) {
      setShowAuthGate(true);
      setPendingEntry('human');
      return;
    }
    await ensureActiveRun();
    setShowIntro(false);
  }, [authUser, ensureActiveRun]);

  const handleEnterHuman = useCallback(async () => {
    if (isHumanEntryLoading) {
      return;
    }

    setAuthError(null);
    setPendingEntry('human');

    if (!authUser) {
      setShowLanding(false);
      setShowAuthGate(true);
      return;
    }

    setIsHumanEntryLoading(true);
    try {
      await prepareHumanEntry(authUser);
    } catch (error: any) {
      setAuthError(error?.message || t('auth.errors.login_failed'));
      setPendingEntry(null);
      setShowLanding(true);
    } finally {
      setIsHumanEntryLoading(false);
    }
  }, [authUser, isHumanEntryLoading, prepareHumanEntry, t]);

  const handleChoice = useCallback(
    async (choice: Choice) => {
      if (gameState.isLoading || gameState.isGameOver) return;
      if (!authUser) return;

      const run = await ensureActiveRun();

      setGameState((prev) => ({ ...prev, isLoading: true }));

      try {
        const result = await submitRunTurn(run.runId, choice);
        const nextState = buildState({
          ...result.state,
          runId: run.runId,
          lastSyncedTurn: result.state.turnCount,
          isRecovering: false,
        });

        setGameState(nextState);
        setImageUnlocked(result.imageUnlocked);

        if (result.state.inventory.length > gameState.inventory.length) {
          setHasNewEvidence(true);
        }

        setRunSummary((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            turnNo: nextState.turnCount,
            status: nextState.isGameOver ? (nextState.isVictory ? 'completed' : 'failed') : 'active',
            isVictory: nextState.isGameOver ? nextState.isVictory : prev.isVictory,
          };
        });
      } catch (error) {
        console.error('Turn submission failed', error);
        setGameState((prev) => ({ ...prev, isLoading: false }));
      }
    },
    [authUser, ensureActiveRun, gameState.inventory.length, gameState.isGameOver, gameState.isLoading],
  );

  const handleOpenEvidence = () => {
    setShowEvidence(true);
    setHasNewEvidence(false);
  };

  if (showLanding) {
    return (
      <LandingPage
        onHumanEnter={() => {
          void handleEnterHuman();
        }}
        isHumanEntering={isHumanEntryLoading}
        onBoardEnter={() => {
          window.location.href = '/board';
        }}
        onAgentEnter={() => {
          if (authUser?.role === 'admin') {
            window.location.href = '/admin';
            return;
          }
          window.alert(t('auth.admin_only'));
        }}
        currentLanguage={(i18n.resolvedLanguage || i18n.language).startsWith('en') ? 'en' : 'zh'}
        onLanguageChange={(lang) => i18n.changeLanguage(lang)}
        stats={landingStats}
      />
    );
  }

  if (showAuthGate && !authUser) {
    return (
      <div className="h-screen w-screen bg-black text-gray-200 flex flex-col items-center justify-center gap-6 px-6">
        <h1 className="text-4xl text-red-600 font-header tracking-[0.2em]">{t('landing.gameTitle')}</h1>
        <p className="text-gray-400 text-center max-w-xl">{t('auth.connect_hint')}</p>
        <button
          onClick={handleConnectWallet}
          disabled={authLoading || walletAuthLoading || (hasDynamicEnv && !sdkHasLoaded)}
          className="px-6 py-3 bg-red-900 hover:bg-red-700 border border-red-500 uppercase tracking-[0.2em] font-header"
        >
          {authLoading
            ? t('auth.checking_session')
            : walletAuthLoading
              ? t('auth.verifying_wallet')
              : hasDynamicEnv && !sdkHasLoaded
                ? t('auth.loading_provider')
                : t('auth.connect_wallet')}
        </button>
        <button
          onClick={() => {
            setAuthError(null);
            setShowAuthGate(false);
            setPendingEntry(null);
            setShowLanding(true);
          }}
          className="px-6 py-2 bg-black hover:bg-gray-900 border border-gray-700 uppercase tracking-[0.2em] font-header"
        >
          {t('auth.back')}
        </button>
        {authError && <p className="text-red-400 text-sm">{authError}</p>}
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="h-screen w-screen bg-black text-gray-200 flex items-center justify-center font-header tracking-widest">
        {t('auth.session_lost')}
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col font-body bg-black text-gray-200">
      {showIntro && <GameIntro onStart={() => void startNarrative()} />}
      <CRTLayer sanity={gameState.sanity} />

      <Header
        sanity={gameState.sanity}
        location={gameState.location}
        onOpenEvidence={handleOpenEvidence}
        onOpenSettings={() => {
          if (authUser.role === 'admin') {
            window.location.href = '/admin';
          }
        }}
        onLogout={() => void handleLogout()}
        showSettings={authUser.role === 'admin'}
        walletAddress={authUser.walletAddress}
        hasNewEvidence={hasNewEvidence}
      />

      {!imageUnlocked && (
        <div className="z-30 bg-yellow-900/70 text-yellow-100 text-xs font-header tracking-widest px-4 py-2 text-center border-b border-yellow-700">
          IMAGE LOCKED: whitelist / NFT / token requirement not met
        </div>
      )}

      <main className="flex-1 flex overflow-hidden z-20 relative">
        <RuleBook rules={gameState.rules} />
        <MainDisplay
          imagePrompt={gameState.imagePrompt}
          narrative={gameState.narrative}
          isLoading={gameState.isLoading}
          choices={gameState.choices}
          onMakeChoice={handleChoice}
          isGameOver={gameState.isGameOver}
          isVictory={gameState.isVictory}
          imageProvider="pollinations"
          enableImageGen
        />
      </main>

      <EvidenceBoard
        isOpen={showEvidence}
        onClose={() => setShowEvidence(false)}
        inventory={gameState.inventory}
        turnCount={gameState.turnCount}
      />

      <div className="lg:hidden fixed top-20 right-4 z-40">
        <details className="relative">
          <summary className="list-none bg-yellow-600 text-black px-3 py-1 rounded font-header text-sm cursor-pointer border border-yellow-800 shadow-lg">
            {t('hud.rules')}
          </summary>
          <div className="absolute right-0 mt-2 w-64 bg-[#dcdcdc] p-4 text-black rounded shadow-xl border-4 border-metal-dark max-h-96 overflow-y-auto">
            <h3 className="font-header font-bold text-center mb-2 text-red-800 underline">{t('landing.rule_title')}</h3>
            <ul className="space-y-2 font-hand text-lg">
              {gameState.rules.map((r, i) => (
                <li key={i}>
                  {i + 1}. {r}
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
};

const AppWithDynamic: React.FC = () => {
  const { primaryWallet, setShowAuthFlow, handleLogOut, sdkHasLoaded } = useDynamicContext();
  return (
    <AppShell
      wallet={{
        primaryWallet,
        setShowAuthFlow,
        handleLogOut,
        sdkHasLoaded,
      }}
    />
  );
};

const AppWithoutDynamic: React.FC = () => {
  const noOpShowAuthFlow = (() => undefined) as WalletBridge['setShowAuthFlow'];

  return (
    <AppShell
      wallet={{
        primaryWallet: null,
        setShowAuthFlow: noOpShowAuthFlow,
        handleLogOut: async () => undefined,
        sdkHasLoaded: false,
      }}
    />
  );
};

const App: React.FC = () => {
  if (!hasDynamicEnv) {
    return <AppWithoutDynamic />;
  }
  return <AppWithDynamic />;
};

export default App;
