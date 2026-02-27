'use client';

import { useEffect } from 'react';
import _ from 'lodash';
import { registerOverlay, registerIndicator, Chart } from 'klinecharts';
import { KlineChartItem, OrderLogData, Signal, TrendLine } from '@types';
import { useBacktest as useBacktestStore } from '@store';
import {
  TradeZoneMode,
  createTradeZonePointFigure,
} from '../figures/tradeZonePointFigure';
import { createTrendLinePointFigure } from '../figures/trendLinePointFigure';
import { createTrendLinePointsPointFigure } from '../figures/trendLinePointsPointFigure';
import '../figures';

const green = '#84cc16';
const red = '#dc2626';
const darkRed = '#7f1d1d';
const darkGreen = '#365314';
const orange = '#fb923c';
const grayTransparent = 'rgba(156,163,175,0.45)';
const greenTransparent = 'rgba(132,204,22,0.45)';
const redTransparent = 'rgba(220,38,38,0.45)';

type MarkerShape = 'RECT' | 'DIAMOND' | 'STAR' | 'CIRCLE';
type ChartPoint = { timestamp: number; value: number };

interface MarkerMeta {
  shape: MarkerShape;
  color: string;
  timestamp: number;
  value: number;
  type: string;
  profit: number;
  amount: number;
  tradeIndex: number;
}

interface AlignedOrderEvent {
  event: OrderLogData[number];
  alignedTimestamp: number;
}

interface TradeZone {
  id: string;
  start: ChartPoint;
  tpEnd: ChartPoint;
  slEnd: ChartPoint;
}

const resolveShapeAndColor = (
  eventType: string,
): {
  shape: MarkerShape;
  color: string;
} => {
  switch (eventType) {
    case 'OPEN_LONG':
      return { shape: 'RECT', color: green };
    case 'TAKE_PROFIT_LONG':
      return { shape: 'STAR', color: red };
    case 'CLOSE_LONG':
      return { shape: 'DIAMOND', color: darkRed };
    case 'STOP_LOSS_LONG':
      return { shape: 'CIRCLE', color: darkRed };

    case 'OPEN_SHORT':
      return { shape: 'RECT', color: red };
    case 'TAKE_PROFIT_SHORT':
      return { shape: 'STAR', color: green };
    case 'CLOSE_SHORT':
      return { shape: 'DIAMOND', color: darkRed };
    case 'STOP_LOSS_SHORT':
      return { shape: 'CIRCLE', color: darkGreen };

    default:
      return { shape: 'CIRCLE', color: '#ffffff' };
  }
};

const walkCandlesAndEvents = (
  candles: KlineChartItem[],
  rawEvents: OrderLogData,
): {
  markersFlat: MarkerMeta[];
  markersByTs: Record<number, MarkerMeta[]>;
  profitByIndex: Array<number | undefined>;
  alignedEvents: AlignedOrderEvent[];
} => {
  const events = [...rawEvents].sort((a, b) => a.timestamp - b.timestamp);

  const markersFlat: MarkerMeta[] = [];
  const markersByTs: Record<number, MarkerMeta[]> = {};
  const profitByIndex: Array<number | undefined> = new Array(
    candles.length,
  ).fill(undefined);
  const alignedEvents: AlignedOrderEvent[] = [];

  let eventCursor = 0;
  let currentAmount: number | undefined = undefined;

  for (let candleIndex = 0; candleIndex < candles.length; candleIndex++) {
    const candle = candles[candleIndex];
    const currTs = candle.timestamp;
    const prevTs =
      candleIndex > 0 ? candles[candleIndex - 1].timestamp : -Infinity;

    for (; eventCursor < events.length; eventCursor++) {
      const evt = events[eventCursor];

      if (evt.timestamp > currTs) {
        break;
      }

      if (evt.timestamp > prevTs && evt.timestamp <= currTs) {
        const { shape, color } = resolveShapeAndColor(evt.type);

        const marker: MarkerMeta = {
          shape,
          color,
          timestamp: currTs,
          value: evt.price,
          type: evt.type,
          profit: evt.profit,
          amount: evt.amount,
          tradeIndex: evt.index,
        };

        markersFlat.push(marker);

        if (!markersByTs[currTs]) {
          markersByTs[currTs] = [];
        }
        markersByTs[currTs].push(marker);
        alignedEvents.push({ event: evt, alignedTimestamp: currTs });

        currentAmount = evt.amount;
        continue;
      }

      if (evt.timestamp <= prevTs) {
        currentAmount = evt.amount;
        continue;
      }
    }

    profitByIndex[candleIndex] = currentAmount;
  }

  return { markersFlat, markersByTs, profitByIndex, alignedEvents };
};

