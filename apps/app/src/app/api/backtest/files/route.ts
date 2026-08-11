import { NextResponse } from 'next/server';
import { TestStat } from '@tradejs/types';
import type { Item } from '#app/types/ui';
import { parseTestName } from '@tradejs/core/backtest';
import { TTL_1M } from '@tradejs/core/constants';
import { getData, getKeys, redisKeys, setData } from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';
import { auth } from '#app/auth';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    const session = await auth();
    const userName = session?.user?.id || session?.user?.name;

    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = new Array<Item>();
    const indexedItems = (await getData(
      redisKeys.testSummaries(userName),
      null,
    )) as Item[] | null;

    if (Array.isArray(indexedItems) && indexedItems.length) {
      return NextResponse.json({ items: indexedItems });
    }

    const testsPrefix = redisKeys.tests(userName);
    const keys = await getKeys(testsPrefix);
    const configKeys = keys.filter((key) => key.endsWith(':config'));

    for await (const key of configKeys) {
      const parts = key.split(':');
      if (parts.length < 5) {
        continue;
      }
      const strategyName = parts[3];
      const testName = parts[4];
      const { symbol, testId } = parseTestName(testName);

      const stat: TestStat = await getData(
        redisKeys.testStat(userName, strategyName, testName),
      );

      if (!stat) {
        continue;
      }

      result.push({
        value: testName,
        label: `${symbol}_${testId}`,
        description: `${stat.netProfit}$`,
        data: {
          netProfit: stat.netProfit || 0,
          strategyName,
        },
      });
    }

    await setData(redisKeys.testSummaries(userName), result, {
      expire: TTL_1M,
    });

    return NextResponse.json({ items: result });
  } catch (error) {
    logger.log('error', `Backtest list error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
