/** @jest-environment node */

import { collectPublications } from '../lib/news/feeds';
import { makePublication, parseWatchlist } from '../lib/news/publications';

const now = Date.parse('2026-11-21T12:00:00Z');
const published = '2026-11-21T11:45:00Z';
const json = (data: unknown) => new Response(JSON.stringify(data));

test('collects official announcements, X posts and Reddit opinions with attributed stance', async () => {
  const redditPost = {
    kind: 't3',
    data: {
      id: 'p1',
      author: 'alice',
      subreddit: 'BitcoinMarkets',
      title: 'Market idea',
      selftext: "I'm bearish on BTC",
      permalink: '/r/BitcoinMarkets/comments/p1/topic/',
      created_utc: Date.parse(published) / 1000,
    },
  };
  const http = jest.fn(async (url: string) => {
    if (url.includes('federalreserve.gov'))
      return new Response(
        '<rss><channel><item><title>Monetary &amp; financial statement</title><link><![CDATA[https://www.federalreserve.gov/news.htm]]></link><pubDate>Sat, 21 Nov 2026 11:45:00 GMT</pubDate></item></channel></rss>',
      );
    if (url.includes('www.ecb.europa.eu')) {
      return new Response(
        '<rss><channel><item><title>Monetary policy decisions</title><link>https://www.ecb.europa.eu/press/decision</link><pubDate>Sat, 21 Nov 2026 11:45:00 GMT</pubDate></item></channel></rss>',
      );
    }
    if (url.includes('/rss/'))
      return new Response('<rss><channel></channel></rss>');
    if (url.includes('bybit.kz'))
      return json({
        retCode: 0,
        result: {
          list: [
            {
              url: 'https://announcements.bybit.com/launch',
              title: 'ABCUSDT Perpetual',
              publishTime: Date.parse(published),
              type: { key: 'new_crypto' },
            },
            {
              url: 'https://announcements.bybit.com/campaign',
              title: 'Campaign',
              publishTime: Date.parse(published),
              type: { key: 'latest_activities' },
            },
          ],
        },
      });
    if (url.includes('/by/username/'))
      return json({ data: { id: '123', username: 'alice' } });
    if (url.includes('/tweets'))
      return json({
        data: [
          {
            id: '10',
            author_id: '123',
            text: "I'm bullish on ETH",
            created_at: published,
          },
          {
            id: '11',
            author_id: '999',
            text: 'Wrong author',
            created_at: published,
          },
        ],
      });
    if (url.includes('/user/alice/comments'))
      return json({
        data: {
          children: [
            {
              kind: 't1',
              data: {
                id: 'c1',
                author: 'alice',
                subreddit: 'BitcoinMarkets',
                link_id: 't3_p1',
                created_utc: Date.parse(published) / 1000,
                body: 'Discussion context',
              },
            },
          ],
        },
      });
    return json({ data: { children: [redditPost] } });
  });
  const res = await collectPublications(
    parseWatchlist({
      x: ['alice'],
      redditUsers: ['alice'],
      redditCommunities: ['BitcoinMarkets'],
    }),
    {
      xToken: 'fixture-x',
      redditToken: 'fixture-reddit',
      redditUserAgent: 'fixture-app',
    },
    http as never,
    () => now,
  );
  expect(res.publications).toHaveLength(6);
  expect(
    res.publications.find((row) => row.event.provider === 'ecb')?.event
      .publication?.authority,
  ).toBe('official');
  expect(res.publications.map((row) => row.event.availableAt)).toEqual(
    Array(6).fill(now),
  );
  const x = res.publications.find((row) => row.event.provider === 'x');
  expect(x?.event.publication).toMatchObject({
    authorId: '123',
    authority: 'watchlist',
    stance: 'bullish',
    stanceSymbol: 'ETHUSDT',
  });
  expect(JSON.stringify(x?.event)).not.toContain("I'm bullish");
  expect(
    res.publications.find((row) => row.event.eventId === 't3_p1')?.event
      .publication,
  ).toMatchObject({ authority: 'watchlist', stanceSymbol: 'BTCUSDT' });
  expect(
    res.publications.find((row) => row.event.eventId === 't1_c1')?.event.url,
  ).toBe('https://www.reddit.com/comments/p1/_/c1/');
});

test('reports unavailable social feeds without authentication requests and isolates quota failures', async () => {
  const fetcher = jest.fn(async () => new Response('', { status: 429 }));
  const result = await collectPublications(
    parseWatchlist({ x: ['alice'], redditUsers: ['alice'] }),
    {},
    fetcher,
    () => now,
  );
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(
    result.status.filter((row) => row.status === 'unavailable'),
  ).toHaveLength(3);
  expect(
    result.status
      .filter((row) => row.status === 'failed')
      .map((row) => row.reason),
  ).toEqual(Array(5).fill('HTTP 429'));
});

test('rejects invalid handles and leaves quoted or conditional opinions unscored', () => {
  expect(() => parseWatchlist({ x: ['alice?token=x'] })).toThrow('watchlist');
  for (const text of [
    "I'm bullish on BTC if inflation falls",
    '> I am bearish on SOL',
    'I am bullish on ETH but bearish on BTC',
  ]) {
    const input = {
      provider: 'x',
      id: '1',
      url: 'https://x.com/alice/status/1',
      time: now - 1,
      type: 'social.opinion',
      text,
      author: 'alice',
      authority: 'watchlist',
    } as const;
    expect(makePublication(input, now)?.event.publication?.stance).toBe(
      'unknown',
    );
    expect(makePublication({ ...input, time: now + 1 }, now)).toBeNull();
  }
});