const groupMarkersForOverlay = (
  markers: MarkerMeta[],
): {
  points: Array<{ timestamp: number; value: number }>;
  groupedExtendData: MarkerMeta[][];
} => {
  const byKey: Record<
    string,
    { timestamp: number; value: number; items: MarkerMeta[] }
  > = {};

  for (const marker of markers) {
    const key = `${marker.timestamp}__${marker.value}`;
    if (!byKey[key]) {
      byKey[key] = {
        timestamp: marker.timestamp,
        value: marker.value,
        items: [],
      };
    }
    byKey[key].items.push(marker);
  }

  const points: Array<{ timestamp: number; value: number }> = [];
  const groupedExtendData: MarkerMeta[][] = [];

  for (const { timestamp, value, items } of Object.values(byKey)) {
    points.push({ timestamp, value });
    groupedExtendData.push(items);
  }

  return { points, groupedExtendData };
};

const buildIndicatorData = (
  candles: KlineChartItem[],
  markersByTs: Record<number, MarkerMeta[]>,
  profitByIndex: Array<number | undefined>,
): Record<
  number,
  {
    profit?: number;
    startAmount?: number;
    endAmount?: number;
    maxAmount?: number;
    minAmount?: number;
    markers: MarkerMeta[];
  }
> => {
  const result: Record<
    number,
    {
      profit?: number;
      startAmount?: number;
      endAmount?: number;
      maxAmount?: number;
      minAmount?: number;
      markers: MarkerMeta[];
    }
  > = {};
  const amounts = profitByIndex.filter((value): value is number =>
    Number.isFinite(value),
  );
  const startAmount = amounts[0];
  const endAmount =
    amounts.length > 0 ? amounts[amounts.length - 1] : undefined;
  const maxAmount = amounts.length > 0 ? Math.max(...amounts) : undefined;
  const minAmount = amounts.length > 0 ? Math.min(...amounts) : undefined;

  for (let i = 0; i < candles.length; i++) {
    const ts = candles[i].timestamp;
    result[ts] = {
      profit: profitByIndex[i],
      startAmount,
      endAmount,
      maxAmount,
      minAmount,
      markers: markersByTs[ts] ?? [],
    };
  }

  return result;
};

let trendLineOverlaysRegistered = false;
let backtestTradeZonesRegistered = false;

const ensureBacktestTradeZonesRegistered = () => {
  if (backtestTradeZonesRegistered) return;

  registerOverlay({
    name: 'BacktestTradeZone',
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: createTradeZonePointFigure,
  });

  backtestTradeZonesRegistered = true;
};

const ensureTrendLineOverlaysRegistered = () => {
  if (trendLineOverlaysRegistered) return;

  registerOverlay({
    name: 'TrendLine',
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: createTrendLinePointFigure,
  });

  registerOverlay({
    name: 'TrendLinePoints',
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: createTrendLinePointsPointFigure,
  });

  trendLineOverlaysRegistered = true;
};

const collectTrendLinesFromOrderLog = (
  events: OrderLogData,
): Array<{ trendLine: TrendLine; signalId?: string; index: number }> => {
  const result: Array<{
    trendLine: TrendLine;
    signalId?: string;
    index: number;
  }> = [];
  const seenSignalIds = new Set<string>();

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!event.type?.startsWith('OPEN_')) continue;
    const signal = event.signal as Signal | undefined;
    if (!signal) continue;

    const trendLine = signal?.figures?.trendLine;

    if (!trendLine || !trendLine.points || trendLine.points.length < 2) {
      continue;
    }

    const signalId = signal?.signalId;

    if (signalId) {
      if (seenSignalIds.has(signalId)) continue;
      seenSignalIds.add(signalId);
    }

    result.push({ trendLine, signalId, index });
  }

  return result;
};

