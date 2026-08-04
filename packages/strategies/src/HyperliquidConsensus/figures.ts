import type { Direction, StrategyEntryModelFigures } from '@tradejs/types';
import type { HyperliquidConsensusSignalContext } from './engine';
import {
  buildEntryEvidenceAnnotation,
  buildEntryStopTargetFigures,
  formatFigureMetric,
  formatFigureRatioAsPercent,
} from '../shared/contextStrategy';

export const buildHyperliquidConsensusFigures = ({
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
  context: HyperliquidConsensusSignalContext;
}): StrategyEntryModelFigures => {
  const figures = buildEntryStopTargetFigures({
    idPrefix: 'hlc',
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
        idPrefix: 'hlc',
        kind: 'hyperliquid_consensus_entry_evidence',
        direction,
        entryTimestamp,
        entryPrice,
        title: `Hyperliquid consensus ${direction}`,
        items: [
          `Consensus: ${formatFigureRatioAsPercent(context.consensusScore, 1)}`,
          `Entry LONG share: ${formatFigureRatioAsPercent(context.entryLongSharePct, 1)}`,
          `Entry wallets: ${context.entryWhales}; coverage: ${formatFigureRatioAsPercent(context.coveragePct, 0)}`,
          `Position-aware: ${formatFigureRatioAsPercent(context.positionAwarePct, 0)}`,
          `Entry net notional: ${formatFigureMetric(context.entryNetNotionalUsd, 0, ' USD')}`,
          `Total entry notional: ${formatFigureMetric(context.totalEntryNotionalUsd, 0, ' USD')}`,
          `Long/short exits: ${formatFigureMetric(context.longExitNotionalUsd, 0, ' USD')} / ${formatFigureMetric(context.shortExitNotionalUsd, 0, ' USD')}`,
          `Window: ${context.interval}; age: ${formatFigureMetric(context.ageMs, 0, ' ms')}`,
        ],
      }),
    ],
  };
};
