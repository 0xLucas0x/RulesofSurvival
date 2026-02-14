import { db } from './db';
import { obfuscateWallet } from './scoring';

const startOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const addDays = (date: Date, days: number): Date => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

const uniqDayCount = (values: Date[]): number => {
  const set = new Set(values.map((v) => v.toISOString().slice(0, 10)));
  return set.size;
};

export const refreshUserMetrics = async (userId: string): Promise<void> => {
  const now = new Date();
  const sevenDaysAgo = addDays(startOfDay(now), -6);

  const [allResults, recentResults] = await Promise.all([
    db.runResult.findMany({ where: { userId } }),
    db.runResult.findMany({
      where: {
        userId,
        completedAt: { gte: sevenDaysAgo },
      },
    }),
  ]);

  const buildMetric = (results: Array<{ score: number; isVictory: boolean; completedAt: Date }>) => {
    return {
      compositeScore: results.reduce((sum, r) => sum + r.score, 0),
      victories: results.reduce((sum, r) => sum + (r.isVictory ? 1 : 0), 0),
      completedRuns: results.length,
      activeDays: uniqDayCount(results.map((r) => r.completedAt)),
    };
  };

  const all = buildMetric(allResults);
  const recent = buildMetric(recentResults);

  await Promise.all([
    db.userMetricsAllTime.upsert({
      where: { userId },
      update: all,
      create: { userId, ...all },
    }),
    db.userMetrics7d.upsert({
      where: { userId },
      update: recent,
      create: { userId, ...recent },
    }),
  ]);
};

export const refreshLandingDailyStats = async (date: Date): Promise<void> => {
  const day = startOfDay(date);
  const nextDay = addDays(day, 1);

  const [runsStarted, runResults] = await Promise.all([
    db.gameRun.findMany({
      where: {
        startedAt: {
          gte: day,
          lt: nextDay,
        },
      },
      select: { userId: true },
    }),
    db.runResult.findMany({
      where: {
        completedAt: {
          gte: day,
          lt: nextDay,
        },
      },
      select: {
        userId: true,
        isVictory: true,
        score: true,
      },
    }),
  ]);

  const users = new Set<string>();
  for (const r of runsStarted) users.add(r.userId);
  for (const r of runResults) users.add(r.userId);

  const runsCompleted = runResults.length;
  const victories = runResults.reduce((s, r) => s + (r.isVictory ? 1 : 0), 0);
  const avgScore = runsCompleted ? runResults.reduce((s, r) => s + r.score, 0) / runsCompleted : 0;
  const victoryRate = runsCompleted ? victories / runsCompleted : 0;

  await db.landingDailyStat.upsert({
    where: { date: day },
    update: {
      dau: users.size,
      runsStarted: runsStarted.length,
      runsCompleted,
      avgScore,
      victoryRate,
    },
    create: {
      date: day,
      dau: users.size,
      runsStarted: runsStarted.length,
      runsCompleted,
      avgScore,
      victoryRate,
    },
  });
};

export const recordRunStarted = async (date = new Date()): Promise<void> => {
  await refreshLandingDailyStats(date);
};

export const recordRunCompleted = async (userId: string, date = new Date()): Promise<void> => {
  await Promise.all([refreshUserMetrics(userId), refreshLandingDailyStats(date)]);
};

export const getLandingStats = async () => {
  const now = new Date();
  const sevenDaysAgo = addDays(startOfDay(now), -6);

  const [allTimeTotals, recentRows] = await Promise.all([
    db.runResult.aggregate({
      _count: { _all: true },
      _sum: { score: true },
      _avg: { score: true },
      where: {},
    }),
    db.landingDailyStat.findMany({
      where: { date: { gte: sevenDaysAgo } },
      orderBy: { date: 'asc' },
    }),
  ]);

  const allVictories = await db.runResult.count({ where: { isVictory: true } });
  const allRunsStarted = await db.gameRun.count();
  const allUsers = await db.user.count();

  const recent = {
    dauPeak: recentRows.reduce((max, row) => Math.max(max, row.dau), 0),
    runsStarted: recentRows.reduce((sum, row) => sum + row.runsStarted, 0),
    runsCompleted: recentRows.reduce((sum, row) => sum + row.runsCompleted, 0),
    avgScore: recentRows.length
      ? recentRows.reduce((sum, row) => sum + row.avgScore, 0) / recentRows.length
      : 0,
    victoryRate: recentRows.length
      ? recentRows.reduce((sum, row) => sum + row.victoryRate, 0) / recentRows.length
      : 0,
  };

  return {
    allTime: {
      users: allUsers,
      runsStarted: allRunsStarted,
      runsCompleted: allTimeTotals._count._all,
      victories: allVictories,
      avgScore: allTimeTotals._avg.score || 0,
      totalScore: allTimeTotals._sum.score || 0,
      victoryRate: allTimeTotals._count._all ? allVictories / allTimeTotals._count._all : 0,
    },
    recent7d: recent,
    daily: recentRows,
  };
};

export const getLeaderboard = async (
  board: 'composite' | 'clear' | 'active',
  window: '7d' | 'all',
  limit = 50,
) => {
  if (board === 'clear') {
    const since = window === '7d' ? addDays(startOfDay(new Date()), -6) : null;
    const rows = await db.runResult.groupBy({
      by: ['userId'],
      where: {
        isVictory: true,
        ...(since ? { completedAt: { gte: since } } : {}),
      },
      _count: { _all: true },
      _avg: { turns: true },
      orderBy: [{ _count: { userId: 'desc' } }],
      take: limit,
    });

    const users = await db.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, walletAddress: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));
    return rows.map((row, idx) => ({
      rank: idx + 1,
      userId: row.userId,
      walletAddress: userMap.get(row.userId)?.walletAddress || 'unknown',
      walletMasked: obfuscateWallet(userMap.get(row.userId)?.walletAddress || 'unknown'),
      victories: row._count._all,
      avgTurns: row._avg.turns || 0,
    }));
  }

  const orderBy =
    board === 'active'
      ? [{ activeDays: 'desc' as const }, { completedRuns: 'desc' as const }]
      : [{ compositeScore: 'desc' as const }, { victories: 'desc' as const }];

  const rows =
    window === '7d'
      ? await db.userMetrics7d.findMany({
          orderBy,
          take: limit,
          include: {
            user: {
              select: {
                walletAddress: true,
              },
            },
          },
        })
      : await db.userMetricsAllTime.findMany({
          orderBy,
          take: limit,
          include: {
            user: {
              select: {
                walletAddress: true,
              },
            },
          },
        });

  return rows.map((row, idx) => ({
    rank: idx + 1,
    userId: row.userId,
    walletAddress: row.user.walletAddress,
    walletMasked: obfuscateWallet(row.user.walletAddress),
    compositeScore: row.compositeScore,
    victories: row.victories,
    completedRuns: row.completedRuns,
    activeDays: row.activeDays,
  }));
};
