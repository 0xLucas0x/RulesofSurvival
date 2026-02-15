
export interface Evidence {
  id: string;
  name: string;
  description: string;
  type: 'document' | 'photo' | 'item' | 'key';
}

export interface GameState {
  runId?: string;
  sanity: number;
  location: string;
  narrative: string;
  imagePrompt: string;
  choices: Choice[];
  rules: string[];
  inventory: Evidence[]; // New: List of collected evidence
  turnCount: number;
  lastSyncedTurn?: number;
  isRecovering?: boolean;
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

export interface AuthUser {
  id: string;
  walletAddress: string;
  role: 'player' | 'admin';
  tokenExp: number;
  isFirstHumanEntry: boolean;
}

export type ActorType = 'human' | 'agent';

export interface RunSummary {
  runId: string;
  status: 'active' | 'completed' | 'abandoned' | 'failed';
  turnNo: number;
  startedAt: string;
  actorType: ActorType;
  isVictory?: boolean | null;
}

export type BoardEventType =
  | 'run_started'
  | 'turn_milestone'
  | 'item_acquired'
  | 'victory'
  | 'death'
  | 'sanity_critical';

export interface BoardRunSnapshot {
  runId: string;
  actorType: ActorType;
  status: 'active' | 'completed' | 'abandoned' | 'failed';
  walletMasked: string;
  turnNo: number;
  dayNo: number;
  sanity: number;
  location: string;
  startedAt: string;
  endedAt?: string | null;
  updatedAt: string;
  isVictory?: boolean | null;
  lastActionText?: string;
  lastActionType?: string;
  lastNarrative?: string;
  lastEventText?: string;
  lastEventType?: BoardEventType;
  lastEventItemName?: string;
}

export interface BoardEvent {
  id: string;
  type: BoardEventType;
  runId: string;
  actorType: ActorType;
  walletMasked: string;
  status: 'active' | 'completed' | 'abandoned' | 'failed';
  turnNo: number;
  dayNo: number;
  sanity: number;
  location: string;
  message: string;
  createdAt: string;
  itemName?: string;
}

export interface TurnSnapshot {
  turnNo: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  stateBefore: Record<string, unknown>;
  stateAfter: Record<string, unknown>;
  createdAt: string;
}

export interface LandingStats {
  allTime: {
    users: number;
    runsStarted: number;
    runsCompleted: number;
    victories: number;
    avgScore: number;
    totalScore: number;
    victoryRate: number;
  };
  recent7d: {
    dauPeak: number;
    runsStarted: number;
    runsCompleted: number;
    avgScore: number;
    victoryRate: number;
  };
  daily: Array<{
    date: string;
    dau: number;
    runsStarted: number;
    runsCompleted: number;
    victoryRate: number;
    avgScore: number;
  }>;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  walletAddress: string;
  walletMasked: string;
  compositeScore?: number;
  victories?: number;
  completedRuns?: number;
  activeDays?: number;
  avgTurns?: number;
}

export enum GameStatus {
  START = 'START',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
  VICTORY = 'VICTORY'
}
