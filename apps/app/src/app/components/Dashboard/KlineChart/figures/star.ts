import { Figure } from '@types';

export const star = ({
  ctx,
  x: baseX,
  y: baseY,
  width: baseWidth,
  height: baseHeight,
  color,
}: Figure) => {
  const x = baseX - 10;
  const y = baseY - 10;
  const width = baseWidth + 10;
  const height = baseHeight + 10;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const outerRadius = Math.min(width, height) / 2;
  const innerRadius = outerRadius / 2.5;
  const points = 5;

  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI / points) * i;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const sx = cx + Math.cos(angle - Math.PI / 2) * radius;
    const sy = cy + Math.sin(angle - Math.PI / 2) * radius;
    if (i === 0) {
      ctx.moveTo(sx, sy);
    } else {
      ctx.lineTo(sx, sy);
    }
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'white';
  ctx.stroke();
};
