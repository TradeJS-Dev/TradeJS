'use client';

import _ from 'lodash';
import { registerFigure, registerOverlay, Chart } from 'klinecharts';
import { backtest } from '@src/actions/backtest';

registerFigure({
  name: 'diamond',
  draw: (ctx, attrs, styles) => {
    const { x, y, width, height } = attrs;
    const { color } = styles;
    ctx.beginPath();
    ctx.moveTo(x - width / 2, y);
    ctx.lineTo(x, y - height / 2);
    ctx.lineTo(x + width / 2, y);
    ctx.lineTo(x, y + height / 2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  },
  checkEventOn: (coordinate, attrs) => {
    const { x, y } = coordinate;
    const { width, height } = attrs;
    return Math.abs(x * height) + Math.abs(y * width) <= (width * height) / 2;
  },
});

registerOverlay({
  name: 'backtestOverlay-sell',
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
      styles: { color: '#FF0000' },
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

  const pointsSell = backtestData.filter(({ type }) => type === 'SELL') .map(({ timestamp, price }, dataIndex) => ({
    dataIndex,
    timestamp,
    value: price,
  }));

  chartInstance.createOverlay({
    name: 'backtestOverlay-sell',
    points: pointsSell
  });

  const pointsBuy = backtestData.filter(({ type }) => type === 'BUY') .map(({ timestamp, price }, dataIndex) => ({
    dataIndex,
    timestamp,
    value: price,
  }));

  chartInstance.createOverlay({
    name: 'backtestOverlay-buy',
    points: pointsBuy
  });
};
