interface FigureParams {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export const square = ({ ctx, x, y, width, height, color }: FigureParams) => {
  const size = Math.min(width, height);
  const half = size / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x - half, y - half, size, size);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.closePath();
  ctx.restore();
};
