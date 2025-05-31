'use server';

import { OrderLogData } from '@types';
import { getData } from '@/src/utils/data';
import { Item } from '@types';

import fs from 'fs';
const path = require('path');

const dataDir = path.join(process.cwd(), 'data', 'tests');

export const getBacktestFiles = async (symbol: string) => {
  const files = fs.readdirSync(dataDir);

  const result = files
    .filter(
      (file) =>
        file.endsWith('.json') &&
        !file.includes('.info'),
    )
    .map((file) => {
      const fileName = file.replace('.json', '');
      const label = fileName
        .replace(`${symbol}_`, '')

      return {
        value: fileName,
        label: label,
      } as Item;
    });

  return result;
};

export const backtest = async (id: string): Promise<OrderLogData> => {
  const data = getData('data/tests', id) as OrderLogData;

  return data;
};
