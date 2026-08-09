import type { Direction } from '@tradejs/types';

export const resolveDirectionalConfigNumber = ({
  config,
  key,
  direction,
  fallback,
}: {
  config: object;
  key: string;
  direction: Direction;
  fallback: number;
}) => {
  const record = config as Record<string, unknown>;
  const directionalValue = record[`${key}_${direction}`];
  const baseValue = record[key];
  const parsed = Number(directionalValue ?? baseValue ?? fallback);

  return Number.isFinite(parsed) ? parsed : fallback;
};
