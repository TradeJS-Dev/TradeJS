type Coordinate = { x: number; y: number };

type CreatePointFiguresParams = {
  coordinates: Coordinate[];
};

export const createTrendLinePointsPointFigure = ({
  coordinates,
}: CreatePointFiguresParams) => {
  const figures: any[] = [];

  coordinates.forEach(({ x, y }, i) => {
    figures.push({
      type: 'circle',
      key: `pt_${i}`,
      attrs: { x, y, r: 4 },
      styles: {
        style: 'fill',
        color: '#ef4444',
      },
      ignoreEvent: true,
    });
  });

  return figures;
};
