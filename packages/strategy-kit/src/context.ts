import type { Direction } from '@tradejs/types';

export const isDirectionAligned = ({
  direction,
  bullValue,
  bearValue,
  value,
}: {
  direction: Direction;
  bullValue: string;
  bearValue: string;
  value: string | null | undefined;
}) => (direction === 'LONG' ? value === bullValue : value === bearValue);

export const isPressureAligned = ({
  direction,
  buyPressurePct,
  bullishMin = 0.55,
  bearishMax = 0.45,
}: {
  direction: Direction;
  buyPressurePct: number | null | undefined;
  bullishMin?: number;
  bearishMax?: number;
}) =>
  buyPressurePct == null
    ? null
    : direction === 'LONG'
      ? buyPressurePct >= bullishMin
      : buyPressurePct <= bearishMax;
