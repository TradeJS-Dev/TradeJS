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

export const generateName = (
  prefix: string,
  params: Record<string, any>,
): string => {
  const parts = Object.entries(params).map(([key, value]) => `${key}_${value}`);
  return `${prefix}_${parts.join('_')}`;
};
