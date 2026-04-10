interface FigureParams {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export const triangle = ({ ctx, x, y, width, height, color }: FigureParams) => {
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y - halfHeight);
  ctx.lineTo(x - halfWidth, y + halfHeight);
  ctx.lineTo(x + halfWidth, y + halfHeight);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
};
