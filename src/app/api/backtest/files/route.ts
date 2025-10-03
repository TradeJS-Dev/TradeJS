import { NextResponse } from 'next/server';
import { Item, TestStat } from '@types';
import { getData, getFiles } from '@utils/data';
import { parseTestName } from '@utils/tests';
import { logger } from '@utils/logger';

const DIR = 'data/tests';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    const result = new Array<Item>();
    const files = await getFiles(DIR);
    const orderFiles = files.filter((file) => file.endsWith('.orders.json'));

    for await (const file of orderFiles) {
      const testName = file.replace('.orders.json', '');
      const { symbol, testId } = parseTestName(testName);
      const stat: TestStat = await getData(DIR, `${testName}.stat`);

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
