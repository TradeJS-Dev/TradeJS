import {
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoints,
} from '@tradejs/types';
import { CupAndHandlePattern } from './engine';

export const buildCupAndHandleFigures = ({
  pattern,
  entryTimestamp,
  entryPrice,
}: {
  pattern: CupAndHandlePattern;
  entryTimestamp: number;
  entryPrice: number;
}): StrategyEntryModelFigures => {
  const color = pattern.direction === 'LONG' ? '#22c55e' : '#ef4444';
  const [leftRim, cupExtreme, rightRim, handleExtreme] = pattern.pivots;
  const cupPoints = [
    { timestamp: leftRim.timestamp, value: leftRim.value },
    { timestamp: cupExtreme.timestamp, value: cupExtreme.value },
    { timestamp: rightRim.timestamp, value: rightRim.value },
  ];
  const handlePoints = [
    { timestamp: rightRim.timestamp, value: rightRim.value },
    { timestamp: handleExtreme.timestamp, value: handleExtreme.value },
    { timestamp: entryTimestamp, value: entryPrice },
  ];

  const lines: StrategyFigureLine[] = [
    {
      id: `cuphandle-cup-${entryTimestamp}`,
      kind: `cuphandle_${pattern.kind}_cup`,
      points: cupPoints,
      color,
      width: 2,
      style: 'solid',
    },
    {
      id: `cuphandle-handle-${entryTimestamp}`,
      kind: `cuphandle_${pattern.kind}_handle`,
      points: handlePoints,
      color,
      width: 2,
      style: 'solid',
    },
    {
      id: `cuphandle-neckline-${entryTimestamp}`,
      kind: 'cuphandle_neckline',
      points: [
        { timestamp: leftRim.timestamp, value: pattern.neckline },
        { timestamp: entryTimestamp, value: pattern.neckline },
      ],
      color: '#f59e0b',
      width: 2,
      style: 'dashed',
    },
    {
      id: `cuphandle-target-${entryTimestamp}`,
      kind: 'cuphandle_target',
      points: [
        { timestamp: leftRim.timestamp, value: pattern.targetPrice },
        { timestamp: entryTimestamp, value: pattern.targetPrice },
      ],
      color: '#22c55e',
      width: 1,
      style: 'dashed',
    },
    {
      id: `cuphandle-stop-${entryTimestamp}`,
      kind: 'cuphandle_stop',
      points: [
        { timestamp: handleExtreme.timestamp, value: pattern.stopLossPrice },
        { timestamp: entryTimestamp, value: pattern.stopLossPrice },
      ],
      color: '#ef4444',
      width: 1,
      style: 'dashed',
    },
  ];

  const points: StrategyFigurePoints[] = [
    {
      id: `cuphandle-pivots-${entryTimestamp}`,
      kind: `cuphandle_${pattern.kind}_pivots`,
      points: [...cupPoints, handlePoints[1]],
      color,
      radius: 4,
    },
    {
      id: `cuphandle-entry-${entryTimestamp}`,
      kind: 'cuphandle_entry',
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color,
      radius: 5,
    },
  ];

  return { lines, points };
};
