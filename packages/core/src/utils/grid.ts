import _ from 'lodash';
import { BACKTEST_DEFAULT_DAYS } from '../constants';
import {
  Interval,
  TestSuite,
  StrategyConfig,
  StrategyConfigGrid,
} from '@tradejs/types';
import { getTimestamp } from './timestamp';
import { toJson } from './toJson';
import { IdGenerator, uuid } from './uuid';

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

export const generateName = (
  prefix: string,
  generateId: IdGenerator = uuid,
): string => `${prefix}_${generateId(6)}`;

const toBase36Hash = (value: string) => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36).padStart(6, '0');
};

const buildConfigTestId = (config: StrategyConfig) =>
  toBase36Hash(toJson(config)).slice(0, 6);

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
  interval: Interval = '15' as Interval,
  generateId: IdGenerator = uuid,
): TestSuite => {
  const start = getTimestamp(BACKTEST_DEFAULT_DAYS);
  const end = getTimestamp();
  const testSuiteId = generateId(6);
  const paramGrid = generateParamGrid(backtestConfig);

  return tickers.flatMap((symbol) =>
    paramGrid.map((params) => {
      const testId = generateId(6);
      const configId = buildConfigTestId(params);
      return {
        userName,
        name: `${symbol}_${testSuiteId}_${testId}`,
        testId,
        testSuiteId,
        configId,
        symbol,
        interval,
        options: { start, end },
        strategyName,
        strategyConfig: params,
        connectorName,
      };
    }),
  );
};
