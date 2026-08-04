import 'dotenv/config';
import args from 'args';
import { createHash } from 'node:crypto';
import { getHyperliquidPerpUniverseSnapshot } from '@tradejs/node/strategies';
import { fetchHyperliquidUserFillsByTime } from '../lib/hyperliquidWhaleBackfill';
import { HyperliquidInfoRateLimiter } from '../lib/hyperliquidRateLimiter';
import {
  evaluateHyperliquidWhaleStructure,
  HYPERLIQUID_WHALE_SELECTION,
  rankHyperliquidStructuralWhales,
  type HyperliquidWhaleStructuralMetrics,
} from '../lib/hyperliquidWhaleSelection';

const LEADERBOARD_URL =
  'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const DAY_MS = 86_400_000;
const CANDIDATE_LIMIT = 400;

type LeaderboardWindow = [string, { vlm?: string }];
type LeaderboardRow = {
  ethAddress?: string;
  accountValue?: string;
  windowPerformances?: LeaderboardWindow[];
};

args.option(
  ['t', 'to'],
  'Exclusive calibration end (ISO); defaults to the current UTC day',
);
args.option(['d', 'days'], 'Calibration window in days', 7);
const flags = args.parse(process.argv);

const fingerprint = (addresses: string[]) =>
  createHash('sha256')
    .update(JSON.stringify(addresses))
    .digest('hex')
    .slice(0, 16);

const runConcurrent = async <T>(params: {
  items: T[];
  concurrency: number;
  worker: (item: T) => Promise<void>;
}) => {
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: params.concurrency }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= params.items.length) return;
        await params.worker(params.items[index]);
      }
    }),
  );
};

export const main = async () => {
  const explicitTo =
    flags.to == null ? Number.NaN : Date.parse(String(flags.to));
  const calibrationToMs = Number.isFinite(explicitTo)
    ? explicitTo
    : Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const calibrationDays = Math.max(1, Number(flags.days) || 7);
  const calibrationFromMs = calibrationToMs - calibrationDays * DAY_MS;
  const response = await fetch(LEADERBOARD_URL);
  if (!response.ok) {
    throw new Error(`Hyperliquid leaderboard ${response.status}`);
  }
  const payload = (await response.json()) as {
    leaderboardRows?: LeaderboardRow[];
  };
  const candidates = (payload.leaderboardRows ?? [])
    .map((row) => {
      const address = String(row.ethAddress ?? '').toLowerCase();
      const accountValueUsd = Number(row.accountValue);
      const weeklyVolumeUsd = Number(
        row.windowPerformances?.find(([window]) => window === 'week')?.[1].vlm,
      );
      return {
        address,
        accountValueUsd,
        turnoverToEquity:
          accountValueUsd > 0 ? weeklyVolumeUsd / accountValueUsd : 0,
      };
    })
    .filter(
      (row) =>
        /^0x[0-9a-f]{40}$/.test(row.address) &&
        row.accountValueUsd >=
          HYPERLIQUID_WHALE_SELECTION.minimumAccountValueUsd &&
        row.turnoverToEquity >=
          HYPERLIQUID_WHALE_SELECTION.minimumTurnoverToEquity &&
        row.turnoverToEquity <=
          HYPERLIQUID_WHALE_SELECTION.maximumTurnoverToEquity,
    )
    .sort(
      (left, right) =>
        left.turnoverToEquity - right.turnoverToEquity ||
        right.accountValueUsd - left.accountValueUsd ||
        left.address.localeCompare(right.address),
    )
    .slice(0, CANDIDATE_LIMIT);
  const top30Symbols = new Set(getHyperliquidPerpUniverseSnapshot().symbols);
  const limiter = new HyperliquidInfoRateLimiter();
  const metrics: HyperliquidWhaleStructuralMetrics[] = [];
  let completed = 0;
  await runConcurrent({
    items: candidates,
    concurrency: 2,
    worker: async (candidate) => {
      const result = await fetchHyperliquidUserFillsByTime({
        address: candidate.address,
        startTime: calibrationFromMs,
        endTime: calibrationToMs - 1,
        rateLimiter: limiter,
        maxPages: 1,
      });
      metrics.push(
        evaluateHyperliquidWhaleStructure({
          address: candidate.address,
          accountValueUsd: candidate.accountValueUsd,
          fills: result.fills,
          calibrationFromMs,
          calibrationToMs,
          top30Symbols,
        }),
      );
      completed += 1;
      if (completed % 10 === 0 || completed === candidates.length) {
        console.log(
          `Hyperliquid whale selection ${completed}/${candidates.length}; eligible=${metrics.filter((row) => row.eligible).length}`,
        );
      }
    },
  });
  const selected = rankHyperliquidStructuralWhales(metrics, 100);
  if (selected.length !== 100) {
    throw new Error(
      `Only ${selected.length} structural whales passed selection from ${candidates.length} candidates`,
    );
  }
  const addresses = selected.map((row) => row.address);
  const timestamp = new Date(calibrationToMs).toISOString();
  const snapshot = {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    source: 'hyperliquid_structural_fills_snapshot',
    selection: {
      calibrationFrom: new Date(calibrationFromMs).toISOString(),
      calibrationTo: timestamp,
      effectiveFrom: timestamp,
      candidateLimit: CANDIDATE_LIMIT,
      ...HYPERLIQUID_WHALE_SELECTION,
      score:
        'log1p(accountValue)*log1p(medianExecutionNotional)*log1p(max(1,medianInterExecutionMinutes))*sqrt(activeDays)*top30Share/sqrt(1+rawFillsPerDay)',
      forbiddenSelectionMetrics: ['pnl', 'roi', 'winRate', 'closedPnl'],
    },
    fingerprint: fingerprint(addresses),
    size: 100,
    addresses,
  };
  console.log(JSON.stringify(snapshot, null, 2));
  return snapshot;
};
