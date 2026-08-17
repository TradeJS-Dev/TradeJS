import type {
  Direction,
  StrategyEntryModelFigures,
  StrategyFigurePoints,
} from '@tradejs/types';
import type { MarketFlushReversalSignalContext } from './contracts';
import {
  buildEntryEvidenceAnnotation,
  buildEntryStopTargetFigures,
  formatFigureMetric,
  formatFigureRatioAsPercent,
} from '@tradejs/strategy-kit/figures';

export const buildMarketFlushReversalFigures = ({
  direction,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  referenceTimestamp,
  referencePrice,
  context,
}: {
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  referenceTimestamp?: number | null;
  referencePrice?: number | null;
  context: MarketFlushReversalSignalContext;
}): StrategyEntryModelFigures => {
  const figures = buildEntryStopTargetFigures({
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

  const flushPoint: StrategyFigurePoints | null =
    referenceTimestamp != null &&
    referencePrice != null &&
    Number.isFinite(referencePrice)
      ? {
          id: `mfr-flush-point-${entryTimestamp}`,
          kind: 'mfr_flush_reference',
          points: [{ timestamp: referenceTimestamp, value: referencePrice }],
          color: '#facc15',
          radius: 5,
        }
      : null;

  return {
    ...figures,
    points: [
      ...(figures.points ?? []),
      ...(flushPoint == null ? [] : [flushPoint]),
    ],
    annotations: [
      buildEntryEvidenceAnnotation({
        idPrefix: 'mfr',
        kind: 'market_flush_reversal_entry_evidence',
        direction,
        entryTimestamp,
        entryPrice,
        title: `Market flush reversal ${direction}`,
        items: [
          `Pressure: ${context.marketPressure ?? 'n/a'}; liq spike: ${formatFigureMetric(context.marketLiqSpikeRatio)}`,
          `Liq imbalance: ${formatFigureMetric(context.marketLiqImbalance)}; funding z: ${formatFigureMetric(context.marketFundingZScore)}`,
          `Structure: ${context.sweepState ?? 'no sweep'} / ${context.breakoutState ?? 'no breakout'}`,
          `Tail: ${context.tailSide ?? 'n/a'}; wick: ${formatFigureRatioAsPercent(context.sweepWickPct)}`,
          `Volume rel20: ${formatFigureMetric(context.volumeRel20)}; buy pressure: ${formatFigureRatioAsPercent(context.buyPressurePct)}`,
          `Delta divergence: ${context.deltaDivergenceVsPrice ?? 'n/a'}; flags: ${context.marketRiskFlags.join(', ') || 'none'}`,
          `Entry: ${context.entryMode ?? 'immediate'} after ${context.entryDelayBars ?? 0} bars`,
          `Price improvement ATR: ${formatFigureMetric(context.priceImprovementAtr)}`,
        ],
      }),
    ],
  };
};
