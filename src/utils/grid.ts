import { format } from 'date-fns';
import { uuid } from '@utils/uuid';
import _ from 'lodash';

type GenericConfig = Record<string, any>;

export const generateParamGrid = <T extends Record<string, any>>(
  paramOptions: Record<keyof T, T[keyof T][]>,
): T[] => {
  const keys = Object.keys(paramOptions) as (keyof T)[];
  const combinations: T[] = [];

  const helper = (index = 0, current: Partial<T> = {}) => {
    if (index === keys.length) {
      combinations.push(current as T);
      return;
    }

    const key = keys[index];
    for (const value of paramOptions[key]) {
      const copiedValue =
        typeof value === 'object' && value !== null
          ? structuredClone(value)
          : value;
      helper(index + 1, { ...current, [key]: copiedValue });
    }
  };

  helper();
  return combinations;
};

export const generateName = (prefix: string): string =>
  `${prefix}_${uuid(6)}_${format(new Date(), 'dd.MM-HH:mm')}`;

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
