import { GameRunStatus, RunActorType } from '@prisma/client';
import { INITIAL_STATE } from '../../constants';
import type { ActorType, BoardEvent, BoardEventType, BoardRunSnapshot } from '../../types';
import { db } from './db';
import { getRedisKeyPrefix, withRedis } from './redis';
import { obfuscateWallet } from './scoring';

const BOARD_ACTIVE_LIMIT = 500;
const BOARD_COMPLETED_LIMIT = 500;
const BOARD_RECENT_EVENTS_LIMIT = 120;
const EVENT_RETENTION_MS = 72 * 60 * 60 * 1000;
const SANITY_CRITICAL_THRESHOLD = 25;
const TURN_MILESTONES = new Set([1, 3, 5, 8, 10, 12, 15, 20]);

const boardKeys = () => {
  const prefix = getRedisKeyPrefix();
  return {
    run: (runId: string) => `${prefix}:board:run:${runId}`,
    activeRuns: `${prefix}:board:runs:active`,
    completedRuns: `${prefix}:board:runs:completed`,
    events: `${prefix}:board:events`,
    pubsub: `${prefix}:board:pubsub`,
  };
};

const toActorType = (actorType: RunActorType | ActorType | string | null | undefined): ActorType => {
  if (actorType === RunActorType.AGENT || actorType === 'AGENT' || actorType === 'agent') {
    return 'agent';
  }
  return 'human';
};

const toPublicStatus = (status: GameRunStatus | string): BoardRunSnapshot['status'] => {
  const normalized = typeof status === 'string' ? status.toUpperCase() : status;
  switch (normalized) {
    case GameRunStatus.ACTIVE:
      return 'active';
    case GameRunStatus.COMPLETED:
      return 'completed';
    case GameRunStatus.ABANDONED:
      return 'abandoned';
    case GameRunStatus.FAILED:
      return 'failed';
    default:
      return 'active';
  }
};

const asRecord = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object') {
    return value as Record<string, any>;
  }
  return {};
};

const parsePayloadJson = <T>(raw: string | null | undefined): T | null => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const actorLabel = (actorType: ActorType) => {
  return actorType === 'agent' ? 'AGENT' : 'HUMAN';
};

const buildSubject = (actorType: ActorType, walletMasked: string) => {
  return `${actorLabel(actorType)} ${walletMasked}`;
};

const clampSanity = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return INITIAL_STATE.sanity;
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

type DbRunRow = {
  id: string;
  status: GameRunStatus;
  actorType: RunActorType;
  startedAt: Date;
  endedAt: Date | null;
  currentTurnNo: number;
  isVictory: boolean | null;
  updatedAt: Date;
  user: {
    walletAddress: string;
  };
};

type DbTurnRow = {
  runId: string;
  turnNo: number;
  inputJson: unknown;
  stateAfterJson: unknown;
};

const toRunSnapshot = (run: DbRunRow, latestTurn: DbTurnRow | null): BoardRunSnapshot => {
  const stateAfter = asRecord(latestTurn?.stateAfterJson);
  const inputJson = asRecord(latestTurn?.inputJson);
  const choice = asRecord(inputJson.choice);

  const turnNo = Math.max(0, Number(run.currentTurnNo || 0));
  const location = typeof stateAfter.location === 'string' && stateAfter.location
    ? stateAfter.location
    : INITIAL_STATE.location;
  const narrative = typeof stateAfter.narrative === 'string' && stateAfter.narrative
    ? stateAfter.narrative
    : INITIAL_STATE.narrative;
  const actionText = typeof choice.text === 'string' ? choice.text : '';
  const actionType = typeof choice.actionType === 'string' ? choice.actionType : '';
  const status = toPublicStatus(run.status);

  return {
    runId: run.id,
    actorType: toActorType(run.actorType),
    status,
    walletMasked: obfuscateWallet(run.user.walletAddress),
    turnNo,
    dayNo: turnNo,
    sanity: clampSanity(stateAfter.sanity),
    location,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt ? run.endedAt.toISOString() : null,
    updatedAt: run.updatedAt.toISOString(),
    isVictory: run.isVictory,
    lastActionText: actionText,
    lastActionType: actionType,
    lastNarrative: narrative.slice(0, 220),
    lastEventText: actionText || narrative.slice(0, 120),
  };
};