const buildBacktestTradeZones = (
  alignedEvents: AlignedOrderEvent[],
): TradeZone[] => {
  const trades = new Map<
    string,
    { open?: AlignedOrderEvent; lastClose?: AlignedOrderEvent }
  >();

  for (const aligned of alignedEvents) {
    const signalId = aligned.event.signal?.signalId;
    if (!signalId) continue;

    const current = trades.get(signalId) ?? {};
    const isOpen = aligned.event.type.startsWith('OPEN_');

    if (isOpen) {
      current.open = aligned;
    } else {
      current.lastClose = aligned;
    }

    trades.set(signalId, current);
  }

  const zones: TradeZone[] = [];

  for (const [signalId, trade] of trades.entries()) {
    const open = trade.open;
    const close = trade.lastClose;
    if (!open || !close) continue;

    const prices = open.event.signal?.prices;
    if (!prices) continue;

    zones.push({
      id: signalId,
      start: {
        timestamp: open.alignedTimestamp,
        value: open.event.price,
      },
      tpEnd: {
        timestamp: close.alignedTimestamp,
        value: prices.takeProfitPrice,
      },
      slEnd: {
        timestamp: close.alignedTimestamp,
        value: prices.stopLossPrice,
      },
    });
  }

  return zones;
};

registerOverlay({
  name: 'backtestMarkers',
  totalStep: 1,
  createPointFigures: ({ coordinates, overlay }) => {
    const markerGroups = (overlay.extendData as MarkerMeta[][]) ?? [];
    const figures: any[] = [];

    for (let coordIndex = 0; coordIndex < coordinates.length; coordIndex++) {
      const coord = coordinates[coordIndex];
      const group = markerGroups[coordIndex];
      if (!coord || !group) continue;

      group.forEach((meta, localIdx) => {
        const { shape, color, type, profit } = meta;

        const baseX = coord.x;
        const baseY = coord.y - localIdx * 14;

        const width = 10;
        const height = 10;

        let figureType: string;
        switch (shape) {
          case 'RECT':
            figureType = 'btRect';
            break;
          case 'DIAMOND':
            figureType = 'btDiamond';
            break;
          case 'STAR':
            figureType = 'btStar';
            break;
          case 'CIRCLE':
          default:
            figureType = 'btCircle';
            break;
        }

        figures.push({
          type: figureType,
          attrs: { x: baseX, y: baseY, width, height, color },
        });

        const labelText = `${type} ${profit.toFixed(2)}`;
        figures.push({
          type: 'btLabel',
          attrs: {
            x: baseX + 8,
            y: baseY,
            text: labelText,
            color: profit >= 0 ? green : red,
          },
        });
      });
    }

    return figures;
  },
});

const createBacktestProfit = (
  chart: Chart,
  latestByTs: Record<
    number,
    {
      profit?: number;
      startAmount?: number;
      endAmount?: number;
      maxAmount?: number;
      minAmount?: number;
      markers: MarkerMeta[];
    }
  > = {},
) => {
  registerIndicator({
    name: 'BacktestProfit',
    shortName: 'Backtest',
    series: 'price',
    figures: [
      {
        key: 'profit',
        title: 'Profit',
        type: 'line',
      },
      {
        key: 'startAmount',
        title: 'Start: ',
        type: 'line',
        styles: () =>
          ({
            color: grayTransparent,
            size: 1,
            style: 'dashed',
            dashedValue: [4, 4],
          }) as any,
      },
      {
        key: 'endAmount',
        title: 'End: ',
        type: 'line',
        styles: () =>
          ({
            color: grayTransparent,
            size: 1,
            style: 'dashed',
            dashedValue: [4, 4],
          }) as any,
      },
      {
        key: 'maxAmount',
        title: 'Max: ',
        type: 'line',
        styles: () =>
          ({
            color: greenTransparent,
            size: 1,
            style: 'dashed',
            dashedValue: [4, 4],
          }) as any,
      },
      {
        key: 'minAmount',
        title: 'Min: ',
        type: 'line',
        styles: () =>
          ({
            color: redTransparent,
            size: 1,
            style: 'dashed',
            dashedValue: [4, 4],
          }) as any,
      },
    ],

    calc: () => latestByTs,

    createTooltipDataSource: ({ indicator, crosshair }) => {
      const result = indicator.result as typeof latestByTs;
      const ts = crosshair.kLineData?.timestamp;
      const bucket = ts ? result[ts] : undefined;

      const legends: Array<{
        title: string;
        value: { text: string; color: string };
      }> = [];

      if (bucket && bucket.profit !== undefined) {
        legends.push({
          title: 'amount: ',
          value: {
            text: bucket.profit.toFixed(2),
            color: orange,
          },
        });
      }

      if (bucket && bucket.markers.length > 0) {
        for (const meta of bucket.markers) {
          legends.push({
            title: `${meta.tradeIndex}:type: `,
            value: { text: meta.type, color: 'white' },
          });

          legends.push({
            title: `${meta.tradeIndex}:profit: `,
            value: {
              text: meta.profit.toFixed(2),
              color: meta.profit >= 0 ? green : red,
            },
          });
        }
      }

      return {
        name: 'Backtest',
        calcParamsText: '',
        features: [],
        legends,
      };
    },
  });

  chart.createIndicator('BacktestProfit', false);
};

