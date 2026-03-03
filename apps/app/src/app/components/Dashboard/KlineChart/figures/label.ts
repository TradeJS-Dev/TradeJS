import { Figure } from '@types';

export const label = ({ ctx, x, y, text = '', color }: Figure) => {
  ctx.save();

  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = color;
  ctx.fillText(text, x + 6, y);

  ctx.restore();
};
