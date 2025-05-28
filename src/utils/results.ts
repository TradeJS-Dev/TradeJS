import { BacktestStat } from '@types';
import _ from 'lodash';

type GenericConfig = Record<string, any>;

const WS_WIEGHT = 24;
const MIN_AMOUNT_WEIGHT = 16;
const PROFIT_WEIGHT = 8;
const ORDERS_WEIGHT = 1;

const score = (result: BacktestStat): number => {
  const { amount, minAmount, ws, orders } = result;

  if (orders === 0) {
    return -2;
  }

  if (minAmount < 85) {
    return -1;
  }

  const wsScore = ws / 100;
  const minAmountScore = (minAmount - 85) / 100;
  const profitScore = (amount - 100) / 100;
  const ordersScore = orders / 100;

  return (
    wsScore * WS_WIEGHT +
    minAmountScore * MIN_AMOUNT_WEIGHT +
    profitScore * PROFIT_WEIGHT +
    ordersScore * ORDERS_WEIGHT
  );
};

export const getTopResults = (
  results: BacktestStat[],
  limit: number = 5,
): BacktestStat[] =>
  results
    .slice()
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);

export const mergeConfigs = (
  configs: GenericConfig[],
): Record<string, any[]> => {
  const result: Record<string, any[]> = {};

  for (const config of configs) {
    for (const [key, value] of Object.entries(config)) {
      if (!result[key]) {
        result[key] = [];
      }

      if (_.isArray(value)) {
        const valueStr = JSON.stringify(value);
        const existingStrs = result[key].map((v) => JSON.stringify(v));
        if (!existingStrs.includes(valueStr)) {
          result[key].push(value);
        }
      } else {
        if (!result[key].includes(value)) {
          result[key].push(value);
        }
      }
    }
  }

  for (const key in result) {
    if (result[key].every((v) => typeof v === 'number')) {
      result[key] = _.sortBy(result[key]);
    }
  }

  return result;
};
