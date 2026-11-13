import {
  loadChartDrawings,
  measureMove,
  positionRatio,
} from '../ChartDrawings';

it('measures price change and candle distance in either direction', () => {
  expect(measureMove(100, 120, -5)).toBe('20.00% · 5 bars');
  expect(measureMove(100, 80, 3)).toBe('-20.00% · 3 bars');
  expect(measureMove(0, 80, 3)).toBe('— · 3 bars');
});

it('calculates risk/reward for long and short positions and rejects invalid geometry', () => {
  expect(positionRatio(100, 95, 110)).toBe('2.00R');
  expect(positionRatio(100, 105, 90)).toBe('2.00R');
  expect(positionRatio(100, 105, 110)).toBe(
    'Stop and target must bracket entry',
  );
});

it('ignores damaged stored drawings and loads drawings per market', () => {
  const drawing = {
    id: 'saved',
    kind: 'level',
    points: [{ timestamp: 12, value: 100 }],
  };
  localStorage.setItem(
    'market-a',
    JSON.stringify([
      drawing,
      { ...drawing, points: [] },
      { ...drawing, kind: 'toString' },
    ]),
  );
  localStorage.setItem('market-b', 'broken json');
  expect(loadChartDrawings('market-a')).toEqual([drawing]);
  expect(loadChartDrawings('market-b')).toEqual([]);
});
