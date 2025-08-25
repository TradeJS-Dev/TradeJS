'use server';

import { OrderLogData, TestStat, TestResult, Item, Test } from '@types';
import { getFiles, getData } from '@utils/data';
import { getTimeline, compactOrderLog } from '@utils/timestamp';

interface GetBacktestFilesProps {
  symbol?: string;
}

const DIR = 'data/tests';

const splitName = (name: string) => {
  const [symbol, testSuiteId, testId] = name.split('_');
  return { symbol, testSuiteId, testId };
};

export const getBacktestFiles = async (filters: GetBacktestFilesProps) => {
  const result = new Array<Item>();
  const files = await getFiles(DIR);
  const orderFiles = files.filter((file) => file.endsWith('.orders.json'));

  for await (const file of orderFiles) {
    const name = file.replace('.orders.json', '');

    const { symbol, testSuiteId, testId } = splitName(name);

    const stat = (await getData('data/tests', `${name}.stat`, {
      useCache: false,
    })) as TestStat;

    if (filters.symbol && symbol !== filters.symbol) {
      continue;
    }

    result.push({
      value: name,
      label: `${symbol}_${testId}`,
      description: `${stat.netProfit}$`,
      data: {
        netProfit: stat.netProfit || 0,
      },
    });
  }

  result.sort(
    (a, b) => (b.data?.netProfit as number) - (a.data?.netProfit as number),
  );

  return result;
};

export const getOrderLog = async (
  name: string | undefined,
): Promise<OrderLogData | null> => {
  if (!name) {
    return null;
  }

  const orderLog = (await getData(DIR, `${name}.orders`, {
    useCache: false,
  })) as OrderLogData;

  return orderLog;
};

export const getBacktest = async (
  name: string | undefined,
): Promise<TestResult | null> => {
  if (!name) {
    return null;
  }

  const orderLog: OrderLogData = await getData(DIR, `${name}.orders`, {
    useCache: false,
  });
  const test: Test = await getData(DIR, `${name}.config`, {
    useCache: false,
  });
  const stat: TestStat = await getData(DIR, `${name}.stat`, {
    useCache: false,
  });

  const timeline = getTimeline(test.options.start, test.options.end);

  return {
    test,
    orderLog: compactOrderLog(timeline, orderLog),
    stat,
  };
};
