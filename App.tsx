'use client';

import React, { useEffect, useState } from 'react';
import './lib/i18n';
import { useTranslation } from 'react-i18next';
import { LandingPage } from './components/LandingPage';
import { fetchLandingStats } from './services/geminiService';
import type { LandingStats } from './types';

const App: React.FC = () => {
  const { i18n } = useTranslation();
  const [stats, setStats] = useState<LandingStats | null>(null);

  useEffect(() => {
    fetchLandingStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const lang = (i18n.resolvedLanguage || i18n.language).startsWith('en') ? 'en' : 'zh';

  return (
    <LandingPage
      onHumanEnter={() => {
        window.location.href = '/game';
      }}
      onAgentEnter={() => {
        // Agent entry is handled separately; keep existing alert
        const { t } = { t: i18n.t.bind(i18n) };
        window.alert(t('auth.admin_only'));
      }}
      onBoardEnter={() => {
        window.location.href = '/board';
      }}
      currentLanguage={lang}
      onLanguageChange={(l) => i18n.changeLanguage(l)}
      stats={stats}
    />
  );
};

export default App;
