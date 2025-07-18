import { format } from 'date-fns';
import { uuid } from '@utils/uuid';

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