const extractPayload = (fields: unknown): string | null => {
  if (!Array.isArray(fields)) {
    return null;
  }

  for (let i = 0; i < fields.length; i += 2) {
    if (String(fields[i]) === 'payload') {
      return String(fields[i + 1] || '');
    }
  }

  return null;
};

const parseStreamEntries = (raw: unknown): Array<{ id: string; payload: string }> => {
  if (!Array.isArray(raw)) {
    return [];
  }

  const items: Array<{ id: string; payload: string }> = [];

  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 2) {
      continue;
    }

    const id = String(row[0] || '');
    const payload = extractPayload(row[1]);
    if (!id || !payload) {
      continue;
    }

    items.push({ id, payload });
  }

  return items;
};

const createEventMessage = (type: BoardEventType, snapshot: BoardRunSnapshot, itemName?: string): string => {
  const subject = buildSubject(snapshot.actorType, snapshot.walletMasked);

  switch (type) {
    case 'run_started':
      return `${subject} 进入副本，开始探索。`;
    case 'turn_milestone':
      return `${subject} 生存至第 ${snapshot.dayNo} 天（第 ${snapshot.turnNo} 回合）。`;
    case 'item_acquired':
      return `${subject} 获得关键道具：${itemName || '未知道具'}。`;
    case 'sanity_critical':
      return `${subject} 理智降至 ${snapshot.sanity}%（临界）。`;
    case 'victory':
      return `${subject} 成功通关。`;
    case 'death':
      return `${subject} 已死亡（第 ${snapshot.turnNo} 回合）。`;
    default:
      return `${subject} 状态更新。`;
  }
};

const createBoardEvent = (params: {
  type: BoardEventType;
  snapshot: BoardRunSnapshot;
  itemName?: string;
  createdAt?: string;
}): Omit<BoardEvent, 'id'> => {
  const { type, snapshot, itemName, createdAt } = params;
  return {
    type,
    runId: snapshot.runId,
    actorType: snapshot.actorType,
    walletMasked: snapshot.walletMasked,
    status: snapshot.status,
    turnNo: snapshot.turnNo,
    dayNo: snapshot.dayNo,
    sanity: snapshot.sanity,
    location: snapshot.location,
    message: createEventMessage(type, snapshot, itemName),
    createdAt: createdAt || new Date().toISOString(),
    ...(itemName ? { itemName } : {}),
  };
};

const appendBoardEvent = async (event: Omit<BoardEvent, 'id'>): Promise<BoardEvent | null> => {
  const keys = boardKeys();

  return withRedis(
    'append-board-event',
    async (client) => {
      const payload = JSON.stringify(event);
      const id = await client.sendCommand<string>(['XADD', keys.events, '*', 'payload', payload]);
      if (!id) {
        return null;
      }

      const persisted: BoardEvent = { ...event, id };
      const trimMinId = `${Date.now() - EVENT_RETENTION_MS}-0`;

      try {
        await client.sendCommand(['XTRIM', keys.events, 'MINID', '~', trimMinId]);
      } catch (error) {
        console.error('[board] event trim failed', error);
      }

      try {
        await client.publish(keys.pubsub, JSON.stringify(persisted));
      } catch (error) {
        console.error('[board] event pubsub failed', error);
      }

      return persisted;
    },
    null,
  );
};

