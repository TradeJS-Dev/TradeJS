'use client';

import _ from 'lodash';
import { registerFigure, registerOverlay, Chart } from 'klinecharts';
import { backtest } from '@src/actions/backtest';

interface Attrs {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Styles {
  color: string;
}

registerFigure({
  name: 'diamond',
  draw: (ctx, attrs, styles) => {
    const { x, y, width, height } = attrs as Attrs;
    const { color } = styles as Styles;
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
    const { width, height } = attrs as Attrs;
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

  const pointsBuy = backtestData
    .filter(({ type }) => ['OPEN_LONG', 'CLOSE_SHORT', 'TAKE_PROFIT_SHORT', 'STOP_LOSS_SHORT'].includes(type))
    .map(({ timestamp, price }, dataIndex) => ({
      dataIndex,
      timestamp,
      value: price,
    }));

  const pointsSell = backtestData
    .filter(({ type }) => ['OPEN_SHORT', 'CLOSE_LONG', 'TAKE_PROFIT_LONG', 'STOP_LOSS_LONG'].includes(type))
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
