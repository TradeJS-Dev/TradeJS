'use server';

import { OrderLogData, TestStat, TestResult, Item, Test } from '@types';
import { getFiles, getData } from '@utils/data';
import { parseTestName } from '@utils/tests';
import { getTimeline, compactOrderLog } from '@utils/timestamp';

const DIR = 'data/tests';

export const getBacktestFiles = async () => {
  const result = new Array<Item>();
  const files = await getFiles(DIR);
  const orderFiles = files.filter((file) => file.endsWith('.orders.json'));

  for await (const file of orderFiles) {
    const testName = file.replace('.orders.json', '');

    const { symbol, testId } = parseTestName(testName);

    const stat: TestStat = await getData('data/tests', `${testName}.stat`);

    result.push({
      value: testName,
      label: `${symbol}_${testId}`,
      description: `${stat.netProfit}$`,
      data: {
        netProfit: stat.netProfit || 0,
      },
    });
  }

  return result;
};

export const getOrderLog = async (
  name: string | undefined,
): Promise<OrderLogData | null> => {
  if (!name) {
    return null;
  }

  const orderLog: OrderLogData = await getData(DIR, `${name}.orders`);

  return orderLog;
};

export const getBacktest = async (
  name: string | undefined,
): Promise<TestResult | null> => {
  if (!name) {
    return null;
  }

  const orderLog: OrderLogData = await getData(DIR, `${name}.orders`);
  const test: Test = await getData(DIR, `${name}.config`);
  const stat: TestStat = await getData(DIR, `${name}.stat`);

  const timeline = getTimeline(test.options.start, test.options.end);

  return {
    test,
    orderLog: compactOrderLog(timeline, orderLog),
    stat,
  };
};
