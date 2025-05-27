import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';

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
      helper(index + 1, { ...current, [key]: value });
    }
  };

  helper();
  return combinations;
};

export const generateName = (prefix: string): string => {
  const uuid = uuidv4();
  const lastSix = uuid.slice(-6);

  return `${prefix}_${lastSix}_${format(new Date(), 'dd.MM-HH:mm')}`;
};
