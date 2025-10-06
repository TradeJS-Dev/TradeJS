import { NextResponse } from 'next/server';
import { Item, TestStat } from '@types';
import { getData, getKeys } from '@utils/redis';
import { parseTestName } from '@utils/tests';
import { logger } from '@utils/logger';

const AREA = 'tests';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    const result = new Array<Item>();
    const keys = await getKeys(`${AREA}:`);
    const orderKeys = keys.filter((file) => file.endsWith(':orders'));

    for await (const key of orderKeys) {
      const testName = key.replace('tests:', '').replace(':orders', '');
      const { symbol, testId } = parseTestName(testName);
      const stat: TestStat = await getData(`${AREA}:${testName}:stat`);

      result.push({
        value: testName,
        label: `${symbol}_${testId}`,
        description: `${stat.netProfit}$`,
        data: {
          netProfit: stat.netProfit || 0,
        },
      });
    }

    return NextResponse.json({ items: result });
  } catch (error) {
    logger.log('error', `Backtest list error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
