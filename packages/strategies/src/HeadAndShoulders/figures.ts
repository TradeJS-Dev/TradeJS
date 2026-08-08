import {
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoints,
} from '@tradejs/types';
import { HeadAndShouldersPattern } from './engine';

export const buildHeadAndShouldersFigures = ({
  pattern,
  entryTimestamp,
  entryPrice,
}: {
  pattern: HeadAndShouldersPattern;
  entryTimestamp: number;
  entryPrice: number;
}): StrategyEntryModelFigures => {
  const color = pattern.direction === 'LONG' ? '#22c55e' : '#ef4444';
  const [leftShoulder, leftNeck, head, rightNeck, rightShoulder] =
    pattern.pivots;
  const patternPoints = [
    leftShoulder,
    leftNeck,
    head,
    rightNeck,
    rightShoulder,
  ].map(({ timestamp, value }) => ({ timestamp, value }));

  const lines: StrategyFigureLine[] = [
    {
      id: `headshoulders-pattern-${entryTimestamp}`,
      kind: `headshoulders_${pattern.kind}_pattern`,
      points: [
        ...patternPoints,
        { timestamp: entryTimestamp, value: entryPrice },
      ],
      color,
      width: 2,
      style: 'solid',
    },
    {
      id: `headshoulders-neckline-${entryTimestamp}`,
      kind: 'headshoulders_neckline',
      points: [
        { timestamp: leftNeck.timestamp, value: leftNeck.value },
        { timestamp: entryTimestamp, value: pattern.neckline },
      ],
      color: '#f59e0b',
      width: 2,
      style: 'dashed',
    },
    {
      id: `headshoulders-target-${entryTimestamp}`,
      kind: 'headshoulders_target',
      points: [
        { timestamp: rightNeck.timestamp, value: pattern.targetPrice },
        { timestamp: entryTimestamp, value: pattern.targetPrice },
      ],
      color: '#22c55e',
      width: 1,
      style: 'dashed',
    },
    {
      id: `headshoulders-stop-${entryTimestamp}`,
      kind: 'headshoulders_stop',
      points: [
        { timestamp: head.timestamp, value: pattern.stopLossPrice },
        { timestamp: entryTimestamp, value: pattern.stopLossPrice },
      ],
      color: '#ef4444',
      width: 1,
      style: 'dashed',
    },
  ];

  const points: StrategyFigurePoints[] = [
    {
      id: `headshoulders-pivots-${entryTimestamp}`,
      kind: `headshoulders_${pattern.kind}_pivots`,
      points: patternPoints,
      color,
      radius: 4,
    },
    {
      id: `headshoulders-entry-${entryTimestamp}`,
      kind: 'headshoulders_entry',
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color,
      radius: 5,
    },
  ];

  return { lines, points };
};
