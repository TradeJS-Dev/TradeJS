import _ from 'lodash';
import { BACKTEST_PRELOAD_DAYS } from '@constants';
import { TestSuite, StrategyConfig, StrategyConfigGrid } from '@types';
import { getTimestamp } from '@utils/timestamp';
import { uuid } from '@utils/uuid';

type GenericConfig = StrategyConfig;

export const generateParamGrid = <T extends StrategyConfig>(
  paramOptions: StrategyConfigGrid,
): T[] => {
  const keys = Object.keys(paramOptions);
  const combinations: T[] = [];

  const helper = (index = 0, current: Partial<T> = {}) => {
    if (index === keys.length) {
      combinations.push(current as T);
      return;
    }

    const key = keys[index];
    for (const value of paramOptions[key] || []) {
      const copiedValue =
        typeof value === 'object' && value !== null
          ? structuredClone(value)
          : value;
      helper(index + 1, {
        ...current,
        [key as keyof T]: copiedValue as T[keyof T],
      });
    }
  };

  helper();
  return combinations;
};

export const generateName = (prefix: string): string => `${prefix}_${uuid(6)}`;

export const mergeConfigs = (
  configs: GenericConfig[],
): Record<string, unknown[]> => {
  const result: Record<string, unknown[]> = {};

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

export const createTestSuite = (
  userName: string,
  tickers: string[],
  strategyName: string,
  backtestConfig: StrategyConfigGrid,
  connectorName: string,
): TestSuite => {
  const start = getTimestamp(BACKTEST_PRELOAD_DAYS);
  const end = getTimestamp();
  const testSuiteId = uuid(6);
  const paramGrid = generateParamGrid(backtestConfig);

  return tickers.flatMap((symbol) =>
    paramGrid.map((params) => {
      const testId = uuid(6);
      return {
        userName,
        name: `${symbol}_${testSuiteId}_${testId}`,
        testId,
        testSuiteId,
        symbol,
        options: { start, end },
        strategyName,
        strategyConfig: params,
        connectorName,
      };
    }),
  );
};
