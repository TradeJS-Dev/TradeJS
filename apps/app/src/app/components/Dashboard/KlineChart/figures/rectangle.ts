import type { Figure } from '#app/types/ui';

export const rectangle = ({
  ctx,
  x: baseX,
  y: baseY,
  width,
  height,
  color,
}: Figure) => {
  const x = baseX - width / 2;
  const y = baseY - height / 2;

  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'white';
  ctx.strokeRect(x, y, width, height);
};
