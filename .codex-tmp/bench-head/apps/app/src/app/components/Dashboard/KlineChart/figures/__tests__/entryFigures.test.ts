import { createEntryLinePointFigure } from '../entryLinePointFigure';
import { createEntryPointsPointFigure } from '../entryPointsPointFigure';
import { createEntryZonePointFigure } from '../entryZonePointFigure';

describe('kline chart entry figures', () => {
  it('creates entry line figure with defaults and custom style', () => {
    const empty = createEntryLinePointFigure({
      coordinates: [{ x: 1, y: 2 }],
      overlay: {},
    });
    expect(empty).toEqual([]);

    const line = createEntryLinePointFigure({
      coordinates: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ],
      overlay: {
        extendData: {
          line: {
            points: [],
            color: '#00ffaa',
            width: 3,
            style: 'dashed',
          },
        },
      },
    });

    expect(line).toEqual([
      {
        type: 'line',
        attrs: {
          coordinates: [
            { x: 1, y: 2 },
            { x: 5, y: 6 },
          ],
        },
        styles: { color: '#00ffaa', size: 3, style: 'dashed' },
      },
    ]);
  });

  it('creates entry points circles with defaults and override radius', () => {
    const points = createEntryPointsPointFigure({
      coordinates: [
        { x: 10, y: 20 },
        { x: 11, y: 22 },
      ],
      overlay: {
        extendData: {
          points: {
            points: [],
            color: '#00ffaa',
            radius: 5,
          },
        },
      },
    });

    expect(points).toHaveLength(2);
    expect(points[0]).toEqual(
      expect.objectContaining({
        type: 'circle',
        key: 'entry_pt_0',
        attrs: { x: 10, y: 20, r: 5 },
        styles: { style: 'fill', color: '#00ffaa' },
      }),
    );

    const defaults = createEntryPointsPointFigure({
      coordinates: [{ x: 1, y: 1 }],
      overlay: {},
    });
    expect(defaults[0].attrs.r).toBe(4);
    expect(defaults[0].styles.color).toBe('#ef4444');
  });

  it('creates entry zone rectangle from two points with defaults and override colors', () => {
    const empty = createEntryZonePointFigure({
      coordinates: [{ x: 1, y: 2 }],
      overlay: {},
    });
    expect(empty).toEqual([]);

    const zone = createEntryZonePointFigure({
      coordinates: [
        { x: 10, y: 30 },
        { x: 20, y: 10 },
      ],
      overlay: {
        extendData: {
          zone: {
            start: { timestamp: 1, value: 1 },
            end: { timestamp: 2, value: 2 },
            color: 'rgba(1,2,3,0.3)',
            borderColor: 'rgba(4,5,6,0.7)',
          },
        },
      },
    });

    expect(zone).toEqual([
      {
        type: 'rect',
        attrs: { x: 10, y: 10, width: 10, height: 20 },
        styles: {
          color: 'rgba(1,2,3,0.3)',
          borderColor: 'rgba(4,5,6,0.7)',
          size: 1,
        },
      },
    ]);
  });
});
