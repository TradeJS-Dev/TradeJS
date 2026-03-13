import { Figure } from '@tradejs/types';

export const diamond = ({
  ctx,
  x,
  y,
  width: baseWidth,
  height: baseHeight,
  color,
}: Figure) => {
  const width = baseWidth * 1.5;
  const height = baseHeight * 1.5;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, y);
  ctx.lineTo(x, y - height / 2);
  ctx.lineTo(x + width / 2, y);
  ctx.lineTo(x, y + height / 2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'white';
  ctx.stroke();
};
