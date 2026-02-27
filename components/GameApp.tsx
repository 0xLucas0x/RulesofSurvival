'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { SiweMessage } from 'siwe';
import '../lib/i18n';
import { useTranslation } from 'react-i18next';
import { AuthUser, Choice, GameState, RunSummary } from '../types';
import { INITIAL_STATE } from '../constants';
import { Header } from './Header';
import { RuleBook } from './RuleBook';
import { MainDisplay } from './MainDisplay';
import { CRTLayer } from './CRTLayer';
import { EvidenceBoard } from './EvidenceBoard';
import { GameIntro } from './GameIntro';
import {
    fetchAuthUser,
    fetchSiweNonce,
    getCurrentRun,
    logoutAuth,
    startRun,
    submitRunTurn,
    verifySiweLogin,
} from '../services/geminiService';

type WalletBridge = Pick<
    ReturnType<typeof useDynamicContext>,
    'primaryWallet' | 'setShowAuthFlow' | 'handleLogOut' | 'sdkHasLoaded'
>;

const hasDynamicEnv = Boolean(process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID);

const buildState = (state: Partial<GameState>): GameState => ({
    ...INITIAL_STATE,
    ...state,
    isLoading: false,
});

const isGuestTrialConsumedError = (error: unknown): boolean => {
    const message = (error as any)?.message;
    return typeof message === 'string' && message.trim().toLowerCase() === 'guest_trial_consumed';
};

