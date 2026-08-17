import type {
  Direction,
  StrategyEntryModelFigures,
  StrategyFigureLine,
} from '@tradejs/types';
import {
  buildEntryEvidenceAnnotation,
  buildEntryStopTargetFigures,
} from '@tradejs/strategy-kit/figures';

type BreakoutSignalRule = {
  weight: number;
  required?: boolean;
};

type BuildBreakoutFiguresParams = {
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  referenceTimestamp: number;
  breakoutLevel: number;
  volatilityBand: number;
  signals: Record<string, boolean>;
  signalRules: Record<string, BreakoutSignalRule | undefined>;
  requiredScore: number;
};

const formatSignalName = (signal: string) =>
  signal.toLowerCase().replaceAll('_', ' ');

export const buildBreakoutFigures = ({
  direction,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  referenceTimestamp,
  breakoutLevel,
  volatilityBand,
  signals,
  signalRules,
  requiredScore,
}: BuildBreakoutFiguresParams): StrategyEntryModelFigures => {
  const figures = buildEntryStopTargetFigures({
    idPrefix: 'breakout',
    direction,
    entryTimestamp,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    referenceTimestamp,
    referencePrice: breakoutLevel,
    referenceKind: 'breakout_level',
  });
  const activeRules = Object.entries(signalRules).filter(
    ([signal]) => signals[signal],
  );
  const score = activeRules.reduce(
    (total, [, rule]) => total + Number(rule?.weight ?? 0),
    0,
  );
  const bandLine: StrategyFigureLine = {
    id: `breakout-volatility-band-${entryTimestamp}`,
    kind: 'breakout_volatility_band',
    points: [
      { timestamp: referenceTimestamp, value: volatilityBand },
      { timestamp: entryTimestamp, value: volatilityBand },
    ],
    color: '#a78bfa',
    width: 1,
    style: 'dashed',
  };

  return {
    ...figures,
    lines: [...(figures.lines ?? []), bandLine],
    annotations: [
      buildEntryEvidenceAnnotation({
        idPrefix: 'breakout',
        kind: 'breakout_entry_evidence',
        direction,
        entryTimestamp,
        entryPrice,
        title: `Breakout ${direction}`,
        items: [
          `Score: ${score.toFixed(2)} / ${requiredScore.toFixed(2)}`,
          ...activeRules.map(
            ([signal, rule]) =>
              `${rule?.required ? 'Required' : 'Active'}: ${formatSignalName(signal)}`,
          ),
        ],
      }),
    ],
  };
};