export const upsertBoardRunSnapshot = async (snapshot: BoardRunSnapshot): Promise<void> => {
  const keys = boardKeys();
  const score = new Date(snapshot.updatedAt).getTime() || Date.now();

  await withRedis(
    'upsert-board-run',
    async (client) => {
      await client.set(keys.run(snapshot.runId), JSON.stringify(snapshot));

      if (snapshot.status === 'active') {
        await client.zAdd(keys.activeRuns, [{ score, value: snapshot.runId }]);
        await client.zRem(keys.completedRuns, snapshot.runId);
      } else {
        await client.zAdd(keys.completedRuns, [{ score, value: snapshot.runId }]);
        await client.zRem(keys.activeRuns, snapshot.runId);
      }

      return undefined;
    },
    undefined,
  );
};

const getRunSnapshotsFromRedisSet = async (setKey: string, limit: number): Promise<BoardRunSnapshot[]> => {
  const keys = boardKeys();

  return withRedis(
    'get-run-snapshots',
    async (client) => {
      const runIds = await client.sendCommand<string[]>(['ZREVRANGE', setKey, '0', String(Math.max(limit - 1, 0))]);
      if (!runIds.length) {
        return [];
      }

      const runKeys = runIds.map((runId) => keys.run(runId));
      const values = await client.sendCommand<Array<string | null>>(['MGET', ...runKeys]);
      const snapshots: BoardRunSnapshot[] = [];

      for (const raw of values) {
        const parsed = parsePayloadJson<BoardRunSnapshot>(raw || undefined);
        if (parsed) {
          snapshots.push(parsed);
        }
      }

      return snapshots;
    },
    [],
  );
};

const listRecentBoardEventsFromRedis = async (limit: number): Promise<BoardEvent[]> => {
  const keys = boardKeys();

  return withRedis(
    'list-recent-events',
    async (client) => {
      const raw = await client.sendCommand<unknown>([
        'XREVRANGE',
        keys.events,
        '+',
        '-',
        'COUNT',
        String(limit),
      ]);

      const entries = parseStreamEntries(raw);
      const items: BoardEvent[] = [];

      for (const entry of entries) {
        const parsed = parsePayloadJson<Omit<BoardEvent, 'id'>>(entry.payload);
        if (!parsed) {
          continue;
        }

        items.push({ ...parsed, id: entry.id });
      }

      return items;
    },
    [],
  );
};

const listLatestTurnsByRun = async (runIds: string[]): Promise<Map<string, DbTurnRow>> => {
  if (!runIds.length) {
    return new Map();
  }

  const turns = await db.gameTurn.findMany({
    where: { runId: { in: runIds } },
    select: {
      runId: true,
      turnNo: true,
      inputJson: true,
      stateAfterJson: true,
    },
    orderBy: [{ runId: 'asc' }, { turnNo: 'desc' }],
  });

  const result = new Map<string, DbTurnRow>();
  for (const turn of turns) {
    if (!result.has(turn.runId)) {
      result.set(turn.runId, turn);
    }
  }

  return result;
};

