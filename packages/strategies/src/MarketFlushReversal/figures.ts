import type { Direction, StrategyEntryModelFigures } from '@tradejs/types';
import { buildEntryStopTargetFigures } from '../shared/contextStrategy';

export const buildMarketFlushReversalFigures = ({
  direction,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  referenceTimestamp,
  referencePrice,
}: {
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  referenceTimestamp?: number | null;
  referencePrice?: number | null;
}): StrategyEntryModelFigures =>
  buildEntryStopTargetFigures({
    idPrefix: 'mfr',
    direction,
    entryTimestamp,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    referenceTimestamp,
    referencePrice,
    referenceKind: 'flush_level',
  });
