'use client';

import { useEffect, useState } from 'react';
import _ from 'lodash';
import { registerOverlay, registerIndicator, Chart } from 'klinecharts';
import { KlineChartItem, OrderLogData } from '@types';
import { useBacktest as useBacktestStore } from '@store';
import '../figures';

const green = '#84cc16';
const red = '#dc2626';
const darkRed = '#7f1d1d';
const darkGreen = '#365314';
const orange = '#fb923c';

type MarkerShape = 'RECT' | 'DIAMOND' | 'STAR' | 'CIRCLE';

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
} => {
  const events = [...rawEvents].sort((a, b) => a.timestamp - b.timestamp);

  const markersFlat: MarkerMeta[] = [];
  const markersByTs: Record<number, MarkerMeta[]> = {};
  const profitByIndex: Array<number | undefined> = new Array(
    candles.length,
  ).fill(undefined);

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

  return { markersFlat, markersByTs, profitByIndex };
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
): Record<number, { profit?: number; markers: MarkerMeta[] }> => {
  const result: Record<number, { profit?: number; markers: MarkerMeta[] }> = {};

  for (let i = 0; i < candles.length; i++) {
    const ts = candles[i].timestamp;
    result[ts] = {
      profit: profitByIndex[i],
      markers: markersByTs[ts] ?? [],
    };
  }

  return result;
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
  latestByTs: Record<number, { profit?: number; markers: MarkerMeta[] }> = {},
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
  const [key, setKey] = useState('BTCUSDT_15');
  const enabled = Boolean(id);

  useEffect(() => {
    if (!chart) {
      return;
    }

    const currentSymbol = chart.getSymbol()?.ticker;
    const currenInterval = chart.getPeriod()?.span;

    setKey(`${currentSymbol}_${currenInterval}`);
  }, [chart])

  useEffect(() => {
    if (!chart || !enabled || _.isEmpty(backtest)) {
      return;
    }

    const candles = chart.getDataList() as KlineChartItem[];
    if (!candles || candles.length === 0) {
      return;
    }

    const { markersFlat, markersByTs, profitByIndex } = walkCandlesAndEvents(
      candles,
      backtest,
    );

    const { points, groupedExtendData } = groupMarkersForOverlay(markersFlat);

    if (points.length > 0) {
      chart.createOverlay({
        name: 'backtestMarkers',
        points,
        extendData: groupedExtendData,
      });
    }

    const latestByTs = buildIndicatorData(candles, markersByTs, profitByIndex);

    createBacktestProfit(chart, latestByTs);

    return () => {
      chart.removeOverlay({ name: 'backtestMarkers' });
      chart.removeIndicator({ name: 'BacktestProfit' });
    };
  }, [chart, enabled, backtest, id, key]);

  return null;
};
