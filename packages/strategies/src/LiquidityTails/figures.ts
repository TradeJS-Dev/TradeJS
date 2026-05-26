import {
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoints,
  StrategyFigureZone,
} from '@tradejs/types';
import { LiquidityTailsSignal, LiquidityTailsZone } from './engine';

export const buildLiquidityTailsFigures = ({
  signal,
  zones,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  maxZones,
}: {
  signal: LiquidityTailsSignal;
  zones: LiquidityTailsZone[];
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  maxZones: number;
}): StrategyEntryModelFigures => {
  const isLong = signal.direction === 'LONG';
  const color = isLong ? '#22c55e' : '#ef4444';
  const zoneColor = isLong ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';
  const borderColor = isLong ? 'rgba(34,197,94,0.65)' : 'rgba(239,68,68,0.65)';
  const activeZones = zones
    .filter((zone) => !zone.spent)
    .slice(Math.max(0, zones.length - Math.max(1, maxZones)));

  const figureZones: StrategyFigureZone[] = [
    ...activeZones.map((zone) => ({
      id: zone.id,
      kind: `msltails_${zone.kind}`,
      start: { timestamp: zone.birthTimestamp, value: zone.top },
      end: { timestamp: entryTimestamp, value: zone.bottom },
      color:
        zone.kind === 'buy_pressure'
          ? 'rgba(34,197,94,0.1)'
          : 'rgba(239,68,68,0.1)',
      borderColor:
        zone.kind === 'buy_pressure'
          ? 'rgba(34,197,94,0.35)'
          : 'rgba(239,68,68,0.35)',
    })),
    {
      id: `${signal.zone.id}-entry-zone`,
      kind: `msltails_${signal.zone.kind}_entry_zone`,
      start: { timestamp: signal.zone.birthTimestamp, value: signal.zone.top },
      end: { timestamp: entryTimestamp, value: signal.zone.bottom },
      color: zoneColor,
      borderColor,
    },
  ];

  const lines: StrategyFigureLine[] = [
    {
      id: `${signal.zone.id}-mid`,
      kind: 'msltails_zone_mid',
      points: [
        { timestamp: signal.zone.birthTimestamp, value: signal.zone.mid },
        { timestamp: entryTimestamp, value: signal.zone.mid },
      ],
      color,
      width: 1,
      style: 'dashed',
    },
    {
      id: `${signal.zone.id}-target`,
      kind: 'msltails_target',
      points: [
        { timestamp: signal.zone.birthTimestamp, value: takeProfitPrice },
        { timestamp: entryTimestamp, value: takeProfitPrice },
      ],
      color: '#22c55e',
      width: 1,
      style: 'dashed',
    },
    {
      id: `${signal.zone.id}-stop`,
      kind: 'msltails_stop',
      points: [
        { timestamp: signal.zone.birthTimestamp, value: stopLossPrice },
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
      kind: 'msltails_origin',
      points: [
        { timestamp: signal.zone.birthTimestamp, value: signal.zone.mid },
      ],
      color,
      radius: 4,
    },
    {
      id: `${signal.zone.id}-entry`,
      kind: 'msltails_entry',
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color,
      radius: 5,
    },
  ];

  return { zones: figureZones, lines, points };
};
