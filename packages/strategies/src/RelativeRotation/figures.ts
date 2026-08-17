import type { Direction, StrategyEntryModelFigures } from '@tradejs/types';
import type { RelativeRotationSignalContext } from './contracts';
import {
  buildEntryEvidenceAnnotation,
  buildEntryStopTargetFigures,
  formatFigureMetric,
} from '../shared/strategyKit/figures';

export const buildRelativeRotationFigures = ({
  direction,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  context,
}: {
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  context: RelativeRotationSignalContext;
}): StrategyEntryModelFigures => {
  const figures = buildEntryStopTargetFigures({
    idPrefix: 'rr',
    direction,
    entryTimestamp,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
  });

  return {
    ...figures,
    annotations: [
      buildEntryEvidenceAnnotation({
        idPrefix: 'rr',
        kind: 'relative_rotation_entry_evidence',
        direction,
        entryTimestamp,
        entryPrice,
        title: `Relative rotation ${direction}`,
        items: [
          `BTC ratio: ${context.targetVsBtcRatioTrend ?? 'n/a'}`,
          `Alpha 24h: ${formatFigureMetric(context.targetVsBtcAlpha24h, 2, '%')}`,
          `Ratio return 24h: ${formatFigureMetric(context.targetVsBtcRatioReturn24h, 2, '%')}`,
          `Relative strength 1h: ${formatFigureMetric(context.relativeStrength1h, 2, '%')}`,
          `Rotation score: ${formatFigureMetric(context.rotationScore)}`,
          `Regime: ${context.btcAltRegime ?? 'n/a'}; volume rel20: ${formatFigureMetric(context.volumeRel20)}`,
        ],
      }),
    ],
  };
};
