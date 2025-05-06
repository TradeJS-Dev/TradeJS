import { registerFigure } from 'klinecharts';
import { FigureAttrs, FigureStyles } from '@types';
import { checkEventOn } from '../utils/checkEventOn';

registerFigure({
  name: 'custom-diamond',
  draw: (ctx, attrs, styles) => {
    const { x, y, width, height } = attrs as FigureAttrs;
    const { color } = styles as FigureStyles;
    ctx.beginPath();
    ctx.moveTo(x - width / 2, y);
    ctx.lineTo(x, y - height / 2);
    ctx.lineTo(x + width / 2, y);
    ctx.lineTo(x, y + height / 2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  },
  checkEventOn,
});
