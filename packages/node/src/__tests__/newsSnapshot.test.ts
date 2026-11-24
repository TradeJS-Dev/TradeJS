import type { NewsArchive, NewsEvent } from '@tradejs/types';
import {
  buildNewsSnapshot,
  newsReactionWindow,
} from '../strategyHelpers/newsSnapshot';

const ts = Date.parse('2025-03-12T12:30:00Z');
const event: NewsEvent = {
  eventId: 'cpi',
  revision: 1,
  type: 'us.cpi',
  provider: 'bls',
  url: 'https://www.bls.gov/',
  status: 'scheduled',
  availableAt: ts - 3600000,
  scheduledAt: ts,
  publishedAt: null,
  eventDay: '2025-03-12',
  timeZone: 'America/New_York',
  precision: 'minute',
  provenance: 'observed',
};
const release: NewsEvent = {
  ...event,
  revision: 2,
  status: 'published',
  publishedAt: ts,
  availableAt: ts + 4000,
  facts: [
    {
      metric: 'core',
      period: '2025-02',
      unit: 'percent',
      actual: 0.3,
      consensus: { value: 0.2, availableAt: ts - 60000 },
    },
  ],
};
const archive = (events: NewsEvent[]): NewsArchive => ({
  schemaVersion: 1,
  events,
  coverage: [],
});

test('exposes revisions and values at their respective availability times', () => {
  expect(
    buildNewsSnapshot(archive([release, event]), ts - 1).features.upcomingType,
  ).toBe('us.cpi');
  expect(
    buildNewsSnapshot(archive([release, event]), ts + 3999).features.surprise,
  ).toBeNull();
  expect(
    buildNewsSnapshot(archive([release, event]), ts + 4000).features.surprise,
  ).toBeCloseTo(0.1);
  expect(
    buildNewsSnapshot(
      archive([
        event,
        {
          ...release,
          status: 'cancelled',
          facts: undefined,
          publishedAt: null,
        },
      ]),
      ts + 4000,
    ).events,
  ).toEqual([]);
});

test('exposes core PCE surprise only with a pre-release consensus for that metric', () => {
  const corePce = {
    metric: 'core_pce_mom',
    period: '2025-02',
    unit: 'percent',
    actual: 0.3,
  } as const;
  const pce: NewsEvent = {
    ...release,
    type: 'us.pce',
    facts: [
      {
        ...corePce,
        metric: 'pce_mom',
        consensus: { value: 0.1, availableAt: ts - 1 },
      },
      { ...corePce, consensus: { value: 0.3, availableAt: ts - 1 } },
    ],
  };
  expect(
    buildNewsSnapshot(archive([pce]), ts + 3999).features.corePceSurprisePp,
  ).toBeNull();
  expect(
    buildNewsSnapshot(archive([pce]), ts + 4000).features.corePceSurprisePp,
  ).toBe(0);
  const lateForecast: NewsEvent = {
    ...pce,
    facts: [{ ...corePce, consensus: { value: 0.2, availableAt: ts } }],
  };
  expect(
    buildNewsSnapshot(archive([lateForecast]), ts + 4000).features
      .corePceSurprisePp,
  ).toBeNull();
});

test('only measures reaction after the first entirely post-release candle closes', () => {
  const offGrid = {
    ...release,
    publishedAt: ts + 60000,
    availableAt: ts + 60000,
  };
  expect(
    newsReactionWindow(buildNewsSnapshot(archive([offGrid]), ts + 1_799_999)),
  ).toBeNull();
  expect(
    newsReactionWindow(buildNewsSnapshot(archive([offGrid]), ts + 1_800_000)),
  ).toEqual({ before: ts - 900000, after: ts + 900000 });
});

test('distinguishes empty coverage from missing coverage and handles a Tokyo day without a timestamp', () => {
  const day: NewsEvent = {
    ...event,
    provider: 'boj',
    type: 'jp.boj.decision',
    scheduledAt: null,
    timeZone: 'Asia/Tokyo',
    precision: 'day',
    availableAt: ts - 86400000,
  };
  const timed = buildNewsSnapshot(archive([day]), ts);
  expect(timed.features.upcomingType).toBe('jp.boj.decision');
  expect(timed.features.minutesToRelease).toBeNull();
  expect(buildNewsSnapshot(archive([]), ts).status).toBe('unavailable');
  expect(
    buildNewsSnapshot(
      {
        ...archive([]),
        coverage: [
          { provider: 'boj', start: ts, end: ts + 1, provenance: 'observed' },
        ],
      },
      ts,
    ).status,
  ).toBe('partial');
});

