import { EntryPointsExtendData } from './backtestFigureTypes';

type Coordinate = { x: number; y: number };

type CreatePointFiguresParams = {
  coordinates: Coordinate[];
  overlay: { extendData?: EntryPointsExtendData };
};

export const createEntryPointsPointFigure = ({
  coordinates,
  overlay,
}: CreatePointFiguresParams) => {
  const points = overlay.extendData?.points;
  const color = points?.color ?? '#ef4444';
  const r = Number(points?.radius ?? 4);

  const figures: any[] = [];

  coordinates.forEach(({ x, y }, index) => {
    figures.push({
      type: 'circle',
      key: `entry_pt_${index}`,
      attrs: { x, y, r },
      styles: {
        style: 'fill',
        color,
      },
      ignoreEvent: true,
    });
  });

  return figures;
};