export const useBacktest = (chart: Chart | null, id: string | undefined) => {
  const { backtest } = useBacktestStore(id);
  const enabled = Boolean(id);
  const candlesLength = chart?.getDataList()?.length || 0;

  useEffect(() => {
    if (!chart || !enabled || _.isEmpty(backtest)) {
      return;
    }

    const candles = chart.getDataList() as KlineChartItem[];
    if (!candles || candles.length === 0) {
      return;
    }

    const { markersFlat, markersByTs, profitByIndex, alignedEvents } =
      walkCandlesAndEvents(candles, backtest);

    const { points, groupedExtendData } = groupMarkersForOverlay(markersFlat);
    const tradeZones = buildBacktestTradeZones(alignedEvents);
    const trendLines = collectTrendLinesFromOrderLog(backtest);
    const trendLineOverlayIds: string[] = [];
    const tradeZoneOverlayIds: string[] = [];

    if (points.length > 0) {
      chart.createOverlay({
        name: 'backtestMarkers',
        points,
        extendData: groupedExtendData,
      });
    }

    if (tradeZones.length > 0) {
      ensureBacktestTradeZonesRegistered();

      for (const zone of tradeZones) {
        const tpId = `backtest-trade-zone-${zone.id}-tp`;
        const slId = `backtest-trade-zone-${zone.id}-sl`;
        tradeZoneOverlayIds.push(tpId, slId);

        chart.createOverlay({
          name: 'BacktestTradeZone',
          id: tpId,
          points: [zone.start, zone.tpEnd],
          zLevel: 2,
          extendData: { mode: 'TP' satisfies TradeZoneMode },
        });

        chart.createOverlay({
          name: 'BacktestTradeZone',
          id: slId,
          points: [zone.start, zone.slEnd],
          zLevel: 2,
          extendData: { mode: 'SL' satisfies TradeZoneMode },
        });
      }
    }

    if (trendLines.length > 0) {
      ensureTrendLineOverlaysRegistered();

      for (let index = 0; index < trendLines.length; index++) {
        const { trendLine, signalId, index: eventIndex } = trendLines[index];
        const overlayId = `backtest-trendline-${
          signalId ?? `idx-${eventIndex}`
        }-${trendLine.id}`;
        trendLineOverlayIds.push(overlayId);

        const pointsSorted = [...(trendLine.points || [])].sort(
          (left, right) => left.timestamp - right.timestamp,
        );
        const touchesSorted = [...(trendLine.touches || [])].sort(
          (left, right) => left.timestamp - right.timestamp,
        );

        if (pointsSorted.length < 2) {
          continue;
        }

        const linePoints = [
          pointsSorted[0],
          pointsSorted[pointsSorted.length - 1],
        ];

        const extendData = {
          mode: trendLine.mode,
        };

        chart.createOverlay({
          name: 'TrendLine',
          id: overlayId,
          points: linePoints,
          zLevel: 10,
          extendData,
        });

        chart.createOverlay({
          name: 'TrendLinePoints',
          id: `${overlayId}-points`,
          points: [...pointsSorted, ...touchesSorted],
          zLevel: 12,
        });
      }
    }

    const latestByTs = buildIndicatorData(candles, markersByTs, profitByIndex);

    createBacktestProfit(chart, latestByTs);

    return () => {
      chart.removeOverlay({ name: 'backtestMarkers' });
      chart.removeIndicator({ name: 'BacktestProfit' });
      if (trendLineOverlayIds.length > 0) {
        for (const overlayId of trendLineOverlayIds) {
          chart.removeOverlay({ name: 'TrendLine', id: overlayId });
          chart.removeOverlay({
            name: 'TrendLinePoints',
            id: `${overlayId}-points`,
          });
        }
      }
      if (tradeZoneOverlayIds.length > 0) {
        for (const overlayId of tradeZoneOverlayIds) {
          chart.removeOverlay({ name: 'BacktestTradeZone', id: overlayId });
        }
      }
    };
  }, [chart, enabled, backtest, id, candlesLength]);

  return null;
};
