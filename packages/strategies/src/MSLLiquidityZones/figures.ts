import {
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoints,
  StrategyFigureZone,
} from '@tradejs/types';
import { MSLLiquidityZone, MSLLiquidityZonesSignal } from './engine';

export const buildMSLLiquidityZonesFigures = ({
  signal,
  zones,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  maxZones,
}: {
  signal: MSLLiquidityZonesSignal;
  zones: MSLLiquidityZone[];
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  maxZones: number;
}): StrategyEntryModelFigures => {
  const isLong = signal.direction === 'LONG';
  const color = isLong ? '#40d98f' : '#f67171';
  const activeZones = zones
    .filter((zone) => !zone.crossed)
    .slice(Math.max(0, zones.length - Math.max(1, maxZones)));

  const figureZones: StrategyFigureZone[] = [
    ...activeZones.map((zone) => ({
      id: zone.id,
      kind: `mslzones_${zone.kind}`,
      start: { timestamp: zone.startTimestamp, value: zone.top },
      end: { timestamp: entryTimestamp, value: zone.bottom },
      color:
        zone.direction === 'LONG'
          ? 'rgba(64,217,143,0.1)'
          : 'rgba(246,113,113,0.1)',
      borderColor:
        zone.direction === 'LONG'
          ? 'rgba(64,217,143,0.35)'
          : 'rgba(246,113,113,0.35)',
    })),
    {
      id: `${signal.zone.id}-entry-zone`,
      kind: `mslzones_${signal.zone.kind}_entry_zone`,
      start: { timestamp: signal.zone.startTimestamp, value: signal.zone.top },
      end: { timestamp: entryTimestamp, value: signal.zone.bottom },
      color: isLong ? 'rgba(64,217,143,0.2)' : 'rgba(246,113,113,0.2)',
      borderColor: isLong ? 'rgba(64,217,143,0.75)' : 'rgba(246,113,113,0.75)',
    },
  ];

  const lines: StrategyFigureLine[] = [
    {
      id: `${signal.zone.id}-level`,
      kind: 'mslzones_level',
      points: [
        { timestamp: signal.zone.startTimestamp, value: signal.zone.level },
        { timestamp: entryTimestamp, value: signal.zone.level },
      ],
      color,
      width: 2,
      style: 'dashed',
    },
    {
      id: `${signal.zone.id}-target`,
      kind: 'mslzones_target',
      points: [
        { timestamp: signal.zone.startTimestamp, value: takeProfitPrice },
        { timestamp: entryTimestamp, value: takeProfitPrice },
      ],
      color: '#22c55e',
      width: 1,
      style: 'dashed',
    },
    {
      id: `${signal.zone.id}-stop`,
      kind: 'mslzones_stop',
      points: [
        { timestamp: signal.zone.startTimestamp, value: stopLossPrice },
        { timestamp: entryTimestamp, value: stopLossPrice },
      ],
      color: '#ef4444',
      width: 1,
      style: 'dashed',
    },
  ];

  const points: StrategyFigurePoints[] = [
    {
      id: `${signal.zone.id}-origin`,
      kind: 'mslzones_origin',
      points: [
        { timestamp: signal.zone.startTimestamp, value: signal.zone.mid },
      ],
      color,
      radius: 4,
    },
    {
      id: `${signal.zone.id}-entry`,
      kind: 'mslzones_entry',
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color,
      radius: 5,
    },
  ];

  return { zones: figureZones, lines, points };
};
