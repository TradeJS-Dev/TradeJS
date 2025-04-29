'use client';

import _ from 'lodash';
import { registerIndicator, Chart } from 'klinecharts';
import { backtest } from '@src/actions/backtest';

export const Backtest = async (chart: Chart, symbol: string, id = '1') => {
  const backtestData = await backtest(id, symbol);

  if (_.isEmpty(backtestData)) {
    return;
  }

  registerIndicator({
    name: 'Backtest',
    figures: [{ key: 'backtest' }],
    calc: (kLineDataList) => {
      return kLineDataList.map((kLineData, ind) => {
        const order = backtestData.find(
          (item) =>
            ind > 0 &&
            item.timestamp > kLineDataList[ind - 1].timestamp &&
            item.timestamp <= kLineData.timestamp,
        );

        if (!order) {
          return {};
        }

        console.log('calc', order);

        return {
          text: order.type === 'BUY' ? '🍏' : '🍎',
          backtest: order.price,
        };
      });
    },
    draw: ({ ctx, visibleRange, indicator, xAxis, yAxis }) => {
      const { from, to } = visibleRange;

      ctx.font = '14px' + ' Helvetica Neue';
      ctx.textAlign = 'center';
      const result = indicator.result;
      for (let i = from; i < to; i++) {
        const data = result[i];

        console.log('draw', data?.backtest);

        if (data?.backtest) {
          const x = xAxis.convertToPixel(i);
          const y = yAxis.convertToPixel(data.backtest);
          ctx.fillText(data.text, x, y);
        }
      }
      return false;
    },
  });

  chart.createIndicator('Backtest', true, { id: 'candle_pane' });
};
