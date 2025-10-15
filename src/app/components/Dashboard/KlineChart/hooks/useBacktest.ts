'use client';

import { useEffect, useState, useRef } from 'react';
import _ from 'lodash';
import { registerIndicator, Chart } from 'klinecharts';
import { getOrderLog } from '@actions/backtest';
import { KlineChartItem, OrderLogData } from '@types';
import { diamond, star, circle, rectangle } from '../figures';
import { useBacktest as useBacktestStore } from '@store';

const green = '#84cc16';
const red = '#dc2626';
const darkRed = '#7f1d1d';
const darkGreen = '#365314';

interface Legend {
  title: string;
  value: {
    text: string;
    color: string;
  };
}

export const useBacktest = (chart: Chart | null, id: string | undefined) => {
  const [registered, setRegistered] = useState(false);
  const { backtest } = useBacktestStore(id);
  const enabled = Boolean(id);

  const getDataFromInterval = (
    result: unknown[],
    startCandleIndex: number,
    endCandleIndex: number,
  ) => {
    const start = (result[startCandleIndex] as KlineChartItem)?.timestamp;
    const end = (result[endCandleIndex] as KlineChartItem)?.timestamp;

    if (!start || !end) {
      return;
    }

    const data = backtest.filter(
      (log) => log.timestamp > start && log.timestamp <= end,
    );

    return data;
  };

  useEffect(() => {
    if (!chart || _.isEmpty(backtest)) {
      return;
    }

    registerIndicator({
      name: 'Backtest',
      shortName: 'Backtest',

      createTooltipDataSource: ({ indicator, crosshair }) => {
        const legends = new Array<Legend>();

        const getLegends = () => {
          const result = indicator.result;
          const candleIndex = crosshair.dataIndex!;

          const data = getDataFromInterval(
            result,
            candleIndex - 1,
            candleIndex,
          );

          if (!data) {
            return;
          }

          data.forEach(({ type, profit, index }) => {
            legends.push({
              title: `${index}:type: `,
              value: { text: type, color: 'white' },
            });
            legends.push({
              title: `${index}:profit: `,
              value: {
                text: profit.toFixed(2),
                color: profit >= 0 ? green : red,
              },
            });
          });
        };

        getLegends();

        return {
          name: 'Backtest',
          calcParamsText: '',
          features: [],
          legends,
        };
      },

      draw: ({ ctx, indicator, xAxis, yAxis }) => {
        const { realFrom, realTo } = chart.getVisibleRange();
        const { result } = indicator;

        for (
          let candleIndex = realFrom + 1;
          candleIndex < realTo;
          candleIndex++
        ) {
          const data = getDataFromInterval(
            result,
            candleIndex - 1,
            candleIndex,
          );

          if (!data) {
            continue;
          }

          data.forEach(({ type, price }) => {
            const x = xAxis.convertToPixel(candleIndex);
            const y = yAxis.convertToPixel(price);
            const width = 10;
            const height = 10;

            if (type === 'OPEN_LONG') {
              rectangle({ ctx, x, y, width, height, color: green });
            }
            if (type === 'TAKE_PROFIT_LONG') {
              star({
                ctx,
                x,
                y,
                width,
                height,
                color: red,
              });
            }
            if (type === 'CLOSE_LONG') {
              diamond({
                ctx,
                x,
                y,
                width,
                height,
                color: darkRed,
              });
            }
            if (type === 'STOP_LOSS_LONG') {
              circle({ ctx, x, y, width, height, color: darkRed });
            }
            if (type === 'OPEN_SHORT') {
              rectangle({ ctx, x, y, width, height, color: red });
            }
            if (type === 'TAKE_PROFIT_SHORT') {
              star({
                ctx,
                x,
                y,
                width,
                height,
                color: green,
              });
            }
            if (type === 'CLOSE_SHORT') {
              diamond({
                ctx,
                x,
                y,
                width,
                height,
                color: darkGreen,
              });
            }
            if (type === 'STOP_LOSS_SHORT') {
              circle({ ctx, x, y, width, height, color: darkGreen });
            }
          });
        }

        return true;
      },

      calc: (kLineDataList) => kLineDataList,
    });

    registerIndicator({
      name: 'Profit',
      shortName: 'Profit',
      calcParams: ['profit'],
      figures: [
        {
          key: `profit`,
          title: `Profit: `,
          type: 'line',
        },
      ],

      // Calculation results
      calc: (kLineDataList) => {
        return kLineDataList.map((_, candleIndex) => {
          if (candleIndex < 1) {
            return undefined;
          }

          const data = getDataFromInterval(kLineDataList, 0, candleIndex);

          if (!data || data.length < 1) {
            return undefined;
          }

          const item = data.pop();

          return {
            profit: item?.amount,
          };
        });
      },
    });

    setRegistered(true);
  }, [chart, backtest]);

  useEffect(() => {
    if (!chart || !enabled || !registered) {
      return () => null;
    }

    chart.createIndicator('Backtest', true, { id: 'candle_pane' });
    chart.createIndicator('Profit');

    return () => {
      chart.removeIndicator({ name: 'Backtest' });
      chart.removeIndicator({ name: 'Profit' });
    };
  }, [chart, enabled, registered]);
};
