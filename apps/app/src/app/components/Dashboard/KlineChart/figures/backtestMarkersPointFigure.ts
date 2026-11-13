import type { OverlayFigure } from 'klinecharts';
import { MarkerMeta } from './backtestFigureTypes';

type Coordinate = { x: number; y: number };

type CreatePointFiguresParams = {
  coordinates: Coordinate[];
  overlay: { extendData?: { groups: MarkerMeta[][]; label?: string } };
};

const green = '#84cc16';
const red = '#dc2626';

export const createBacktestMarkersPointFigure = ({
  coordinates,
  overlay,
}: CreatePointFiguresParams) => {
  const markerGroups = overlay.extendData?.groups ?? [];
  const label = overlay.extendData?.label;
  const figures: OverlayFigure[] = [];

  for (let coordIndex = 0; coordIndex < coordinates.length; coordIndex++) {
    const coord = coordinates[coordIndex];
    const group = markerGroups[coordIndex];
    if (!coord || !group) continue;

    group.forEach((meta, localIdx) => {
      const { shape, color, type, profit } = meta;

      const baseX = coord.x;
      const baseY =
        label === 'B' ? coord.y + (localIdx + 1) * 14 : coord.y - localIdx * 14;
      const key = String(meta.tradeIndex);
      const ignoreEvent = ['onPressedMoveStart', 'onRightClick'] as const;

      const width = 10;
      const height = 10;

      let figureType: string;
      switch (shape) {
        case 'RECT':
          figureType = 'btRect';
          break;
        case 'SQUARE':
          figureType = 'btSquare';
          break;
        case 'DIAMOND':
          figureType = 'btDiamond';
          break;
        case 'TRIANGLE':
          figureType = 'btTriangle';
          break;
        case 'STAR':
          figureType = 'btStar';
          break;
        case 'CIRCLE':
        default:
          figureType = 'btCircle';
          break;
      }

      figures.push({
        type: figureType,
        key,
        ignoreEvent: [...ignoreEvent],
        attrs: { x: baseX, y: baseY, width, height, color },
      });

      const labelText = `${label ? `${label} · ` : ''}${type} ${profit.toFixed(2)}`;
      figures.push({
        type: 'btLabel',
        key,
        ignoreEvent: [...ignoreEvent],
        attrs: {
          x: baseX + 8,
          y: baseY,
          text: labelText,
          color: profit >= 0 ? green : red,
        },
      });
    });
  }

  return figures;
};
