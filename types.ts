
export interface Evidence {
  id: string;
  name: string;
  description: string;
  type: 'document' | 'photo' | 'item' | 'key';
}

export interface GameState {
  sanity: number;
  location: string;
  narrative: string;
  imagePrompt: string;
  choices: Choice[];
  rules: string[];
  inventory: Evidence[]; // New: List of collected evidence
  turnCount: number;
  isGameOver: boolean;
  isVictory: boolean;
  isLoading: boolean;
}

export interface Choice {
  id: string;
  text: string;
  actionType: 'move' | 'investigate' | 'item' | 'risky';
}

export interface GeminiResponse {
  narrative: string;
  choices: Choice[];
  image_prompt_english: string;
  sanity_change: number;
  new_rules?: string[];
  new_evidence?: Evidence[]; // New: AI can return found items
  location_name: string;
  is_game_over: boolean;
  is_victory?: boolean;
  consumed_item_id?: string;
}

export interface StoryEvaluation {
  coherence: number;
  ruleIntegration: number;
  horrorTension: number;
  choiceMeaningfulness: number;
  endingQuality: number;
  overall: number;
  issues: string[];
  suggestions: string[];
  summary: string;
}

export enum GameStatus {
  START = 'START',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
  VICTORY = 'VICTORY'
}
