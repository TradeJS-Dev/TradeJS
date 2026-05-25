import {
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoints,
} from '@tradejs/types';
import { DoubleTapPattern } from './engine';

export const buildDoubleTapFigures = ({
  pattern,
  entryTimestamp,
  entryPrice,
}: {
  pattern: DoubleTapPattern;
  entryTimestamp: number;
  entryPrice: number;
}): StrategyEntryModelFigures => {
  const color = pattern.direction === 'LONG' ? '#22c55e' : '#ef4444';
  const [p1, p2, p3, p4] = pattern.pivots;

  const patternPoints = [
    { timestamp: p1.timestamp, value: p1.value },
    { timestamp: p2.timestamp, value: p2.value },
    { timestamp: p3.timestamp, value: p3.value },
    { timestamp: p4.timestamp, value: p4.value },
    { timestamp: entryTimestamp, value: entryPrice },
  ];

  const lines: StrategyFigureLine[] = [
    {
      id: `doubletap-pattern-${entryTimestamp}`,
      kind: `doubletap_${pattern.kind}_pattern`,
      points: patternPoints,
      color,
      width: 2,
      style: 'solid',
    },
    {
      id: `doubletap-neckline-${entryTimestamp}`,
      kind: 'doubletap_neckline',
      points: [
        { timestamp: p3.timestamp, value: pattern.neckline },
        { timestamp: entryTimestamp, value: pattern.neckline },
      ],
      color: '#f59e0b',
      width: 2,
      style: 'dashed',
    },
    {
      id: `doubletap-target-${entryTimestamp}`,
      kind: 'doubletap_target',
      points: [
        { timestamp: p3.timestamp, value: pattern.targetPrice },
        { timestamp: entryTimestamp, value: pattern.targetPrice },
      ],
      color: '#22c55e',
      width: 1,
      style: 'dashed',
    },
    {
      id: `doubletap-stop-${entryTimestamp}`,
      kind: 'doubletap_stop',
      points: [
        { timestamp: p3.timestamp, value: pattern.stopLossPrice },
        { timestamp: entryTimestamp, value: pattern.stopLossPrice },
      ],
      color: '#ef4444',
      width: 1,
      style: 'dashed',
    },
  ];

  const points: StrategyFigurePoints[] = [
    {
      id: `doubletap-pivots-${entryTimestamp}`,
      kind: `doubletap_${pattern.kind}_pivots`,
      points: patternPoints.slice(0, 4),
      color,
      radius: 4,
    },
    {
      id: `doubletap-entry-${entryTimestamp}`,
      kind: 'doubletap_entry',
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color,
      radius: 5,
    },
  ];

  return { lines, points };
};
