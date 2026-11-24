import {
  NEWS_PROVIDERS,
  NEWS_TYPES,
  WORLD_NEWS_PROVIDERS,
  WORLD_NEWS_MARKETS,
  WORLD_NEWS_TYPES,
  type NewsArchive,
} from '@tradejs/types';
import { getPool } from './pool';
import { queryMarketContext } from './query';

const isTime = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function validateNewsArchive(
  input: unknown,
): asserts input is NewsArchive {
  const data = input as NewsArchive;
  if (
    data?.schemaVersion !== 1 ||
    !Array.isArray(data.events) ||
    !Array.isArray(data.coverage)
  )
    throw new Error('Invalid news archive');

  for (const event of data.events) {
    const publication = event?.publication;
    const world = event?.world;
    if (
      (world !== undefined) !==
        WORLD_NEWS_TYPES.some((type) => type === event?.type) ||
      world === null ||
      (world &&
        (publication ||
          !WORLD_NEWS_PROVIDERS.some(
            (provider) => provider === event.provider,
          ) ||
          event.status !== 'published' ||
          typeof world.title !== 'string' ||
          !world.title.trim() ||
          (world.storyId !== undefined &&
            (typeof world.storyId !== 'string' || !world.storyId.trim())) ||
          (world.storyAvailableAt !== undefined &&
            (!world.storyId ||
              !isTime(world.storyAvailableAt) ||
              world.storyAvailableAt > event.availableAt)) ||
          (world.affectedMarkets !== undefined &&
            (!Array.isArray(world.affectedMarkets) ||
              !world.affectedMarkets.every((market) =>
                WORLD_NEWS_MARKETS.includes(market),
              ))) ||
          (world.sourceCount !== undefined &&
            (!Number.isSafeInteger(world.sourceCount) ||
              world.sourceCount < 1)) ||
          (world.countryCodes !== undefined &&
            (!Array.isArray(world.countryCodes) ||
              !world.countryCodes.every(
                (code) => typeof code === 'string' && /^[A-Z]{2,3}$/.test(code),
              )))))
    )
      throw new Error('Invalid world news evidence');
    if (
      publication &&
      (typeof publication.author !== 'string' ||
        !publication.author ||
        !['official', 'watchlist', 'community'].includes(
          publication.authority,
        ) ||
        !['bullish', 'bearish', 'unknown'].includes(publication.stance) ||
        !Array.isArray(publication.symbols) ||
        !publication.symbols.every(
          (symbol) =>
            typeof symbol === 'string' && /^[A-Z0-9]+USDT$/.test(symbol),
        ))
    ) {
      throw new Error('Invalid news publication');
    }
    if (
      !event ||
      typeof event.eventId !== 'string' ||
      !event.eventId ||
      !Number.isSafeInteger(event.revision) ||
      event.revision < 1 ||
      !NEWS_TYPES.includes(event.type) ||
      !NEWS_PROVIDERS.includes(event.provider) ||
      typeof event.url !== 'string' ||
      !event.url.startsWith('https://') ||
      !['scheduled', 'published', 'cancelled'].includes(event.status) ||
      !['minute', 'day'].includes(event.precision) ||
      ![
        'America/New_York',
        'Asia/Tokyo',
        'Europe/Berlin',
        'Europe/London',
        'UTC',
      ].includes(event.timeZone) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(event.eventDay) ||
      !['observed', 'reconstructed'].includes(event.provenance) ||
      !isTime(event.availableAt) ||
      (event.scheduledAt !== null && !isTime(event.scheduledAt)) ||
      (event.publishedAt !== null &&
        (!isTime(event.publishedAt) ||
          event.publishedAt > event.availableAt)) ||
      (event.status === 'published' &&
        event.precision === 'minute' &&
        event.publishedAt === null) ||
      (event.status !== 'published' &&
        (event.publishedAt !== null || event.facts !== undefined)) ||
      (event.facts !== undefined &&
        (!Array.isArray(event.facts) ||
          event.facts.some(
            (f) =>
              !f ||
              !f.metric ||
              !f.period ||
              !f.unit ||
              !Number.isFinite(f.actual) ||
              (f.consensus &&
                (!Number.isFinite(f.consensus.value) ||
                  !isTime(f.consensus.availableAt) ||
                  (f.consensus.sourceUrl !== undefined &&
                    (typeof f.consensus.sourceUrl !== 'string' ||
                      !f.consensus.sourceUrl.startsWith('https://'))) ||
                  f.consensus.availableAt >= (event.publishedAt ?? 0))),
          )))
    ) {
      throw new Error(`Invalid news event: ${event?.eventId}`);
    }
  }
  for (const row of data.coverage) {
    if (
      !row ||
      !NEWS_PROVIDERS.includes(row.provider) ||
      !isTime(row.start) ||
      !isTime(row.end) ||
      row.start >= row.end ||
      !['observed', 'reconstructed'].includes(row.provenance)
    ) {
      throw new Error('Invalid news coverage');
    }
  }
}

