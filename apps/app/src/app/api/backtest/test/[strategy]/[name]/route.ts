'use server';

import { NextResponse } from 'next/server';
import {
  deletePersistedBacktestOrderLog,
  parseBacktestArtifactRef,
} from '@tradejs/infra/backtestArtifacts';
import { delKey, getData, redisKeys, setData } from '@tradejs/infra/redis';
import { Item } from '@tradejs/types';
import { logger } from '@tradejs/infra/logger';
import { auth } from '#app/auth';

interface Params {
  strategy: string;
  name: string;
}

export const DELETE = async (
  _req: Request,
  { params }: { params: Promise<Params> },
) => {
  try {
    const { name, strategy } = await params;

    if (!name || !strategy) {
      return NextResponse.json(
        { error: 'Missing required parameter: name/strategy' },
        { status: 400 },
      );
    }

    const session = await auth();
    const userName = session?.user?.id || session?.user?.name;

    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const storedOrderLog = await getData(
      redisKeys.testOrders(userName, strategy, name),
      null,
    );
    const orderLogRef = parseBacktestArtifactRef(storedOrderLog);

    const removeResults = await Promise.all([
      delKey(redisKeys.testConfig(userName, strategy, name)),
      delKey(redisKeys.testStat(userName, strategy, name)),
      delKey(redisKeys.testOrders(userName, strategy, name)),
      deletePersistedBacktestOrderLog({
        userName,
        strategyName: strategy,
        testName: name,
        ref: orderLogRef,
      }),
    ]);

    const removedKeys = removeResults.filter(Boolean).length;

    if (removedKeys === 0) {
      return NextResponse.json(
        { error: 'Backtest not found' },
        { status: 404 },
      );
    }

    const indexedItems = (await getData(
      redisKeys.testSummaries(userName),
      [],
    )) as Item[];
    const nextIndexedItems = indexedItems.filter(
      (item) =>
        !(
          item?.value === name &&
          typeof item?.data?.strategyName === 'string' &&
          item.data.strategyName === strategy
        ),
    );
    await setData(redisKeys.testSummaries(userName), nextIndexedItems, {
      expire: 0,
    });

    return NextResponse.json({ deleted: true, removedKeys });
  } catch (error) {
    logger.log('error', 'Backtest delete error: %o', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
