'use server';

import { OrderLogData, TestStat, TestResult, Item, Test } from '@types';
import { getData } from '@/src/utils/data';
import fs from 'fs';
const path = require('path');

interface GetBacktestFilesProps {
  symbol?: string;
}

const dataDir = path.join(process.cwd(), 'data', 'tests');

const splitName = (name: string) => {
  const [symbol, testSuiteId, testId] = name.split('_');
  return { symbol, testSuiteId, testId };
};

export const getBacktestFiles = async (filters: GetBacktestFilesProps) => {
  const result = new Array<Item>();
  const files = fs.readdirSync(dataDir);
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
      label: testId,
      data: {
        score: stat.score || 0,
        symbol,
        testSuiteId,
        testId,
      },
    });
  }

  result.sort((a, b) => (b.data?.score as number) - (a.data?.score as number));

  return result;
};

export const getOrderLog = async (
  name: string | undefined,
): Promise<OrderLogData | null> => {
  if (!name) {
    return null;
  }

  const orderLog = (await getData('data/tests', `${name}.orders`, {
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

  const orderLog = (await getData('data/tests', `${name}.orders`, {
    useCache: false,
  })) as OrderLogData;
  const test = (await getData('data/tests', `${name}.config`, {
    useCache: false,
  })) as Test;
  const stat = (await getData('data/tests', `${name}.stat`, {
    useCache: false,
  })) as TestStat;

  return {
    test,
    orderLog: orderLog.map(({ timestamp, amount }) => ([timestamp, Math.round(amount * 100) / 100 ])),
    stat,
  };
};
