import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { importNewsPublications } from '@tradejs/infra/timescale/client';
import { collectPublications } from '../lib/news/feeds';
import { parseWatchlist, STARTER_WATCHLIST } from '../lib/news/publications';

export async function main() {
  const { values } = parseArgs({
    options: {
      watchlist: { type: 'string' },
      preview: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'official-only': { type: 'boolean' },
      social: { type: 'boolean' },
    },
  });
  const configured = values.watchlist
    ? parseWatchlist(JSON.parse(await readFile(values.watchlist, 'utf8')))
    : STARTER_WATCHLIST;
  const watch =
    values['official-only'] || !values.social ? parseWatchlist({}) : configured;
  const { publications, status } = await collectPublications(watch, {
    xToken: process.env.NEWS_X_BEARER_TOKEN,
    redditToken: process.env.NEWS_REDDIT_ACCESS_TOKEN,
    redditUserAgent: process.env.NEWS_REDDIT_USER_AGENT,
  });
  const events = publications.map((row) => row.event);
  const inserted =
    values['dry-run'] || !events.length
      ? 0
      : await importNewsPublications({
          schemaVersion: 1,
          events,
          coverage: [],
        });
  console.log(
    JSON.stringify(
      {
        received: events.length,
        inserted,
        sources: status,
        ...(values.preview
          ? {
              publications: publications.map(({ event, preview }) => ({
                url: event.url,
                publication: event.publication,
                publishedAt: event.publishedAt,
                preview,
              })),
            }
          : {}),
      },
      null,
      2,
    ),
  );
  if (status.every((feed) => feed.status !== 'available')) process.exitCode = 1;
}
