'use client';

import React, { useState, useEffect, useRef } from 'react';
import './lib/i18n'; // Initialize i18n
import { useTranslation } from 'react-i18next';
import { GameState, Choice, GeminiResponse } from './types';
import { INITIAL_STATE } from './constants';
import { GameConfig, DEFAULT_GAME_CONFIG, DifficultyPreset } from './gameConfig';
import { generateNextTurn } from './services/geminiService';
import { Header } from './components/Header';
import { RuleBook } from './components/RuleBook';
import { MainDisplay } from './components/MainDisplay';
import { CRTLayer } from './components/CRTLayer';
import { EvidenceBoard } from './components/EvidenceBoard';
import { SettingsModal } from './components/SettingsModal';
import { GameIntro } from './components/GameIntro';
import { LandingPage } from './components/LandingPage';

const App: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const [history, setHistory] = useState<string[]>([]);
  const [showEvidence, setShowEvidence] = useState(false);
  const [hasNewEvidence, setHasNewEvidence] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [showIntro, setShowIntro] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [pollinationsApiKey, setPollinationsApiKey] = useState("");
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [chatModel, setChatModel] = useState("");

  const [imageProvider, setImageProvider] = useState<'pollinations' | 'openai'>('pollinations');
  const [pollinationsModel, setPollinationsModel] = useState('flux');
  const [imageModel, setImageModel] = useState("");
  const [imageBaseUrl, setImageBaseUrl] = useState("");
  const [imageApiKey, setImageApiKey] = useState("");
  const [enableImageGen, setEnableImageGen] = useState(true);
  const [gameConfig, setGameConfig] = useState<GameConfig>(DEFAULT_GAME_CONFIG);

  useEffect(() => {
    const storedApiKey = localStorage.getItem("gemini_api_key");
    const storedBaseUrl = localStorage.getItem("gemini_base_url");
    const storedPollinationsKey = localStorage.getItem("pollinations_api_key");
    const storedProvider = localStorage.getItem("llm_provider");
    const storedModel = localStorage.getItem("llm_model");

    if (storedApiKey) setApiKey(storedApiKey);
    if (storedBaseUrl) setBaseUrl(storedBaseUrl);
    if (storedPollinationsKey) setPollinationsApiKey(storedPollinationsKey);
    if (storedProvider) setProvider(storedProvider as 'gemini' | 'openai');
    if (storedModel) setChatModel(storedModel);

    const storedImgProvider = localStorage.getItem("image_provider");
    const storedPollModel = localStorage.getItem("pollinations_model");
    const storedImgModel = localStorage.getItem("image_model");
    const storedImgBase = localStorage.getItem("image_base_url");
    const storedImgKey = localStorage.getItem("image_api_key");

    if (storedImgProvider) setImageProvider(storedImgProvider as 'pollinations' | 'openai');
    if (storedPollModel) setPollinationsModel(storedPollModel);
    if (storedImgModel) setImageModel(storedImgModel);
    if (storedImgBase) setImageBaseUrl(storedImgBase);
    if (storedImgKey) setImageApiKey(storedImgKey);

    const storedEnableImageGen = localStorage.getItem("enable_image_gen");
    if (storedEnableImageGen !== null) setEnableImageGen(storedEnableImageGen === 'true');

    const storedGameConfig = localStorage.getItem("game_config");
    if (storedGameConfig) {
      try {
        setGameConfig({ ...DEFAULT_GAME_CONFIG, ...JSON.parse(storedGameConfig) });
      } catch (e) { /* ignore parse errors */ }
    }
  }, []);

  const handleSaveSettings = (
    key: string,
    url: string,
    pollKey: string,
    newProvider: 'gemini' | 'openai',
    newModel: string,
    newImgProvider: 'pollinations' | 'openai',
    newPollModel: string,
    newImgModel: string,
    newImgBase: string,
    newImgKey: string,
    newEnableImageGen: boolean,
    newGameConfig: GameConfig
  ) => {
    setApiKey(key);
    setBaseUrl(url);
    setPollinationsApiKey(pollKey);
    setProvider(newProvider);
    setChatModel(newModel);
    setImageProvider(newImgProvider);
    setPollinationsModel(newPollModel);
    setImageModel(newImgModel);
    setImageBaseUrl(newImgBase);
    setImageApiKey(newImgKey);
    setEnableImageGen(newEnableImageGen);
    setGameConfig(newGameConfig);

    localStorage.setItem("gemini_api_key", key);
    localStorage.setItem("gemini_base_url", url);
    localStorage.setItem("pollinations_api_key", pollKey);
    localStorage.setItem("llm_provider", newProvider);
    localStorage.setItem("llm_model", newModel);

    localStorage.setItem("image_provider", newImgProvider);
    localStorage.setItem("pollinations_model", newPollModel);
    localStorage.setItem("image_model", newImgModel);
    localStorage.setItem("image_base_url", newImgBase);
    localStorage.setItem("image_api_key", newImgKey);
    localStorage.setItem("enable_image_gen", String(newEnableImageGen));
    localStorage.setItem("game_config", JSON.stringify(newGameConfig));
  };

  // To avoid duplicate API calls in Strict Mode
  const initializingRef = useRef(false);

  const handleChoice = async (choice: Choice) => {
    if (gameState.isLoading || gameState.isGameOver) return;

    // Optimistic UI update
    setGameState(prev => ({ ...prev, isLoading: true }));

    const newHistory = [...history, `Turn ${gameState.turnCount}: Location: ${gameState.location}. Narrative: ${gameState.narrative}. Choice Made: ${choice.text} (${choice.actionType})`];
    setHistory(newHistory);

    try {
      // Pass current rules so AI knows what not to repeat
      const response: GeminiResponse = await generateNextTurn(
        newHistory,
        choice.text,
        gameState.rules,
        apiKey,
        baseUrl,
        provider,
        chatModel,
        gameState.sanity,
        gameState.inventory,
        gameConfig
      );

      setGameState(prev => {
        const newSanity = Math.max(0, Math.min(100, prev.sanity + response.sanity_change));

        // Handle new rules with MVP cap: normally max 1 per turn, allow up to 2 only in explicit bulk-discovery scenes
        const incomingRules = response.new_rules || [];
        const specialRuleDropKeywords = [
          '完整守则',
          '整页守则',
          '规则汇编',
          '值班手册',
          '患者守则原件',
          '公告栏整版'
        ];
        const isSpecialRuleDrop =
          (choice.actionType === 'investigate' || choice.actionType === 'item') &&
          specialRuleDropKeywords.some(keyword => response.narrative.includes(keyword));
        const cappedIncomingRules = isSpecialRuleDrop
          ? incomingRules.slice(0, 2)
          : incomingRules.slice(0, 1);
        const uniqueIncomingRules = cappedIncomingRules.filter(r => !prev.rules.includes(r));
        const newRules = [...prev.rules, ...uniqueIncomingRules];

        // Handle new evidence
        const incomingEvidence = response.new_evidence || [];
        let newInventory = [...prev.inventory, ...incomingEvidence];

        // Handle consumed item (protective item used)
        if (response.consumed_item_id) {
          newInventory = newInventory.filter(item => item.id !== response.consumed_item_id);
        }

        // Trigger notification if there is new evidence
        if (incomingEvidence.length > 0) {
          setHasNewEvidence(true);
        }

        const isGameOver = newSanity <= 0 || response.is_game_over;
        const isVictory = !!response.is_victory;

        return {
          sanity: newSanity,
          location: response.location_name || prev.location,
          narrative: response.narrative,
          imagePrompt: response.image_prompt_english,
          choices: response.choices,
          rules: newRules,
          inventory: newInventory,
          turnCount: prev.turnCount + 1,
          isGameOver: isGameOver,
          isVictory: isVictory,
          isLoading: false
        };
      });

    } catch (error) {
      console.error("Game loop error", error);
      setGameState(prev => ({ ...prev, isLoading: false, narrative: prev.narrative + "\n\n(系统连接不稳定，请重试...)" }));
    }
  };

  const handleOpenEvidence = () => {
    setShowEvidence(true);
    setHasNewEvidence(false); // Clear notification on open
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col font-body bg-black text-gray-200">
      {showLanding && (
        <LandingPage
          onHumanEnter={() => {
            setShowLanding(false);
            setShowIntro(true);
          }}
          onAgentEnter={() => {
            // "Agent" implies automated tools, maybe just open the app in a "dev" mode?
            // User request just said "provide entry/getting started instructions".
            // For now, let's just enter the game, or maybe show an alert "API Access Enabled"?
            setShowLanding(false);
            setShowIntro(true);
            setIsSettingsOpen(true); // Open settings for "Agent" to configure API keys
          }}
          currentLanguage={i18n.language}
          onLanguageChange={(lang) => i18n.changeLanguage(lang)}
        />
      )}
      {!showLanding && showIntro && <GameIntro onStart={() => setShowIntro(false)} />}
      {!showLanding && <CRTLayer sanity={gameState.sanity} />}

      <Header
        sanity={gameState.sanity}
        location={gameState.location}
        onOpenEvidence={handleOpenEvidence}
        onOpenSettings={() => setIsSettingsOpen(true)}
        hasNewEvidence={hasNewEvidence}
      />

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
          pollinationsApiKey={pollinationsApiKey}
          pollinationsModel={pollinationsModel}
          imageProvider={imageProvider}
          imageModel={imageModel}
          imageBaseUrl={imageBaseUrl}
          imageApiKey={imageApiKey}
          llmProvider={provider}
          llmBaseUrl={baseUrl}
          llmApiKey={apiKey}
          enableImageGen={enableImageGen}
        />
      </main>

      <EvidenceBoard
        isOpen={showEvidence}
        onClose={() => setShowEvidence(false)}
        inventory={gameState.inventory}
        turnCount={gameState.turnCount}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        apiKey={apiKey}
        baseUrl={baseUrl}
        pollinationsApiKey={pollinationsApiKey}
        pollinationsModel={pollinationsModel}
        provider={provider}
        chatModel={chatModel}
        imageProvider={imageProvider}
        imageModel={imageModel}
        imageBaseUrl={imageBaseUrl}
        imageApiKey={imageApiKey}
        enableImageGen={enableImageGen}
        gameConfig={gameConfig}
        onSave={handleSaveSettings}
        currentLanguage={i18n.language}
        onLanguageChange={(lang) => i18n.changeLanguage(lang)}
      />

      {/* Mobile Rule Button (Optional, simple overlay implementation for mobile) */}
      <div className="lg:hidden fixed top-20 right-4 z-40">
        <details className="relative">
          <summary className="list-none bg-yellow-600 text-black px-3 py-1 rounded font-header text-sm cursor-pointer border border-yellow-800 shadow-lg">
            {t('hud.rules')}
          </summary>
          <div className="absolute right-0 mt-2 w-64 bg-[#dcdcdc] p-4 text-black rounded shadow-xl border-4 border-metal-dark max-h-96 overflow-y-auto">
            <h3 className="font-header font-bold text-center mb-2 text-red-800 underline">{t('landing.rule_title')}</h3>
            <ul className="space-y-2 font-hand text-lg">
              {gameState.rules.map((r, i) => <li key={i}>{i + 1}. {r}</li>)}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
};

export default App;
