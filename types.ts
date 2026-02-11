
export interface GameState {
  sanity: number;
  location: string;
  narrative: string;
  imagePrompt: string;
  choices: Choice[];
  rules: string[];
  turnCount: number;
  isGameOver: boolean;
  isVictory: boolean; // New field for winning state
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
  image_prompt_english: string; // Used for image generation
  sanity_change: number;
  new_rules?: string[]; // If the player discovers a new rule note
  location_name: string;
  is_game_over: boolean;
  is_victory?: boolean; // Optional field from AI
}

export enum GameStatus {
  START = 'START',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
  VICTORY = 'VICTORY'
}
