'use server';

import {
  OrderLogData,
  StrategyConfig,
  BacktestStat,
  BacktestHistory,
  Item,
} from '@types';
import { getData } from '@/src/utils/data';

import fs from 'fs';
const path = require('path');

const dataDir = path.join(process.cwd(), 'data', 'tests');

export const getBacktestFiles = async (symbol: string) => {
  const result = new Array<Item>();
  const files = fs.readdirSync(dataDir);
  const orderFiles = files.filter(
    (file) => file.endsWith('.orders.json') && file.startsWith(symbol),
  );

  for await (const file of orderFiles) {
    const id = file.replace('.orders.json', '');

    const stat = (await getData('data/tests', `${id}.stat`)) as BacktestStat;

    const label = id.replace(`${symbol}_`, '');

    result.push({
      value: id,
      label: label,
      data: {
        score: stat.score || 0,
      },
    });
  }

  result.sort((a, b) => (b.data?.score as number) - (a.data?.score as number));

  return result;
};

export const getBacktest = async (
  id: string | undefined,
): Promise<BacktestHistory | null> => {
  if (!id) {
    return null;
  }

  const orderLog = (await getData(
    'data/tests',
    `${id}.orders`,
  )) as OrderLogData;
  const strategyConfig = (await getData(
    'data/tests',
    `${id}.orders`,
  )) as StrategyConfig;
  const stat = (await getData('data/tests', `${id}.stat`)) as BacktestStat;

  return {
    orderLog,
    strategyConfig,
    stat,
  };
};
