'use client';

import _ from 'lodash';
import { registerIndicator, Chart } from 'klinecharts';
import { backtest } from '@src/actions/backtest';
import { KlineChartItem } from '@types';
import { dimond, star, circle, rectangle } from '../figures';

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

export const Backtest = async (chart: Chart, symbol: string, id = '1') => {
  const backtestData = await backtest(id, symbol);
  if (_.isEmpty(backtestData)) {
    return;
  }

  registerIndicator({
    name: 'Backtest',
    shortName: 'Backtest',

    createTooltipDataSource: ({ indicator, crosshair }) => {
      const legends = new Array<Legend>();

      const getLegents = () => {
        const result = indicator.result;
        const i = crosshair.dataIndex!;
        const start = (result[i - 1] as KlineChartItem)?.timestamp;
        const end = (result[i] as KlineChartItem)?.timestamp;

        if (!start || !end) {
          return;
        }

        const data = backtestData.filter(
          (log) => log.timestamp > start && log.timestamp <= end,
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

      getLegents();

      return {
        name: 'BackTest',
        calcParamsText: '',
        features: [],
        legends,
      };
    },

    draw: ({ ctx, indicator, xAxis, yAxis }) => {
      const { realFrom, realTo } = chart.getVisibleRange();
      const { result } = indicator;

      for (let i = realFrom + 1; i < realTo; i++) {
        const start = (result[i - 1] as KlineChartItem)?.timestamp;
        const end = (result[i] as KlineChartItem)?.timestamp;

        if (!start || !end) {
          continue;
        }

        const data = backtestData.filter(
          (log) => log.timestamp > start && log.timestamp <= end,
        );

        if (!data) {
          continue;
        }

        data.forEach(({ type, price }) => {
          const x = xAxis.convertToPixel(i);
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
            dimond({
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
            dimond({
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

  chart.createIndicator('Backtest', true, { id: 'candle_pane' });
};
