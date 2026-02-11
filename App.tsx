import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GameState, Choice, GeminiResponse } from './types';
import { INITIAL_STATE } from './constants';
import { generateNextTurn } from './services/geminiService';
import { Header } from './components/Header';
import { RuleBook } from './components/RuleBook';
import { MainDisplay } from './components/MainDisplay';
import { CRTLayer } from './components/CRTLayer';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const [history, setHistory] = useState<string[]>([]);
  // To avoid duplicate API calls in Strict Mode
  const initializingRef = useRef(false);

  // Initial sound effect or ambiance could go here
  
  const handleChoice = async (choice: Choice) => {
    if (gameState.isLoading || gameState.isGameOver) return;

    // Optimistic UI update
    setGameState(prev => ({ ...prev, isLoading: true }));
    
    const newHistory = [...history, `Turn ${gameState.turnCount}: Location: ${gameState.location}. Narrative: ${gameState.narrative}. Choice Made: ${choice.text} (${choice.actionType})`];
    setHistory(newHistory);

    try {
      // Pass current rules so AI knows what not to repeat
      const response: GeminiResponse = await generateNextTurn(newHistory, choice.text, gameState.rules);
      
      setGameState(prev => {
        const newSanity = Math.max(0, Math.min(100, prev.sanity + response.sanity_change));
        
        // Handle new rules: Check for existence to strictly prevent duplicates
        const incomingRules = response.new_rules || [];
        const uniqueIncomingRules = incomingRules.filter(r => !prev.rules.includes(r));
        const newRules = [...prev.rules, ...uniqueIncomingRules];
        
        const isGameOver = newSanity <= 0 || response.is_game_over;
        const isVictory = !!response.is_victory;

        return {
          sanity: newSanity,
          location: response.location_name || prev.location,
          narrative: response.narrative,
          imagePrompt: response.image_prompt_english,
          choices: response.choices,
          rules: newRules,
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

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col font-body bg-black text-gray-200">
      <CRTLayer />
      
      <Header sanity={gameState.sanity} location={gameState.location} />
      
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
        />
      </main>
      
      {/* Mobile Rule Button (Optional, simple overlay implementation for mobile) */}
      <div className="lg:hidden fixed top-20 right-4 z-40">
        <details className="relative">
          <summary className="list-none bg-yellow-600 text-black px-3 py-1 rounded font-header text-sm cursor-pointer border border-yellow-800 shadow-lg">
            查看守则
          </summary>
          <div className="absolute right-0 mt-2 w-64 bg-[#dcdcdc] p-4 text-black rounded shadow-xl border-4 border-metal-dark max-h-96 overflow-y-auto">
             <h3 className="font-header font-bold text-center mb-2 text-red-800 underline">患者守则</h3>
             <ul className="space-y-2 font-hand text-lg">
               {gameState.rules.map((r, i) => <li key={i}>{i+1}. {r}</li>)}
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