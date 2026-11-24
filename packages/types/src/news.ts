export const WORLD_NEWS_TYPES = [
  'world.sanctions',
  'world.tradeRestrictions',
  'world.oil',
  'world.conflict',
] as const;

export type WorldNewsType = (typeof WORLD_NEWS_TYPES)[number];

export const WORLD_NEWS_MARKETS = [
  'energy',
  'international-payments',
  'international-trade',
] as const;

export type WorldNewsMarket = (typeof WORLD_NEWS_MARKETS)[number];

export const WORLD_NEWS_PROVIDERS = [
  'gdelt',
  'ofac',
  'federal-register',
  'eu-council',
  'opec',
  'un',
] as const;

export const NEWS_TYPES = [
  'us.cpi',
  'us.employment',
  'us.pce',
  'us.gdp',
  'us.trade',
  'eu.ecb.decision',
  'uk.boe.decision',
  'us.fomc.decision',
  'us.fomc.pressConference',
  'jp.boj.decision',
  'jp.cpi.national',
  'jp.cpi.tokyo',
  'venue.announcement',
  'official.statement',
  'social.opinion',
  'social.discussion',
  ...WORLD_NEWS_TYPES,
] as const;

export type NewsType = (typeof NEWS_TYPES)[number];
export const NEWS_PROVIDERS = [
  'bls',
  'fed',
  'boj',
  'stat-jp',
  'bybit',
  'fed-press',
  'ecb',
  'boe',
  'bea',
  'x',
  'reddit',
  ...WORLD_NEWS_PROVIDERS,
] as const;
export type NewsProvider = (typeof NEWS_PROVIDERS)[number];

export interface NewsPublication {
  author: string;
  authorId?: string;
  community?: string;
  authority: 'official' | 'watchlist' | 'community';
  symbols: string[];
  stance: 'bullish' | 'bearish' | 'unknown';
  stanceSymbol?: string;
  title?: string;
  category?: string;
}

export interface NewsFact {
  metric: string;
  period: string;
  unit: string;
  actual: number;
  consensus?: { value: number; availableAt: number; sourceUrl?: string };
}

export interface WorldNewsEvidence {
  title: string;
  countryCodes?: string[];
  sourceCount?: number;
  storyId?: string;
  storyAvailableAt?: number;
  affectedMarkets?: WorldNewsMarket[];
}

export interface WorldNewsStory {
  storyId: string;
  type: NewsType;
  title: string;
  availableAt: number;
  affectedMarkets: WorldNewsMarket[];
  sources: Pick<NewsEvent, 'provider' | 'url' | 'availableAt' | 'precision'>[];
}

/** UTC epoch milliseconds. Each revision is immutable. */
export interface NewsEvent {
  eventId: string;
  revision: number;
  type: NewsType;
  provider: NewsProvider;
  url: string;
  status: 'scheduled' | 'published' | 'cancelled';
  availableAt: number;
  scheduledAt: number | null;
  publishedAt: number | null;
  eventDay: string;
  timeZone:
    | 'America/New_York'
    | 'Asia/Tokyo'
    | 'Europe/Berlin'
    | 'Europe/London'
    | 'UTC';
  precision: 'minute' | 'day';
  provenance: 'observed' | 'reconstructed';
  facts?: NewsFact[];
  publication?: NewsPublication;
  world?: WorldNewsEvidence;
}

export interface NewsCoverage {
  provider: NewsProvider;
  start: number;
  end: number;
  provenance: NewsEvent['provenance'];
}

export interface NewsArchive {
  schemaVersion: 1;
  events: NewsEvent[];
  coverage: NewsCoverage[];
}

export interface NewsGateFeatures {
  recentType: NewsType | null;
  upcomingType: NewsType | null;
  minutesSinceRelease: number | null;
  minutesToRelease: number | null;
  surprise: number | null;
  coreCpiSurprisePp?: number | null;
  corePceSurprisePp?: number | null;
  payrollsSurpriseJobs?: number | null;
  policyRateSurprisePp?: number | null;
  reactionBtcPct: number | null;
  reactionRelativePct: number | null;
  reactionBreadth: number | null;
}

export interface NewsContext {
  asOf: number;
  status: 'available' | 'partial' | 'unavailable';
  events: readonly NewsEvent[];
  publications?: readonly NewsEvent[];
  worldEvents?: readonly NewsEvent[];
  worldStories?: readonly WorldNewsStory[];
  worldCoverage?: readonly NewsProvider[];
  coverage: readonly NewsProvider[];
  features: NewsGateFeatures;
}
