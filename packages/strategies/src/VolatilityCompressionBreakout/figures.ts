import type {
  Direction,
  StrategyEntryModelFigures,
  StrategyFigurePoints,
} from '@tradejs/types';
import type { VolatilityCompressionBreakoutSignalContext } from './contracts';
import {
  buildEntryEvidenceAnnotation,
  buildEntryStopTargetFigures,
  formatFigureMetric,
  formatFigureRatioAsPercent,
} from '../shared/contextStrategy';

export const buildVolatilityCompressionBreakoutFigures = ({
  direction,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  breakoutLevel,
  context,
}: {
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  breakoutLevel?: number | null;
  context: VolatilityCompressionBreakoutSignalContext;
}): StrategyEntryModelFigures => {
  const figures = buildEntryStopTargetFigures({
    idPrefix: 'vcb',
    direction,
    entryTimestamp,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    referencePrice: breakoutLevel,
    referenceKind: 'breakout_level',
  });

  const breakoutPoint: StrategyFigurePoints | null =
    breakoutLevel != null && Number.isFinite(breakoutLevel)
      ? {
          id: `vcb-breakout-point-${entryTimestamp}`,
          kind: 'vcb_breakout_level',
          points: [{ timestamp: entryTimestamp, value: breakoutLevel }],
          color: '#facc15',
          radius: 5,
        }
      : null;

  return {
    ...figures,
    points: [
      ...(figures.points ?? []),
      ...(breakoutPoint == null ? [] : [breakoutPoint]),
    ],
    annotations: [
      buildEntryEvidenceAnnotation({
        idPrefix: 'vcb',
        kind: 'volatility_compression_breakout_entry_evidence',
        direction,
        entryTimestamp,
        entryPrice,
        title: `Compression breakout ${direction}`,
        items: [
          `Breakout: ${context.breakoutState ?? 'structure zone'}`,
          `Compression ranks — ATR: ${formatFigureMetric(context.atrPctRank100, 0)}, BB width: ${formatFigureMetric(context.bbWidthRank100, 0)}`,
          `Expansion rank: ${formatFigureMetric(context.rangeExpansionRank20, 0)}; body: ${formatFigureMetric(context.breakoutBodyAtr)} ATR`,
          `Volume rel20: ${formatFigureMetric(context.volumeRel20)}`,
          `Buy pressure: ${formatFigureRatioAsPercent(context.buyPressurePct)}; trade flow: ${formatFigureRatioAsPercent(context.tradeFlowBuyPressurePct)}`,
          `MTF: ${context.mtfAlignment ?? 'n/a'}`,
        ],
      }),
    ],
  };
};
