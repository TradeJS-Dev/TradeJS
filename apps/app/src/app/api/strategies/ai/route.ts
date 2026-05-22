import { NextResponse } from 'next/server';
import type { StrategyChartsSnapshotResponse } from '@tradejs/types';
import { getData, redisKeys } from '@tradejs/infra/redis';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

const EMPTY_RESPONSE: StrategyChartsSnapshotResponse = {
  mode: 'ai',
  generatedAt: 0,
  runLabel: '',
  strategies: [],
};

export async function GET() {
  const userName = (await getCurrentUserName()) || 'root';
  const data = (await getData(
    redisKeys.strategyCharts(userName, 'ai'),
    EMPTY_RESPONSE,
  )) as StrategyChartsSnapshotResponse;

  return NextResponse.json(data || EMPTY_RESPONSE);
}
