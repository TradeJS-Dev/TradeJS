import {
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoints,
  StrategyFigureZone,
} from '@tradejs/types';
import { StructureZonesSignal } from './engine';

export const buildStructureZonesFigures = ({
  signal,
  swingPoints,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
}: {
  signal: StructureZonesSignal;
  swingPoints: Array<{ timestamp: number; value: number }>;
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
}): StrategyEntryModelFigures => {
  const color = signal.direction === 'LONG' ? '#22c55e' : '#ef4444';
  const startTimestamp = Math.min(
    signal.lastHigh.timestamp,
    signal.lastLow.timestamp,
  );
  const zones: StrategyFigureZone[] = [
    {
      id: `structure-zones-resistance-${entryTimestamp}`,
      kind: 'structure_zones_resistance',
      start: { timestamp: startTimestamp, value: signal.resistanceZone.top },
      end: { timestamp: entryTimestamp, value: signal.resistanceZone.bottom },
      color: 'rgba(239,68,68,0.12)',
      borderColor: 'rgba(239,68,68,0.45)',
    },
    {
      id: `structure-zones-support-${entryTimestamp}`,
      kind: 'structure_zones_support',
      start: { timestamp: startTimestamp, value: signal.supportZone.top },
      end: { timestamp: entryTimestamp, value: signal.supportZone.bottom },
      color: 'rgba(34,197,94,0.12)',
      borderColor: 'rgba(34,197,94,0.45)',
    },
  ];
  const lines: StrategyFigureLine[] = [
    {
      id: `structure-zones-target-${entryTimestamp}`,
      kind: 'structure_zones_target',
      points: [
        { timestamp: startTimestamp, value: takeProfitPrice },
        { timestamp: entryTimestamp, value: takeProfitPrice },
      ],
      color: '#22c55e',
      width: 1,
      style: 'dashed',
    },
    {
      id: `structure-zones-stop-${entryTimestamp}`,
      kind: 'structure_zones_stop',
      points: [
        { timestamp: startTimestamp, value: stopLossPrice },
        { timestamp: entryTimestamp, value: stopLossPrice },
      ],
      color: '#ef4444',
      width: 1,
      style: 'dashed',
    },
  ];
  const points: StrategyFigurePoints[] = [
    {
      id: `structure-zones-swings-${entryTimestamp}`,
      kind: 'structure_zones_swings',
      points: swingPoints,
      color: '#f59e0b',
      radius: 4,
    },
    {
      id: `structure-zones-entry-${entryTimestamp}`,
      kind: 'structure_zones_entry',
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color,
      radius: 5,
    },
  ];

  return { zones, lines, points };
};
