import type { NewsEvent, NewsPublication } from '@tradejs/types';

export interface SocialWatchlist {
  x: string[];
  redditUsers: string[];
  redditCommunities: string[];
}

export interface PublicationRead {
  event: NewsEvent;
  preview: string;
}

export const STARTER_WATCHLIST: SocialWatchlist = {
  x: ['LynAldenContact', 'CryptoHayes', 'VitalikButerin'],
  redditUsers: ['vbuterin'],
  redditCommunities: ['BitcoinMarkets'],
};

const assets = [
  ['BTCUSDT', /\b(?:BTC|Bitcoin)\b/i],
  ['ETHUSDT', /\b(?:ETH|Ethereum)\b/i],
  ['SOLUSDT', /\b(?:SOL|Solana)\b/i],
] as const;

function symbols(text: string) {
  return [
    ...new Set([
      ...(text.match(/\b[A-Z0-9]+USDT\b/g) ?? []),
      ...assets
        .filter(([, pattern]) => pattern.test(text))
        .map(([symbol]) => symbol),
    ]),
  ].sort();
}

function attributedStance(
  text: string,
): Pick<NewsPublication, 'stance' | 'stanceSymbol'> {
  // Require a direct first-person statement on a named asset. Anything
  // ambiguous (including quote prefixes or two different views) stays unknown.
  const match =
    /^(?:i am|i['’]m)\s+(bullish|bearish)\s+on\s+\$?(btc|bitcoin|eth|ethereum|sol|solana)\b/i.exec(
      text.trim(),
    );
  if (
    !match ||
    /\b(?:but|however|if|unless|short term|previously)\b/i.test(text) ||
    (text.match(/\b(bullish|bearish)\b/gi)?.length ?? 0) !== 1
  )
    return { stance: 'unknown' };
  return {
    stance: match[1].toLowerCase() === 'bullish' ? 'bullish' : 'bearish',
    stanceSymbol: symbols(match[2])[0],
  };
}

export function makePublication(
  input: {
    provider: NewsEvent['provider'];
    id: string;
    url: string;
    time: number;
    type: NewsEvent['type'];
    text: string;
    author: string;
    authorId?: string;
    community?: string;
    authority: NewsPublication['authority'];
    category?: string;
  },
  observedAt: number,
): PublicationRead | null {
  if (
    !input.id ||
    !input.author ||
    !Number.isSafeInteger(input.time) ||
    input.time < 0 ||
    input.time > observedAt
  )
    return null;
  const preview = input.text.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!preview) return null;
  const official = input.authority === 'official';
  return {
    preview,
    event: {
      provider: input.provider,
      eventId: input.id,
      revision: 1,
      type: input.type,
      url: input.url,
      status: 'published',
      eventDay: new Date(input.time).toISOString().slice(0, 10),
      timeZone: 'UTC',
      precision: 'minute',
      provenance: 'observed',
      availableAt: observedAt,
      publishedAt: input.time,
      scheduledAt: null,
      publication: {
        author: input.author,
        authorId: input.authorId,
        community: input.community,
        authority: input.authority,
        category: input.category,
        symbols: symbols(input.text),
        ...(official ? { stance: 'unknown' } : attributedStance(input.text)),
        ...(official ? { title: preview } : {}),
      },
    },
  };
}

export function parseWatchlist(value: unknown): SocialWatchlist {
  if (typeof value !== 'object' || !value || Array.isArray(value))
    throw new Error('Invalid news watchlist');
  const input = value as Record<string, unknown>;
  const lists = {
    x: /^[a-z0-9_]{1,15}$/i,
    redditUsers: /^[a-z0-9_-]{3,20}$/i,
    redditCommunities: /^[a-z0-9_]{3,21}$/i,
  };
  const output: SocialWatchlist = {
    x: [],
    redditUsers: [],
    redditCommunities: [],
  };
  for (const key of Object.keys(lists) as Array<keyof SocialWatchlist>) {
    const names = input[key] ?? [];
    if (
      !Array.isArray(names) ||
      names.length > 25 ||
      names.some((v) => typeof v !== 'string' || !lists[key].test(v))
    ) {
      throw new Error(`Invalid news watchlist field: ${key}`);
    }
    output[key] = [...new Map(names.map((v) => [v.toLowerCase(), v])).values()];
  }
  return output;
}
