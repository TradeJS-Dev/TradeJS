import { createHash } from 'node:crypto';
import type { NewsArchive, NewsEvent, WorldNewsType } from '@tradejs/types';

const batchLag = 15 * 60_000;

export interface GdeltWorldBatch {
  stamp: string;
  success: boolean;
  rows: [
    id: string,
    type: WorldNewsType,
    url: string,
    code: string,
    countries: string[],
    sourceCount: number,
  ][];
}

export interface OfficialWorldNotice {
  provider: NewsEvent['provider'];
  type: WorldNewsType;
  url: string;
  title: string;
  eventDay: string;
  timeZone: NewsEvent['timeZone'];
  availableAt: number;
  publishedAt: number | null;
}

function articleUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Expected an HTTPS article URL');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('utm_')) url.searchParams.delete(key);
  }
  return url.href;
}

function makeWorldEvent(notice: OfficialWorldNotice): NewsEvent {
  const url = articleUrl(notice.url);
  return {
    eventId: createHash('sha256').update(url).digest('hex'),
    revision: 1,
    provider: notice.provider,
    type: notice.type,
    url,
    status: 'published',
    availableAt: notice.availableAt,
    publishedAt: notice.publishedAt,
    scheduledAt: null,
    eventDay: notice.eventDay,
    timeZone: notice.timeZone,
    precision: notice.publishedAt === null ? 'day' : 'minute',
    provenance: 'reconstructed',
    world: { title: notice.title },
  };
}

export function buildWorldNewsArchive(
  batches: readonly GdeltWorldBatch[],
  notices: readonly OfficialWorldNotice[],
): NewsArchive {
  const events = new Map<string, NewsEvent>();
  const coverage = new Map<number, NewsArchive['coverage'][number]>();
  const add = (event: NewsEvent) => {
    const key = `${event.provider}:${event.eventId}`;
    const previous = events.get(key);
    if (!previous || previous.availableAt > event.availableAt)
      events.set(key, event);
  };
  for (const batch of batches) {
    if (!batch.success) continue;
    const iso = batch.stamp.replace(
      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
      '$1-$2-$3T$4:$5:$6Z',
    );
    const publishedAt = Date.parse(iso);
    if (
      iso === batch.stamp ||
      !Number.isSafeInteger(publishedAt) ||
      publishedAt % batchLag !== 0
    ) {
      throw new Error('Invalid GDELT batch timestamp');
    }
    const availableAt = publishedAt + batchLag;
    coverage.set(availableAt, {
      provider: 'gdelt',
      start: availableAt,
      end: availableAt + batchLag,
      provenance: 'reconstructed',
    });
    for (const [, type, sourceUrl, , countryCodes, sourceCount] of batch.rows) {
      const url = articleUrl(sourceUrl);
      const title =
        new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? type;
      const event = makeWorldEvent({
        provider: 'gdelt',
        type,
        url,
        title,
        eventDay: iso.slice(0, 10),
        timeZone: 'UTC',
        availableAt,
        publishedAt,
      });
      event.world = { title, countryCodes, sourceCount };
      add(event);
    }
  }
  for (const notice of notices) add(makeWorldEvent(notice));
  return {
    schemaVersion: 1,
    events: [...events.values()].sort(
      (a, b) =>
        a.availableAt - b.availableAt || a.eventId.localeCompare(b.eventId),
    ),
    coverage: [...coverage.values()].sort((a, b) => a.start - b.start),
  };
}