const buildBoardSnapshotFromDb = async (): Promise<{
  activeRuns: BoardRunSnapshot[];
  completedRuns: BoardRunSnapshot[];
  recentEvents: BoardEvent[];
}> => {
  const [activeRows, completedRows] = await Promise.all([
    db.gameRun.findMany({
      where: { status: GameRunStatus.ACTIVE },
      include: {
        user: {
          select: {
            walletAddress: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: BOARD_ACTIVE_LIMIT,
    }),
    db.gameRun.findMany({
      where: { status: { in: [GameRunStatus.COMPLETED, GameRunStatus.FAILED, GameRunStatus.ABANDONED] } },
      include: {
        user: {
          select: {
            walletAddress: true,
          },
        },
      },
      orderBy: { endedAt: 'desc' },
      take: BOARD_COMPLETED_LIMIT,
    }),
  ]);

  const runIds = [...activeRows.map((run) => run.id), ...completedRows.map((run) => run.id)];
  const latestTurns = await listLatestTurnsByRun(runIds);

  const activeRuns = activeRows.map((run) => toRunSnapshot(run, latestTurns.get(run.id) || null));
  const completedRuns = completedRows.map((run) => toRunSnapshot(run, latestTurns.get(run.id) || null));

  return {
    activeRuns,
    completedRuns,
    recentEvents: [],
  };
};

const backfillRunSnapshotCache = async (runs: BoardRunSnapshot[]): Promise<void> => {
  if (!runs.length) {
    return;
  }

  await Promise.all(runs.map((run) => upsertBoardRunSnapshot(run)));
};

export const getBoardSnapshot = async (): Promise<{
  serverTime: string;
  activeRuns: BoardRunSnapshot[];
  completedRuns: BoardRunSnapshot[];
  recentEvents: BoardEvent[];
}> => {
  const [activeRunsRedis, completedRunsRedis, recentEventsRedis] = await Promise.all([
    getRunSnapshotsFromRedisSet(boardKeys().activeRuns, BOARD_ACTIVE_LIMIT),
    getRunSnapshotsFromRedisSet(boardKeys().completedRuns, BOARD_COMPLETED_LIMIT),
    listRecentBoardEventsFromRedis(BOARD_RECENT_EVENTS_LIMIT),
  ]);

  if (activeRunsRedis.length || completedRunsRedis.length || recentEventsRedis.length) {
    return {
      serverTime: new Date().toISOString(),
      activeRuns: activeRunsRedis,
      completedRuns: completedRunsRedis,
      recentEvents: recentEventsRedis,
    };
  }

  const dbSnapshot = await buildBoardSnapshotFromDb();

  await backfillRunSnapshotCache([...dbSnapshot.activeRuns, ...dbSnapshot.completedRuns]);

  return {
    serverTime: new Date().toISOString(),
    ...dbSnapshot,
  };
};

export const listBoardEventsAfter = async (eventId: string, limit = 50): Promise<BoardEvent[]> => {
  const keys = boardKeys();
  const start = eventId && eventId !== '0-0' ? `(${eventId}` : '-';

  return withRedis(
    'list-board-events-after',
    async (client) => {
      const raw = await client.sendCommand<unknown>([
        'XRANGE',
        keys.events,
        start,
        '+',
        'COUNT',
        String(Math.max(1, limit)),
      ]);

      const entries = parseStreamEntries(raw);
      const items: BoardEvent[] = [];

      for (const entry of entries) {
        const parsed = parsePayloadJson<Omit<BoardEvent, 'id'>>(entry.payload);
        if (!parsed) {
          continue;
        }
        items.push({ ...parsed, id: entry.id });
      }

      return items;
    },
    [],
  );
};

export const getLatestBoardEventId = async (): Promise<string> => {
  const keys = boardKeys();

  return withRedis(
    'latest-board-event-id',
    async (client) => {
      const raw = await client.sendCommand<unknown>(['XREVRANGE', keys.events, '+', '-', 'COUNT', '1']);
      const entries = parseStreamEntries(raw);
      return entries[0]?.id || '0-0';
    },
    '0-0',
  );
};

export const syncBoardRunSnapshotFromDb = async (runId: string): Promise<BoardRunSnapshot | null> => {
  const run = await db.gameRun.findUnique({
    where: { id: runId },
    include: {
      user: {
        select: {
          walletAddress: true,
        },
      },
    },
  });

  if (!run) {
    return null;
  }

  const latestTurn = await db.gameTurn.findFirst({
    where: { runId },
    select: {
      runId: true,
      turnNo: true,
      inputJson: true,
      stateAfterJson: true,
    },
    orderBy: { turnNo: 'desc' },
  });

  const snapshot = toRunSnapshot(run, latestTurn);
  await upsertBoardRunSnapshot(snapshot);

  return snapshot;
};

export const publishRunStarted = async (params: {
  runId: string;
  actorType: ActorType;
  walletAddress: string;
  startedAt: Date;
}): Promise<void> => {
  const now = new Date().toISOString();

  const snapshot: BoardRunSnapshot = {
    runId: params.runId,
    actorType: params.actorType,
    status: 'active',
    walletMasked: obfuscateWallet(params.walletAddress),
    turnNo: 0,
    dayNo: 0,
    sanity: INITIAL_STATE.sanity,
    location: INITIAL_STATE.location,
    startedAt: params.startedAt.toISOString(),
    endedAt: null,
    updatedAt: now,
    isVictory: null,
    lastActionText: '',
    lastActionType: '',
    lastNarrative: INITIAL_STATE.narrative.slice(0, 220),
    lastEventText: '',
    lastEventType: undefined,
    lastEventItemName: undefined,
  };

  const startEvent = createBoardEvent({ type: 'run_started', snapshot, createdAt: now });
  snapshot.lastEventText = startEvent.message;
  snapshot.lastEventType = startEvent.type;
  snapshot.lastEventItemName = startEvent.itemName;

  await upsertBoardRunSnapshot(snapshot);
  await appendBoardEvent(startEvent);
};

export const publishRunTurnUpdate = async (params: {
  runId: string;
  actorType: ActorType;
  walletAddress: string;
  status: BoardRunSnapshot['status'];
  startedAt: Date;
  endedAt: Date | null;
  isVictory: boolean | null;
  turnNo: number;
  sanity: number;
  location: string;
  narrative: string;
  choiceText: string;
  choiceType: string;
  newEvidenceNames: string[];
  sanityCrossedCritical: boolean;
}): Promise<void> => {
  const now = new Date().toISOString();

  const snapshot: BoardRunSnapshot = {
    runId: params.runId,
    actorType: params.actorType,
    status: params.status,
    walletMasked: obfuscateWallet(params.walletAddress),
    turnNo: params.turnNo,
    dayNo: params.turnNo,
    sanity: clampSanity(params.sanity),
    location: params.location || INITIAL_STATE.location,
    startedAt: params.startedAt.toISOString(),
    endedAt: params.endedAt ? params.endedAt.toISOString() : null,
    updatedAt: now,
    isVictory: params.isVictory,
    lastActionText: params.choiceText,
    lastActionType: params.choiceType,
    lastNarrative: (params.narrative || '').slice(0, 220),
    lastEventText: params.choiceText,
    lastEventType: undefined,
    lastEventItemName: undefined,
  };

  const events: Array<Omit<BoardEvent, 'id'>> = [];

  if (TURN_MILESTONES.has(params.turnNo)) {
    events.push(createBoardEvent({ type: 'turn_milestone', snapshot, createdAt: now }));
  }

  for (const itemName of params.newEvidenceNames) {
    events.push(createBoardEvent({ type: 'item_acquired', snapshot, itemName, createdAt: now }));
  }

  if (params.sanityCrossedCritical) {
    events.push(createBoardEvent({ type: 'sanity_critical', snapshot, createdAt: now }));
  }

  if (params.status !== 'active') {
    events.push(
      createBoardEvent({
        type: params.isVictory ? 'victory' : 'death',
        snapshot,
        createdAt: now,
      }),
    );
  }

  if (events.length) {
    const latestEvent = events[events.length - 1];
    snapshot.lastEventText = latestEvent.message;
    snapshot.lastEventType = latestEvent.type;
    snapshot.lastEventItemName = latestEvent.itemName;
  }

  await upsertBoardRunSnapshot(snapshot);
  for (const event of events) {
    await appendBoardEvent(event);
  }
};

export const parseActorTypeInput = (value: unknown): ActorType => {
  if (typeof value === 'string' && value.trim().toLowerCase() === 'agent') {
    return 'agent';
  }
  return 'human';
};

export const runStatusFromOutcome = (
  status: GameRunStatus,
): BoardRunSnapshot['status'] => {
  return toPublicStatus(status);
};

export const getSanityCriticalThreshold = () => SANITY_CRITICAL_THRESHOLD;

export const getBoardCompletedLimit = () => BOARD_COMPLETED_LIMIT;
