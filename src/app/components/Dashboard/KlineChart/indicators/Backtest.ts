'use client';

import _ from 'lodash';
import { registerOverlay, Chart } from 'klinecharts';
import { backtest } from '@src/actions/backtest';

const addOverlay = (name: string, figure: string, color: string) => {
  registerOverlay({
    name,
    totalStep: 2,
    createPointFigures: ({ coordinates, bounding }) => {
      return coordinates.map(({ x, y }) => ({
        type: figure,
        attrs: {
          x,
          y,
          width: 10,
          height: 10,
        },
        styles: { color },
      }));
    },
  });
};

registerOverlay({
  name: 'backtestOverlay-sell',
  totalStep: 2,
  createPointFigures: ({ coordinates, ...rest }) => {
    console.log('>>> coordinates', rest);
    return coordinates.map(({ x, y }) => ({
      type: 'diamond',
      attrs: {
        x,
        y,
        width: 10,
        height: 10,
      },
      styles: { color: '#00FF00' },
    }));
  },
});

registerOverlay({
  name: 'backtestOverlay-buy',
  totalStep: 2,
  createPointFigures: ({ coordinates }) => {
    return coordinates.map(({ x, y }) => ({
      type: 'diamond',
      attrs: {
        x,
        y,
        width: 10,
        height: 10,
      },
      styles: { color: '#00FF00' },
    }));
  },
});

export const Backtest = async (
  chartInstance: Chart,
  symbol: string,
  id = '1',
) => {
  const backtestData = await backtest(id, symbol);
  if (_.isEmpty(backtestData)) return;

  const pointsBuy = backtestData
    .filter(({ type }) =>
      [
        'OPEN_LONG',
        'CLOSE_SHORT',
        'TAKE_PROFIT_SHORT',
        'STOP_LOSS_SHORT',
      ].includes(type),
    )
    .map(({ timestamp, price }, dataIndex) => ({
      dataIndex,
      timestamp,
      value: price,
    }));

  const pointsSell = backtestData
    .filter(({ type }) =>
      [
        'OPEN_SHORT',
        'CLOSE_LONG',
        'TAKE_PROFIT_LONG',
        'STOP_LOSS_LONG',
      ].includes(type),
    )
    .map(({ timestamp, price }, dataIndex) => ({
      dataIndex,
      timestamp,
      value: price,
    }));

  chartInstance.createOverlay({
    name: 'backtestOverlay-buy',
    points: pointsBuy,
  });

  chartInstance.createOverlay({
    name: 'backtestOverlay-sell',
    points: pointsSell,
  });
};
