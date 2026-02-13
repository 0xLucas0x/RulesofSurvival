export type LabRunStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface LabRunRecord {
  id: string;
  createdAt: string;
  status: LabRunStatus;
  config: Record<string, unknown>;
  progress: {
    totalGames: number;
    completedGames: number;
    failedGames: number;
    avgTurns: number;
    avgFinalSanity: number;
    avgScore: number;
  };
}

export interface LabGameRecord {
  id: string;
  runId: string;
  index: number;
  ending: 'victory' | 'game_over' | 'timeout' | 'error';
  turns: number;
  finalSanity: number;
  rulesCount: number;
  inventoryCount: number;
  evaluation?: {
    overall: number;
    summary: string;
  };
  error?: string;
  createdAt: string;
}

export interface LabTurnRecord {
  id: string;
  runId: string;
  gameId: string;
  turn: number;
  createdAt: string;
  choice: {
    id: string;
    text: string;
    actionType: string;
  };
  stateBefore: {
    sanity: number;
    location: string;
    rulesCount: number;
    inventoryCount: number;
  };
  stateAfter: {
    sanity: number;
    location: string;
    rulesCount: number;
    inventoryCount: number;
  };
  response: {
    sanity_change: number;
    is_game_over: boolean;
    is_victory?: boolean;
    new_rules?: string[];
    new_evidence?: Array<{ id: string; name: string; type: string }>;
    narrative: string;
    choices?: Array<{ id: string; text: string; actionType: string }>;
  };
  latencyMs: number;
}

const DB_NAME = 'rules-survival-test-lab';
const DB_VERSION = 1;

const openDb = async (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('runs')) {
        db.createObjectStore('runs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('games')) {
        const store = db.createObjectStore('games', { keyPath: 'id' });
        store.createIndex('byRunId', 'runId', { unique: false });
      }
      if (!db.objectStoreNames.contains('turns')) {
        const store = db.createObjectStore('turns', { keyPath: 'id' });
        store.createIndex('byGameId', 'gameId', { unique: false });
        store.createIndex('byRunId', 'runId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const txDone = (tx: IDBTransaction): Promise<void> => {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

const requestToPromise = <T>(req: IDBRequest<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

export const testLabDb = {
  async putRun(run: LabRunRecord) {
    const db = await openDb();
    const tx = db.transaction('runs', 'readwrite');
    tx.objectStore('runs').put(run);
    await txDone(tx);
  },

  async getRuns(): Promise<LabRunRecord[]> {
    const db = await openDb();
    const tx = db.transaction('runs', 'readonly');
    const items = await requestToPromise(tx.objectStore('runs').getAll());
    return (items || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async putGame(game: LabGameRecord) {
    const db = await openDb();
    const tx = db.transaction('games', 'readwrite');
    tx.objectStore('games').put(game);
    await txDone(tx);
  },

  async getGamesByRun(runId: string): Promise<LabGameRecord[]> {
    const db = await openDb();
    const tx = db.transaction('games', 'readonly');
    const index = tx.objectStore('games').index('byRunId');
    const items = await requestToPromise(index.getAll(runId));
    return (items || []).sort((a, b) => a.index - b.index);
  },

  async putTurn(turn: LabTurnRecord) {
    const db = await openDb();
    const tx = db.transaction('turns', 'readwrite');
    tx.objectStore('turns').put(turn);
    await txDone(tx);
  },

  async getTurnsByGame(gameId: string): Promise<LabTurnRecord[]> {
    const db = await openDb();
    const tx = db.transaction('turns', 'readonly');
    const index = tx.objectStore('turns').index('byGameId');
    const items = await requestToPromise(index.getAll(gameId));
    return (items || []).sort((a, b) => a.turn - b.turn);
  },
};
