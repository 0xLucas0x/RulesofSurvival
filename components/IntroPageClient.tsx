'use client';

import { useEffect } from 'react';
import '../lib/i18n';
import { GameIntro } from './GameIntro';

/**
 * Standalone page wrapper for GameIntro.
 * Shown on the /intro route so it renders on a clean slate — no game layout underneath.
 * After clicking Enter, redirects to the main app (/) which will handle auth if needed.
 */
export const IntroPageClient = () => {
    useEffect(() => {
        // Mark intro as played so App.tsx doesn't try to show it again inline.
        sessionStorage.setItem('introPlayed', '1');
    }, []);

    const handleStart = () => {
        window.location.href = '/game';
    };

    return <GameIntro onStart={handleStart} />;
};
