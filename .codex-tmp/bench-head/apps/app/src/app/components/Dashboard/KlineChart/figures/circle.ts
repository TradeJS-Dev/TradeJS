import { Figure } from '@tradejs/types';

export const circle = ({ ctx, x, y, width, height, color }: Figure) => {
  const radius = Math.min(width, height) / 2;
  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius, 0, 2 * Math.PI);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'white';
  ctx.stroke();
};
