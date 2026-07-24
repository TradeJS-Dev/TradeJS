import { EntryAnnotationExtendData } from './backtestFigureTypes';

type Coordinate = { x: number; y: number };

type CreatePointFiguresParams = {
  coordinates: Coordinate[];
  overlay: { extendData?: EntryAnnotationExtendData };
};

const LINE_HEIGHT = 19;
const X_OFFSET = 10;
const Y_OFFSET = 12;

export const createEntryAnnotationPointFigure = ({
  coordinates,
  overlay,
}: CreatePointFiguresParams) => {
  const annotation = overlay.extendData?.annotation;
  const coordinate = coordinates[0];
  if (!annotation || !coordinate) return [];

  const textLines = [annotation.title, ...annotation.items].filter(
    (text) => text.trim().length > 0,
  );

  return textLines.map((text, index) => ({
    type: 'text',
    key: `entry_annotation_${index}`,
    attrs: {
      x: coordinate.x - X_OFFSET,
      y: coordinate.y + Y_OFFSET + index * LINE_HEIGHT,
      text,
      align: 'right',
      baseline: 'top',
    },
    styles: {
      style: 'fill',
      color:
        index === 0
          ? annotation.color ?? '#facc15'
          : annotation.textColor ?? '#f8fafc',
      size: index === 0 ? 12 : 11,
      weight: index === 0 ? 600 : 400,
      backgroundColor: annotation.backgroundColor ?? 'rgba(15,23,42,0.88)',
      borderColor: 'rgba(148,163,184,0.35)',
      borderSize: 1,
      borderRadius: 4,
      paddingLeft: 6,
      paddingRight: 6,
      paddingTop: 3,
      paddingBottom: 3,
    },
    ignoreEvent: true,
  }));
};
