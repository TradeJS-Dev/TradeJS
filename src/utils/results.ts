import { ConnectorStat } from '@types';
import _ from 'lodash';

type GenericConfig = Record<string, any>;

const WS_WIEGHT = 12;
const MIN_AMOUNT_WEIGHT = 8;
const PROFIT_WEIGHT = 4;
const ORDERS_WEIGHT = 1;

const score = <T extends ConnectorStat>(result: T): number => {
  const { amount, minAmount, ws, orders } = result;

  if (orders === 0) {
    return -2;
  }

  // if (minAmount < 85) {
  //   return -1;
  // }

  const wsScore = ws / 100;
  const minAmountScore = minAmount / 100;
  const profitScore = (amount - 100) / 100;
  const ordersScore = 100 / orders;

  return (
    wsScore * WS_WIEGHT +
    minAmountScore * MIN_AMOUNT_WEIGHT +
    profitScore * PROFIT_WEIGHT +
    ordersScore * ORDERS_WEIGHT
  );
};

export const getTopResults = <T extends ConnectorStat>(
  results: T[],
  limit: number = 5,
): T[] =>
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

      const clonedValue =
        typeof value === 'object' && value !== null
          ? _.cloneDeep(value)
          : value;

      const isDuplicate = result[key].some((existing) =>
        _.isEqual(existing, value),
      );

      if (!isDuplicate) {
        result[key].push(clonedValue);
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
