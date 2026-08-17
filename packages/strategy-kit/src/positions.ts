import type { Position } from '@tradejs/types';
import { isFiniteNumber } from './numbers';

export const isOpenPosition = (
  position: Position | null,
): position is Position =>
  Boolean(
    position &&
      isFiniteNumber(position.price) &&
      isFiniteNumber(position.qty) &&
      position.qty > 0 &&
      (position.direction === 'LONG' || position.direction === 'SHORT'),
  );
