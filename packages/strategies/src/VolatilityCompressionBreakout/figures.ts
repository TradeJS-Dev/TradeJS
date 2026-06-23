import type { Direction, StrategyEntryModelFigures } from '@tradejs/types';
import { buildEntryStopTargetFigures } from '../shared/contextStrategy';

export const buildVolatilityCompressionBreakoutFigures = ({
  direction,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  breakoutLevel,
}: {
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  breakoutLevel?: number | null;
}): StrategyEntryModelFigures =>
  buildEntryStopTargetFigures({
    idPrefix: 'vcb',
    direction,
    entryTimestamp,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    referencePrice: breakoutLevel,
    referenceKind: 'breakout_level',
  });
