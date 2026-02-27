type Coordinate = { x: number; y: number };

type OverlayWithExtendData<T> = {
  extendData?: T;
};

type CreatePointFiguresParams<T> = {
  coordinates: Coordinate[];
  overlay: OverlayWithExtendData<T>;
};

export type TradeZoneMode = 'TP' | 'SL';

type TradeZoneExtendData = {
  mode: TradeZoneMode;
};

export const createTradeZonePointFigure = ({
  coordinates,
  overlay,
}: CreatePointFiguresParams<TradeZoneExtendData>) => {
  const { mode } = (overlay.extendData || {
    mode: 'TP',
  }) as TradeZoneExtendData;
  const color = mode === 'TP' ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)';
  const borderColor =
    mode === 'TP' ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)';

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
