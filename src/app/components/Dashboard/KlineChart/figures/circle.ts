import { registerFigure } from 'klinecharts';
import { FigureAttrs, FigureStyles } from '@types';
import { checkEventOn } from '../utils/checkEventOn';

registerFigure({
  name: 'custom-circle',
  draw: (ctx, attrs, styles) => {
    const { x, y, width, height } = attrs as FigureAttrs;
    const { color } = styles as FigureStyles;

    const radius = Math.min(width, height) / 2;
    ctx.beginPath();
    ctx.arc(x + radius, y + radius, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  },
  checkEventOn,
});
