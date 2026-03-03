import { EntryZoneExtendData } from './backtestFigureTypes';

type Coordinate = { x: number; y: number };

type CreatePointFiguresParams = {
  coordinates: Coordinate[];
  overlay: { extendData?: EntryZoneExtendData };
};

export const createEntryZonePointFigure = ({
  coordinates,
  overlay,
}: CreatePointFiguresParams) => {
  const zone = overlay.extendData?.zone;
  const color = zone?.color ?? 'rgba(147,197,253,0.2)';
  const borderColor = zone?.borderColor ?? 'rgba(59,130,246,0.6)';

  if (coordinates.length < 2) return [];

  const [p1, p2] = coordinates;
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);

  return [
    {
      type: 'rect',
      attrs: { x, y, width, height },
      styles: { color, borderColor, size: 1 },
    },
  ];
};
