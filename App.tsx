import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GameState, Choice, GeminiResponse } from './types';
import { INITIAL_STATE } from './constants';
import { generateNextTurn } from './services/geminiService';
import { Header } from './components/Header';
import { RuleBook } from './components/RuleBook';
import { MainDisplay } from './components/MainDisplay';
import { CRTLayer } from './components/CRTLayer';
import { EvidenceBoard } from './components/EvidenceBoard';
import { SettingsModal } from './components/SettingsModal';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const [history, setHistory] = useState<string[]>([]);
  const [showEvidence, setShowEvidence] = useState(false);
  const [hasNewEvidence, setHasNewEvidence] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [pollinationsApiKey, setPollinationsApiKey] = useState("");
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [chatModel, setChatModel] = useState("");

  const [imageProvider, setImageProvider] = useState<'pollinations' | 'openai'>('pollinations');
  const [imageModel, setImageModel] = useState("");
  const [imageBaseUrl, setImageBaseUrl] = useState("");
  const [imageApiKey, setImageApiKey] = useState("");
  const [enableImageGen, setEnableImageGen] = useState(true);

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
    const storedImgModel = localStorage.getItem("image_model");
    const storedImgBase = localStorage.getItem("image_base_url");
    const storedImgKey = localStorage.getItem("image_api_key");

    if (storedImgProvider) setImageProvider(storedImgProvider as 'pollinations' | 'openai');
    if (storedImgModel) setImageModel(storedImgModel);
    if (storedImgBase) setImageBaseUrl(storedImgBase);
    if (storedImgKey) setImageApiKey(storedImgKey);

    const storedEnableImageGen = localStorage.getItem("enable_image_gen");
    if (storedEnableImageGen !== null) setEnableImageGen(storedEnableImageGen === 'true');
  }, []);

  const handleSaveSettings = (
    key: string,
    url: string,
    pollKey: string,
    newProvider: 'gemini' | 'openai',
    newModel: string,
    newImgProvider: 'pollinations' | 'openai',
    newImgModel: string,
    newImgBase: string,
    newImgKey: string,
    newEnableImageGen: boolean
  ) => {
    setApiKey(key);
    setBaseUrl(url);
    setPollinationsApiKey(pollKey);
    setProvider(newProvider);
    setChatModel(newModel);
    setImageProvider(newImgProvider);
    setImageModel(newImgModel);
    setImageBaseUrl(newImgBase);
    setImageApiKey(newImgKey);
    setEnableImageGen(newEnableImageGen);

    localStorage.setItem("gemini_api_key", key);
    localStorage.setItem("gemini_base_url", url);
    localStorage.setItem("pollinations_api_key", pollKey);
    localStorage.setItem("llm_provider", newProvider);
    localStorage.setItem("llm_model", newModel);

    localStorage.setItem("image_provider", newImgProvider);
    localStorage.setItem("image_model", newImgModel);
    localStorage.setItem("image_base_url", newImgBase);
    localStorage.setItem("image_api_key", newImgKey);
    localStorage.setItem("enable_image_gen", String(newEnableImageGen));
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
        chatModel
      );

      setGameState(prev => {
        const newSanity = Math.max(0, Math.min(100, prev.sanity + response.sanity_change));

        // Handle new rules: Check for existence to strictly prevent duplicates
        const incomingRules = response.new_rules || [];
        const uniqueIncomingRules = incomingRules.filter(r => !prev.rules.includes(r));
        const newRules = [...prev.rules, ...uniqueIncomingRules];

        // Handle new evidence
        const incomingEvidence = response.new_evidence || [];
        const newInventory = [...prev.inventory, ...incomingEvidence];

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
      <CRTLayer />

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
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        apiKey={apiKey}
        baseUrl={baseUrl}
        pollinationsApiKey={pollinationsApiKey}
        provider={provider}
        chatModel={chatModel}
        imageProvider={imageProvider}
        imageModel={imageModel}
        imageBaseUrl={imageBaseUrl}
        imageApiKey={imageApiKey}
        enableImageGen={enableImageGen}
        onSave={handleSaveSettings}
      />

      {/* Mobile Rule Button (Optional, simple overlay implementation for mobile) */}
      <div className="lg:hidden fixed top-20 right-4 z-40">
        <details className="relative">
          <summary className="list-none bg-yellow-600 text-black px-3 py-1 rounded font-header text-sm cursor-pointer border border-yellow-800 shadow-lg">
            守则
          </summary>
          <div className="absolute right-0 mt-2 w-64 bg-[#dcdcdc] p-4 text-black rounded shadow-xl border-4 border-metal-dark max-h-96 overflow-y-auto">
            <h3 className="font-header font-bold text-center mb-2 text-red-800 underline">患者守则</h3>
            <ul className="space-y-2 font-hand text-lg">
              {gameState.rules.map((r, i) => <li key={i}>{i + 1}. {r}</li>)}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element");
const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);