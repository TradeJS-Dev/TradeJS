import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import type {
  StrategyChartSnapshot,
  StrategyChartsSnapshotResponse,
} from '@tradejs/types';
import { toFileToken } from '@tradejs/infra/ai';
import { getData, getKeys, redisKeys } from '@tradejs/infra/redis';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

const EMPTY_RESPONSE: StrategyChartsSnapshotResponse = {
  mode: 'ai',
  generatedAt: 0,
  runLabel: '',
  strategies: [],
};

const DATASET_FILE_RE = /^ai-dataset-(.+)-merged-(\d+)(?:-part\d+)?\.jsonl$/;

const getProjectRoot = () =>
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const compareNumericString = (left: string, right: string) =>
  left.length - right.length || left.localeCompare(right);

const resolveTotalPnl = (card: StrategyChartSnapshot) => {
  const statNetProfit = Number(card.stat?.netProfit ?? Number.NaN);
  if (Number.isFinite(statNetProfit)) {
    return statNetProfit;
  }

  const firstAmount = card.orderLog[0]?.[1];
  const lastAmount = card.orderLog.at(-1)?.[1];
  if (
    typeof firstAmount === 'number' &&
    typeof lastAmount === 'number' &&
    Number.isFinite(firstAmount) &&
    Number.isFinite(lastAmount)
  ) {
    return lastAmount - firstAmount;
  }

  return 0;
};

const loadLatestDatasetIds = async () => {
  const idsByStrategy = new Map<string, string>();
  let entries: string[] = [];

  try {
    entries = await fs.readdir(path.join(getProjectRoot(), 'data/ai/export'));
  } catch {
    return idsByStrategy;
  }

  for (const entry of entries) {
    const match = entry.match(DATASET_FILE_RE);
    if (!match) {
      continue;
    }

    const strategyToken = match[1];
    const datasetId = match[2];
    if (!strategyToken || !datasetId) {
      continue;
    }

    const current = idsByStrategy.get(strategyToken);
    if (!current || compareNumericString(current, datasetId) < 0) {
      idsByStrategy.set(strategyToken, datasetId);
    }
  }

  return idsByStrategy;
};

const attachLegacyDatasetIds = async (strategies: StrategyChartSnapshot[]) => {
  if (strategies.every((strategy) => strategy.datasetId)) {
    return strategies;
  }

  const latestDatasetIds = await loadLatestDatasetIds();
  if (!latestDatasetIds.size) {
    return strategies;
  }

  return strategies.map((strategy) =>
    strategy.datasetId
      ? strategy
      : {
          ...strategy,
          datasetId: latestDatasetIds.get(toFileToken(strategy.strategyName)),
        },
  );
};

export async function GET() {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json(EMPTY_RESPONSE);
  }

  const keys = await getKeys(redisKeys.strategyChartCards(userName, 'ai'));
  const cards = (
    await Promise.all(
      keys.map(
        (key) => getData(key, null) as Promise<StrategyChartSnapshot | null>,
      ),
    )
  )
    .filter((card): card is StrategyChartSnapshot => Boolean(card))
    .sort(
      (left, right) =>
        resolveTotalPnl(right) - resolveTotalPnl(left) ||
        right.generatedAt - left.generatedAt ||
        left.title.localeCompare(right.title),
    );
  const strategies = await attachLegacyDatasetIds(cards);

  const data: StrategyChartsSnapshotResponse = {
    mode: 'ai',
    generatedAt: strategies[0]?.generatedAt ?? 0,
    runLabel: '',
    strategies,
  };

  return NextResponse.json(data);
}