export async function ensureNewsSchema(
  executor: Pick<ReturnType<typeof getPool>, 'query'> = getPool(),
) {
  await executor.query(`
      CREATE TABLE IF NOT EXISTS market_news_events (
        provider text NOT NULL, event_id text NOT NULL, revision integer NOT NULL,
        available_at bigint NOT NULL, event jsonb NOT NULL,
        PRIMARY KEY(provider, event_id, revision)
      );
      CREATE INDEX IF NOT EXISTS market_news_available_idx ON market_news_events(available_at);
      CREATE TABLE IF NOT EXISTS market_news_coverage (
        provider text NOT NULL, start_at bigint NOT NULL, end_at bigint NOT NULL,
        provenance text NOT NULL, PRIMARY KEY(provider,start_at,end_at,provenance)
      )
    `);
}

export async function importNewsArchive(input: unknown) {
  return writeNewsArchive(input, false);
}

export async function importWorldNews(input: unknown) {
  validateNewsArchive(input);
  if (
    input.events.some((event) => !event.world || event.revision !== 1) ||
    input.coverage.some(
      ({ provider }) =>
        !WORLD_NEWS_PROVIDERS.some((source) => source === provider),
    )
  ) {
    throw new Error('Expected first observations of world news');
  }
  return writeNewsArchive(input, true);
}

export async function importNewsPublications(input: unknown) {
  validateNewsArchive(input);
  if (
    input.coverage.length ||
    input.events.some(
      (event) =>
        !event.publication ||
        event.status !== 'published' ||
        event.provenance !== 'observed' ||
        event.revision !== 1,
    )
  ) {
    throw new Error('Expected first observations of publications');
  }
  return writeNewsArchive(input, true);
}

async function writeNewsArchive(
  input: unknown,
  preserveFirstObservation: boolean,
) {
  validateNewsArchive(input);
  if (process.env.TRADEJS_TIMESCALE_READ_ONLY === 'true') {
    throw new Error('Cannot import news into read-only Timescale');
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await ensureNewsSchema(client);
    const written = await client.query(
      `
      INSERT INTO market_news_events(provider,event_id,revision,available_at,event)
      SELECT e->>'provider',e->>'eventId',(e->>'revision')::integer,
             (e->>'availableAt')::bigint,e FROM jsonb_array_elements($1::jsonb) e
      ON CONFLICT(provider,event_id,revision) ${
        preserveFirstObservation
          ? 'DO NOTHING'
          : 'DO UPDATE SET event=EXCLUDED.event WHERE market_news_events.event=EXCLUDED.event'
      }
    `,
      [JSON.stringify(input.events)],
    );
    if (!preserveFirstObservation && written.rowCount !== input.events.length)
      throw new Error('Conflicting news revision');
    await client.query(
      `
      INSERT INTO market_news_coverage
      SELECT e->>'provider',(e->>'start')::bigint,(e->>'end')::bigint,e->>'provenance'
      FROM jsonb_array_elements($1::jsonb) e ON CONFLICT DO NOTHING
    `,
      [JSON.stringify(input.coverage)],
    );
    await client.query('COMMIT');
    return written.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function readNewsArchive(
  asOf: number,
  start: number,
  end: number,
): Promise<NewsArchive> {
  const { rows } = await queryMarketContext<{
    events: NewsArchive['events'];
    coverage: NewsArchive['coverage'];
  }>(
    `
    WITH latest AS (
      SELECT DISTINCT ON (provider,event_id) event FROM market_news_events
      WHERE available_at <= $1 ORDER BY provider,event_id,revision DESC
    )
    SELECT
      COALESCE((SELECT jsonb_agg(event) FROM latest WHERE
        COALESCE(CASE WHEN event ? 'world' THEN (event->>'availableAt')::bigint END,
          (event->>'publishedAt')::bigint,(event->>'scheduledAt')::bigint,
          extract(epoch from ((event->>'eventDay')::date::timestamp AT TIME ZONE 'UTC'))::bigint*1000)
          BETWEEN $2 AND $3), '[]') AS events,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',provider,'start',start_at,
         'end',end_at,'provenance',provenance))
        FROM market_news_coverage WHERE start_at <= $1 AND end_at > $1), '[]') AS coverage
  `,
    [asOf, start, end],
    { timeoutMs: 2000 },
  );
  return { schemaVersion: 1, ...rows[0] };
}