const GameShell: React.FC<{ wallet: WalletBridge }> = ({ wallet }) => {
    const { t } = useTranslation();
    const { primaryWallet, setShowAuthFlow, handleLogOut, sdkHasLoaded } = wallet;

    const [authUser, setAuthUser] = useState<AuthUser | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [walletAuthLoading, setWalletAuthLoading] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);

    const [gameState, setGameState] = useState<GameState>(buildState({ ...INITIAL_STATE, imagePrompt: '' }));
    const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
    const [showEvidence, setShowEvidence] = useState(false);
    const [hasNewEvidence, setHasNewEvidence] = useState(false);
    const [showAuthGate, setShowAuthGate] = useState(false);
    const [showIntro, setShowIntro] = useState(false);
    const [imageUnlocked, setImageUnlocked] = useState(true);
    const [pendingEntry, setPendingEntry] = useState<'human' | null>(null);
    const [isEntryLoading, setIsEntryLoading] = useState(false);
    const [guestTrialConsumed, setGuestTrialConsumed] = useState(false);

    const bootstrappedRef = useRef(false);
    const attemptedAutoLoginWalletRef = useRef<string | null>(null);

    const hydrateCurrentRun = useCallback(async (): Promise<boolean> => {
        const current = await getCurrentRun();
        if (!current.run) return false;
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
        if (bootstrappedRef.current) return;
        bootstrappedRef.current = true;
        setAuthLoading(true);
        try {
            const user = await fetchAuthUser();
            setAuthUser(user);
        } finally {
            setAuthLoading(false);
        }
    }, []);

    useEffect(() => {
        void bootstrap();
    }, [bootstrap]);

    const ensureActiveRun = useCallback(async (): Promise<RunSummary> => {
        if (runSummary?.status === 'active') return runSummary;
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
        setGuestTrialConsumed(false);
        setImageUnlocked(true);
        return started.summary;
    }, [runSummary]);

    const prepareEntry = useCallback(
        async (user: AuthUser) => {
            const restored = await hydrateCurrentRun();
            if (!restored) {
                const alreadyPlayedIntro = Boolean(sessionStorage.getItem('introPlayed'));
                if (user.isFirstHumanEntry && !alreadyPlayedIntro) {
                    setShowIntro(true);
                } else {
                    try {
                        await ensureActiveRun();
                        setGuestTrialConsumed(false);
                        setShowIntro(false);
                    } catch (error) {
                        if (user.authProvider === 'guest' && isGuestTrialConsumedError(error)) {
                            setGuestTrialConsumed(true);
                            setShowIntro(false);
                            setShowAuthGate(false);
                            setPendingEntry(null);
                            return;
                        }
                        throw error;
                    }
                }
            } else {
                setGuestTrialConsumed(false);
                setShowIntro(false);
            }
            setShowAuthGate(false);
            setPendingEntry(null);
        },
        [ensureActiveRun, hydrateCurrentRun],
    );

    const completeWalletLogin = useCallback(async () => {
        if (!primaryWallet) { setShowAuthFlow(true); return; }
        const walletAddress = primaryWallet.address;
        if (!walletAddress) { setAuthError(t('auth.errors.no_wallet_address')); return; }

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
            if (!signature) throw new Error(t('auth.errors.signature_cancelled'));

            const user = await verifySiweLogin(message, signature);

            // Redirect to /intro BEFORE setAuthUser for first-time users
            // so React never renders the game layout between auth and intro.
            if (pendingEntry === 'human' && user.isFirstHumanEntry && !sessionStorage.getItem('introPlayed')) {
                window.location.href = '/intro';
                return;
            }

            setAuthUser(user);
            if (pendingEntry === 'human') {
                await prepareEntry(user);
            } else {
                setShowAuthGate(false);
                setPendingEntry(null);
            }
        } catch (error: any) {
            setAuthError(error?.message || t('auth.errors.login_failed'));
        } finally {
            setWalletAuthLoading(false);
        }
    }, [pendingEntry, prepareEntry, primaryWallet, setShowAuthFlow, t]);

    const handleConnectWallet = useCallback(async () => {
        setAuthError(null);
        if (!process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID) { setAuthError(t('auth.errors.dynamic_not_configured')); return; }
        if (!sdkHasLoaded) { setAuthError(t('auth.errors.provider_loading')); return; }
        if (!primaryWallet) { setShowAuthFlow(true); return; }
        attemptedAutoLoginWalletRef.current = primaryWallet.address?.toLowerCase() ?? null;
        await completeWalletLogin();
    }, [completeWalletLogin, primaryWallet, sdkHasLoaded, setShowAuthFlow, t]);

    // Auto-trigger wallet login when wallet connects while auth gate is open.
    useEffect(() => {
        const walletAddress = primaryWallet?.address?.toLowerCase();
        if (!walletAddress || !showAuthGate || authUser || pendingEntry !== 'human') return;
        if (attemptedAutoLoginWalletRef.current === walletAddress) return;
        attemptedAutoLoginWalletRef.current = walletAddress;
        void completeWalletLogin();
    }, [authUser, completeWalletLogin, pendingEntry, primaryWallet, showAuthGate]);

    useEffect(() => {
        if (!hasDynamicEnv || !sdkHasLoaded) return;
        if (!authUser || authUser.authProvider !== 'wallet') return;

        const connectedWalletAddress = primaryWallet?.address?.toLowerCase() || null;
        const sessionWalletAddress = authUser.walletAddress.toLowerCase();
        const walletSwitched = Boolean(connectedWalletAddress) && connectedWalletAddress !== sessionWalletAddress;
        const walletDisconnected = !connectedWalletAddress;

        if (!walletSwitched && !walletDisconnected) return;

        let cancelled = false;
        const clearStaleSession = async () => {
            await logoutAuth();
            if (cancelled) return;
            setAuthError(null);
            setAuthUser(null);
            setRunSummary(null);
            setGameState(buildState(INITIAL_STATE));
            setShowEvidence(false);
            setHasNewEvidence(false);
            setShowIntro(false);
            setShowAuthGate(true);
            setPendingEntry('human');
            setGuestTrialConsumed(false);
            attemptedAutoLoginWalletRef.current = null;
        };

        void clearStaleSession();
        return () => {
            cancelled = true;
        };
    }, [authUser, primaryWallet?.address, sdkHasLoaded]);

    const handleLogout = useCallback(async () => {
        await logoutAuth();
        try { await handleLogOut(); } catch (e) { console.error('Dynamic wallet logout failed', e); }
        setAuthUser(null);
        setRunSummary(null);
        setGameState(buildState(INITIAL_STATE));
        setShowAuthGate(false);
        setShowIntro(false);
        setPendingEntry(null);
        setGuestTrialConsumed(false);
        attemptedAutoLoginWalletRef.current = null;
        // Go back to landing page after logout
        window.location.href = '/';
    }, [handleLogOut]);

    const startNarrative = useCallback(async () => {
        if (!authUser) { setShowAuthGate(true); setPendingEntry('human'); return; }
        try {
            await ensureActiveRun();
            setGuestTrialConsumed(false);
            setShowIntro(false);
        } catch (error) {
            if (authUser.authProvider === 'guest' && isGuestTrialConsumedError(error)) {
                setGuestTrialConsumed(true);
                setShowIntro(false);
                return;
            }
            console.error('Narrative start failed', error);
            setAuthError(t('auth.errors.login_failed'));
        }
    }, [authUser, ensureActiveRun, t]);

    // On mount: check auth and auto-enter game (or show auth gate if not logged in).
    useEffect(() => {
        if (authLoading) return;
        if (authUser) {
            // Already logged in — enter the game directly.
            setIsEntryLoading(true);
            prepareEntry(authUser)
                .catch((error) => {
                    if (authUser.authProvider === 'guest' && isGuestTrialConsumedError(error)) {
                        setGuestTrialConsumed(true);
                        return;
                    }
                    console.error('Entry preparation failed', error);
                })
                .finally(() => setIsEntryLoading(false));
        } else {
            // Not logged in — show the auth gate immediately.
            setShowAuthGate(true);
            setPendingEntry('human');
        }
        // Only run once after bootstrap completes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading]);

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
                if (result.state.inventory.length > gameState.inventory.length) setHasNewEvidence(true);
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

    // ── Loading state during bootstrap ──────────────────────────────────────────
    if (authLoading || isEntryLoading) {
        return <div className="h-screen w-screen bg-black" />;
    }

    // ── Auth gate ────────────────────────────────────────────────────────────────
    if (showAuthGate && !authUser) {
        return (
            <div className="h-screen w-screen bg-black text-gray-200 flex flex-col items-center justify-center gap-6 px-6">
                <h1 className="text-4xl text-red-600 font-header tracking-[0.2em]">{t('landing.gameTitle')}</h1>
                <p className="text-gray-400 text-center max-w-xl">{t('auth.connect_hint')}</p>
                <button
                    onClick={handleConnectWallet}
                    disabled={walletAuthLoading || (hasDynamicEnv && !sdkHasLoaded)}
                    className="px-6 py-3 bg-red-900 hover:bg-red-700 border border-red-500 uppercase tracking-[0.2em] font-header"
                >
                    {walletAuthLoading
                        ? t('auth.verifying_wallet')
                        : hasDynamicEnv && !sdkHasLoaded
                            ? t('auth.loading_provider')
                            : t('auth.connect_wallet')}
                </button>
                <button
                    onClick={() => { window.location.href = '/'; }}
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

    if (guestTrialConsumed && authUser.authProvider === 'guest') {
        return (
            <div className="h-screen w-screen bg-black text-gray-200 flex flex-col items-center justify-center gap-6 px-6">
                <h1 className="text-3xl md:text-4xl text-red-500 font-header tracking-[0.2em] text-center">
                    {t('auth.trial_completed_title')}
                </h1>
                <p className="text-gray-400 text-center max-w-xl">
                    {t('auth.trial_completed_desc')}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                        onClick={() => { window.location.href = '/'; }}
                        className="px-6 py-2 bg-black hover:bg-gray-900 border border-gray-700 uppercase tracking-[0.2em] font-header"
                    >
                        {t('auth.back')}
                    </button>
                    <button
                        onClick={() => void handleLogout()}
                        className="px-6 py-2 bg-red-950 hover:bg-red-900 border border-red-600 uppercase tracking-[0.2em] font-header"
                    >
                        {t('auth.end_trial')}
                    </button>
                </div>
            </div>
        );
    }

    // ── Game Intro ───────────────────────────────────────────────────────────────
    if (showIntro) {
        return <GameIntro onStart={() => void startNarrative()} />;
    }

    // ── Main Game ────────────────────────────────────────────────────────────────
    return (
        <div className="h-screen w-screen overflow-hidden flex flex-col font-body bg-black text-gray-200">
            <CRTLayer sanity={gameState.sanity} />

            <Header
                sanity={gameState.sanity}
                location={gameState.location}
                onOpenEvidence={handleOpenEvidence}
                onOpenSettings={() => {
                    if (authUser.role === 'admin') window.location.href = '/admin';
                }}
                onLogout={() => void handleLogout()}
                showSettings={false}
                walletAddress={authUser.walletAddress}
                hasNewEvidence={hasNewEvidence}
            />

            {!imageUnlocked && (
                <div className="z-30 bg-red-950/90 text-red-500 text-xs font-tech tracking-[0.2em] px-4 py-2 text-center border-b border-red-500 shadow-[0_0_10px_rgba(220,38,38,0.5)] animate-pulse">
                    {t('hud.image_locked')}
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
                <details className="relative group">
                    <summary className="list-none bg-black/90 text-red-500 px-3 py-1 rounded font-tech text-xs tracking-widest cursor-pointer border border-red-900/50 hover:border-red-500 shadow-lg backdrop-blur-md transition-all uppercase flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm">local_hospital</span>
                        {t('hud.rules')}
                    </summary>
                    <div className="absolute right-0 mt-2 w-72 bg-black/95 p-4 text-gray-300 rounded shadow-[0_0_20px_rgba(0,0,0,0.8)] border border-red-900/50 max-h-[60vh] overflow-y-auto backdrop-blur-xl">
                        <h3 className="font-header font-bold text-center mb-4 text-red-500 tracking-[0.2em] border-b border-red-900/30 pb-2">{t('landing.rule_title')}</h3>
                        <ul className="space-y-3 font-hand text-sm md:text-base">
                            {gameState.rules.map((r, i) => (
                                <li key={i} className="flex gap-2">
                                    <span className="text-red-600 font-bold">{i + 1}.</span>
                                    <span className="text-gray-400">{r}</span>
                                </li>
                            ))}
                        </ul>
                        <div className="mt-4 pt-2 border-t border-red-900/20 text-[10px] font-mono text-red-900/50 text-center tracking-widest uppercase">
                            Restricted File // Do Not Distribute
                        </div>
                    </div>
                </details>
            </div>
        </div>
    );
};

const GameAppWithDynamic: React.FC = () => {
    const { primaryWallet, setShowAuthFlow, handleLogOut, sdkHasLoaded } = useDynamicContext();
    return <GameShell wallet={{ primaryWallet, setShowAuthFlow, handleLogOut, sdkHasLoaded }} />;
};

const GameAppWithoutDynamic: React.FC = () => {
    const noOpShowAuthFlow = (() => undefined) as WalletBridge['setShowAuthFlow'];
    return (
        <GameShell
            wallet={{
                primaryWallet: null,
                setShowAuthFlow: noOpShowAuthFlow,
                handleLogOut: async () => undefined,
                sdkHasLoaded: false,
            }}
        />
    );
};

export const GameApp: React.FC = () => {
    if (!hasDynamicEnv) return <GameAppWithoutDynamic />;
    return <GameAppWithDynamic />;
};
