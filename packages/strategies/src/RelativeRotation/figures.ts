import type { Direction, StrategyEntryModelFigures } from '@tradejs/types';
import { buildEntryStopTargetFigures } from '../shared/contextStrategy';

export const buildRelativeRotationFigures = ({
  direction,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
}: {
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
}): StrategyEntryModelFigures =>
  buildEntryStopTargetFigures({
    idPrefix: 'rr',
    direction,
    entryTimestamp,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
  });