test('keeps social publications available separately and preserves macro features', () => {
  const opinion: NewsEvent = {
    ...release,
    provider: 'x',
    type: 'social.opinion',
    eventId: 'post',
    revision: 1,
    publishedAt: ts - 4 * 3600000,
    availableAt: ts + 1,
    scheduledAt: null,
    facts: undefined,
    publication: {
      author: 'fixture',
      authority: 'watchlist',
      stance: 'bullish',
      stanceSymbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
    },
  };
  expect(
    buildNewsSnapshot(archive([opinion]), ts).publications,
  ).toBeUndefined();
  const after = buildNewsSnapshot(archive([release, opinion]), ts + 4000);
  expect(after.publications).toEqual([opinion]);
  expect(after.events).toEqual([release]);
  expect(after.features.recentType).toBe('us.cpi');
  expect(
    buildNewsSnapshot(archive([opinion]), ts + 4000).features.recentType,
  ).toBeNull();
});

test('keeps world news in context from availability without replacing macro features', () => {
  const world: NewsEvent = {
    ...release,
    provider: 'ofac',
    type: 'world.sanctions',
    eventId: 'sanctions',
    precision: 'day',
    publishedAt: null,
    scheduledAt: null,
    availableAt: ts + 5000,
    eventDay: '2025-03-11',
    facts: undefined,
    world: { title: 'Official notice' },
  };
  const input = archive([release, world]);
  expect(buildNewsSnapshot(input, ts + 4999).worldEvents).toBeUndefined();
  const after = buildNewsSnapshot(input, ts + 5000);
  expect(after.worldEvents).toEqual([world]);
  expect(after.features.recentType).toBe('us.cpi');
  expect(
    buildNewsSnapshot(input, ts + 5001 + 86_400_000).worldEvents,
  ).toBeUndefined();
});

test('recognizes a checked world-news window with no matching events', () => {
  const input: NewsArchive = {
    ...archive([]),
    coverage: [
      {
        provider: 'gdelt',
        start: ts,
        end: ts + 1000,
        provenance: 'reconstructed',
      },
    ],
  };
  expect(buildNewsSnapshot(input, ts)).toMatchObject({
    status: 'partial',
    worldCoverage: ['gdelt'],
  });
  expect(buildNewsSnapshot(input, ts + 1000).worldCoverage).toBeUndefined();
});

test('groups reports by story and only discloses sources already available', () => {
  const first: NewsEvent = {
    ...release,
    provider: 'gdelt',
    type: 'world.tradeRestrictions',
    eventId: 'first-report',
    availableAt: ts + 900_000,
    facts: undefined,
    world: {
      title: 'Tariff decision',
      storyId: 'tariff',
      affectedMarkets: ['international-trade'],
    },
  };
  const confirmation: NewsEvent = {
    ...first,
    provider: 'federal-register',
    eventId: 'official-confirmation',
    url: 'https://www.federalregister.gov/decision',
    precision: 'day',
    availableAt: ts + 2 * 86_400_000,
    publishedAt: null,
    scheduledAt: null,
    world: {
      title: 'Published decision',
      storyId: 'tariff',
      storyAvailableAt: first.availableAt,
      affectedMarkets: ['international-payments'],
    },
  };
  const early = buildNewsSnapshot(
    archive([first, confirmation]),
    first.availableAt,
  );
  expect(early.worldStories).toMatchObject([
    {
      availableAt: first.availableAt,
      affectedMarkets: ['international-trade'],
      sources: [{ provider: 'gdelt' }],
    },
  ]);
  const sameDay = { ...confirmation, availableAt: first.availableAt + 3600000 };
  const later = buildNewsSnapshot(
    archive([sameDay, first]),
    sameDay.availableAt,
  );
  expect(later.worldStories).toMatchObject([
    {
      availableAt: first.availableAt,
      affectedMarkets: ['international-trade', 'international-payments'],
      sources: [{ provider: 'gdelt' }, { provider: 'federal-register' }],
    },
  ]);
  const expired = buildNewsSnapshot(
    archive([first, confirmation]),
    confirmation.availableAt,
  );
  expect(expired.worldStories).toBeUndefined();
  expect(expired.worldEvents).toEqual([confirmation]);
});
