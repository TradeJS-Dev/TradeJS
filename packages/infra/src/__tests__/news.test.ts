import {
  importNewsArchive,
  importNewsPublications,
  validateNewsArchive,
} from '../timescale/news';
import { getPool } from '../timescale/pool';

jest.mock('../timescale/pool');
const event = {
  eventId: 'release',
  revision: 1,
  type: 'us.cpi',
  provider: 'bls',
  url: 'https://www.bls.gov/',
  status: 'published',
  availableAt: 11,
  scheduledAt: 10,
  publishedAt: 10,
  eventDay: '2025-02-12',
  timeZone: 'America/New_York',
  precision: 'minute',
  provenance: 'observed',
};
const batch = { schemaVersion: 1, events: [event], coverage: [] };
test('validates world event evidence and preserves day precision', () => {
  const world = {
    ...event,
    type: 'world.oil',
    provider: 'opec',
    precision: 'day',
    publishedAt: null,
    scheduledAt: null,
    world: { title: 'Production adjustment' },
  };
  expect(() =>
    validateNewsArchive({ ...batch, events: [world] }),
  ).not.toThrow();
  expect(() =>
    validateNewsArchive({
      ...batch,
      events: [{ ...world, provider: 'fed' }],
    }),
  ).toThrow('Invalid world news evidence');
  expect(() =>
    validateNewsArchive({
      ...batch,
      events: [{ ...world, world: undefined }],
    }),
  ).toThrow('Invalid world news evidence');
});

test('accepts versioned events and rejects late consensus or pre-publication availability', () => {
  expect(() => validateNewsArchive(batch)).not.toThrow();
  expect(() =>
    validateNewsArchive({ ...batch, events: [{ ...event, availableAt: 9 }] }),
  ).toThrow('Invalid news event');
  expect(() =>
    validateNewsArchive({
      ...batch,
      events: [
        {
          ...event,
          facts: [
            {
              metric: 'cpi',
              period: '2025-01',
              unit: 'percent',
              actual: 0.2,
              consensus: { value: 0.1, availableAt: 10 },
            },
          ],
        },
      ],
    }),
  ).toThrow('Invalid news event');
});
test('rolls back conflicting revisions with no coverage write', async () => {
  const client = {
    query: jest.fn().mockResolvedValue({ rowCount: 0 }),
    release: jest.fn(),
  };
  jest
    .mocked(getPool)
    .mockReturnValue({ connect: async () => client } as never);
  await expect(importNewsArchive(batch)).rejects.toThrow(
    'Conflicting news revision',
  );
  expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(
    client.query.mock.calls.some(([sql]) =>
      sql.includes('INSERT INTO market_news_coverage'),
    ),
  ).toBe(false);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('accepts an optional HTTPS source for pre-release consensus', () => {
  const withSource = (sourceUrl: string) => ({
    ...batch,
    events: [
      {
        ...event,
        facts: [
          {
            metric: 'core_cpi_mom',
            period: '2025-01',
            unit: 'percent',
            actual: 0.2,
            consensus: { value: 0.1, availableAt: 9, sourceUrl },
          },
        ],
      },
    ],
  });
  expect(() =>
    validateNewsArchive(withSource('https://example.com/preview')),
  ).not.toThrow();
  expect(() => validateNewsArchive(withSource('invalid-url'))).toThrow(
    'Invalid news event',
  );
});

test('keeps first observation immutable on repeat publication polls', async () => {
  const client = {
    query: jest.fn().mockResolvedValue({ rowCount: 0 }),
    release: jest.fn(),
  };
  jest
    .mocked(getPool)
    .mockReturnValue({ connect: async () => client } as never);
  const publication = {
    ...event,
    provider: 'x',
    type: 'social.opinion',
    publication: {
      author: 'fixture',
      authority: 'watchlist',
      stance: 'unknown',
      symbols: [],
    },
  };
  await expect(
    importNewsPublications({ ...batch, events: [publication] }),
  ).resolves.toBe(0);
  const write = client.query.mock.calls.find(([sql]) =>
    sql.includes('INSERT INTO market_news_events'),
  );
  expect(write?.[0]).toContain('DO NOTHING');
  expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  await expect(
    importNewsPublications({
      ...batch,
      events: [{ ...publication, revision: 2 }],
    }),
  ).rejects.toThrow('first observations');
});

test('accepts native release clocks for continental Europe, the UK and US PCE', () => {
  const fixtures = [
    ['ecb', 'eu.ecb.decision', 'Europe/Berlin'],
    ['boe', 'uk.boe.decision', 'Europe/London'],
    ['bea', 'us.pce', 'America/New_York'],
  ];
  const events = fixtures.map(([provider, type, timeZone]) => ({
    ...event,
    provider,
    type,
    timeZone,
  }));
  expect(() => validateNewsArchive({ ...batch, events })).not.toThrow();
});
