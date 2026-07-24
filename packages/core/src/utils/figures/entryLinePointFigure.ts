import { EntryLineExtendData } from './backtestFigureTypes';

type Coordinate = { x: number; y: number };

type CreatePointFiguresParams = {
  coordinates: Coordinate[];
  overlay: { extendData?: EntryLineExtendData };
};

export const createEntryLinePointFigure = ({
  coordinates,
  overlay,
}: CreatePointFiguresParams) => {
  const line = overlay.extendData?.line;
  const color = line?.color ?? '#facc15';
  const size = Number(line?.width ?? 2);
  const style = line?.style ?? 'solid';

  if (coordinates.length < 2) {
    return [];
  }

  return [
    {
      type: 'line',
      attrs: {
        coordinates,
      },
      styles: { color, size, style },
    },
  ];
};
