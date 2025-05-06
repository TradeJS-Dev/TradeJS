import { registerFigure } from 'klinecharts';
import { FigureAttrs, FigureStyles } from '@types';
import { checkEventOn } from '../utils/checkEventOn';

registerFigure({
  name: 'custom-rectangle',
  draw: (ctx, attrs, styles) => {
    const { x, y, width, height } = attrs as FigureAttrs;
    const { color } = styles as FigureStyles;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  },
  checkEventOn,
});
