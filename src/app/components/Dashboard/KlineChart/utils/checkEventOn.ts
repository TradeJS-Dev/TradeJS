import { FigureAttrs, FigureCoordinates } from '@types';

export const checkEventOn = (
  coordinate: FigureCoordinates,
  attrs: FigureAttrs,
) => {
  const { x, y } = coordinate;
  const { width, height } = attrs as FigureAttrs;
  return Math.abs(x * height) + Math.abs(y * width) <= (width * height) / 2;
};
