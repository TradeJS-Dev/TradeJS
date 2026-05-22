import { NextResponse } from 'next/server';
import type {
  StrategyChartSnapshot,
  StrategyChartsSnapshotResponse,
} from '@tradejs/types';
import { getData, getKeys, redisKeys } from '@tradejs/infra/redis';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

const EMPTY_RESPONSE: StrategyChartsSnapshotResponse = {
  mode: 'ai',
  generatedAt: 0,
  runLabel: '',
  strategies: [],
};

export async function GET() {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json(EMPTY_RESPONSE);
  }

  const keys = await getKeys(redisKeys.strategyChartCards(userName, 'ai'));
  const strategies = (
    await Promise.all(
      keys.map(
        (key) => getData(key, null) as Promise<StrategyChartSnapshot | null>,
      ),
    )
  )
    .filter((card): card is StrategyChartSnapshot => Boolean(card))
    .sort(
      (left, right) =>
        right.generatedAt - left.generatedAt ||
        left.title.localeCompare(right.title),
    );

  const data: StrategyChartsSnapshotResponse = {
    mode: 'ai',
    generatedAt: strategies[0]?.generatedAt ?? 0,
    runLabel: '',
    strategies,
  };

  return NextResponse.json(data);
}
