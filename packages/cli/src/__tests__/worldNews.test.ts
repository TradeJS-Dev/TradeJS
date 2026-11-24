import { buildWorldNewsArchive } from '../lib/news/world';

const article = 'https://news.example/oil-production-cut';
const stamp = '20260409001500';
const start = Date.parse('2026-04-09T00:30:00Z');

test('adds batch lag, deduplicates article URLs and records empty checked windows', () => {
  const result = buildWorldNewsArchive(
    [
      { stamp: '20260409003000', success: true, rows: [] },
      {
        stamp,
        success: true,
        rows: [
          ['1', 'world.oil', article, '025', ['SA'], 1],
          ['2', 'world.oil', article + '?utm_source=feed', '025', ['SA'], 1],
        ],
      },
      { stamp: '20260409004500', success: false, rows: [] },
    ],
    [],
  );
  expect(result.events).toHaveLength(1);
  expect(result.events[0]).toMatchObject({
    provider: 'gdelt',
    url: article,
    availableAt: start,
    publishedAt: start - 15 * 60_000,
  });
  expect(result.coverage.map(({ start: from }) => from)).toEqual([
    start,
    start + 15 * 60_000,
  ]);
});

test('retains date-only official provenance without inventing a publication time', () => {
  const result = buildWorldNewsArchive(
    [],
    [
      {
        provider: 'opec',
        type: 'world.oil',
        title: 'Production decision',
        eventDay: '2026-04-09',
        timeZone: 'Europe/Berlin',
        url: 'https://www.opec.org/decision',
        availableAt: Date.parse('2026-04-09T22:00:00Z'),
        publishedAt: null,
      },
    ],
  );
  expect(result.events[0]).toMatchObject({
    precision: 'day',
    publishedAt: null,
    eventDay: '2026-04-09',
  });
});
