'use server';

import { OrderLogData } from '@types';
import { getCache } from '@utils/cache';
import { Item } from '@types';

import fs from 'fs';
const path = require('path');

const dataDir = path.join(process.cwd(), 'data');

export const getBacktestFiles = async (symbol: string) => {
  const files = fs.readdirSync(dataDir);

  const result = files
    .filter(
      (file) =>
        file.startsWith(`_backtest_${symbol}`) &&
        file.endsWith('.json') &&
        !file.includes('.info'),
    )
    .map((file) => {
      const fileName = file.replace('.json', '');
      const label = fileName
        .replace(`${symbol}_`, '')
        .replace('_backtest_', '');

      return {
        value: fileName,
        label: label,
      } as Item;
    });

  return result;
};

export const backtest = async (id: string): Promise<OrderLogData> => {
  const data = getCache('data', id) as OrderLogData;

  return new Promise((resolve) => resolve(data));
};
