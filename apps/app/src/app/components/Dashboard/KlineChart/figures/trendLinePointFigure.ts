import { TrendLine } from '@types';

type Coordinate = { x: number; y: number };

type OverlayWithExtendData<T> = {
  extendData?: T;
};

type CreatePointFiguresParams<T> = {
  coordinates: Coordinate[];
  overlay: OverlayWithExtendData<T>;
};

type TrendLineExtendData = {
  mode: TrendLine['mode'];
};

export const createTrendLinePointFigure = ({
  coordinates,
  overlay,
}: CreatePointFiguresParams<TrendLineExtendData>) => {
  const { mode } = (overlay.extendData || {
    mode: 'lows',
  }) as TrendLineExtendData;
  const figures: any[] = [];
  const color = mode === 'lows' ? '#facc15' : '#fb923c';

  if (coordinates.length === 2) {
    figures.push({
      type: 'line',
      attrs: { coordinates: [coordinates[0], coordinates[1]] },
      styles: { color, size: 2, style: 'solid' },
    });
  }

  return figures;
};
