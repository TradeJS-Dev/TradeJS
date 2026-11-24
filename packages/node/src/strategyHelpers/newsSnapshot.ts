import {
  WORLD_NEWS_PROVIDERS,
  type NewsArchive,
  type NewsContext,
  type NewsEvent,
  type WorldNewsStory,
} from '@tradejs/types';

const minute = 60_000;
const day = 1440 * minute;
export const NEWS_LOOKBACK = 180 * minute;
export const NEWS_LOOKAHEAD = day;
export const NEWS_PUBLICATION_LOOKBACK = day;
export const NEWS_REACTION_BAR = 15 * minute;
const providers = ['bls', 'fed', 'boj', 'stat-jp'] as const;

function eventDay(asOf: number, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(asOf);
}

export function buildNewsSnapshot(
  archive: NewsArchive,
  asOf: number,
): NewsContext {
  const latest = new Map<string, NewsEvent>();
  for (const event of archive.events) {
    if (event.availableAt > asOf) continue;
    const key = `${event.provider}:${event.eventId}`;
    if ((latest.get(key)?.revision ?? 0) < event.revision)
      latest.set(key, event);
  }
  const localDays = new Map<string, string>();
  const relevant = [...latest.values()]
    .filter((event) => {
      if (event.status === 'cancelled') return false;
      if (event.world) {
        return (
          event.status === 'published' &&
          event.availableAt >= asOf - NEWS_PUBLICATION_LOOKBACK
        );
      }
      if (event.precision === 'day') {
        const local =
          localDays.get(event.timeZone) ?? eventDay(asOf, event.timeZone);
        localDays.set(event.timeZone, local);
        return event.eventDay === local;
      }
      const time = event.publishedAt ?? event.scheduledAt;
      return (
        time !== null &&
        time >=
          asOf -
            (event.publication ? NEWS_PUBLICATION_LOOKBACK : NEWS_LOOKBACK) &&
        time <= asOf + NEWS_LOOKAHEAD
      );
    })
    .sort(
      (a, b) =>
        (a.publishedAt ?? a.scheduledAt ?? asOf) -
          (b.publishedAt ?? b.scheduledAt ?? asOf) ||
        a.provider.localeCompare(b.provider) ||
        a.eventId.localeCompare(b.eventId),
    );
  const events = relevant.filter((event) => !event.publication && !event.world);
  const publications = relevant.filter((event) => event.publication).slice(-30);
  const worldEvents = relevant
    .filter((event) => event.world)
    .sort((a, b) => a.availableAt - b.availableAt);
  const worldStories = new Map<string, WorldNewsStory>();
  for (const event of worldEvents) {
    const evidence = event.world!;
    const storyId = evidence.storyId ?? `${event.provider}:${event.eventId}`;
    const { provider, url, availableAt, precision } = event;
    const storyAvailableAt = evidence.storyAvailableAt ?? availableAt;
    if (storyAvailableAt < asOf - NEWS_PUBLICATION_LOOKBACK) continue;
    const source = { provider, url, availableAt, precision };
    const story = worldStories.get(storyId);
    if (!story) {
      worldStories.set(storyId, {
        storyId,
        type: event.type,
        title: evidence.title,
        availableAt: storyAvailableAt,
        affectedMarkets: [...(evidence.affectedMarkets ?? [])],
        sources: [source],
      });
      continue;
    }
    if (!story.sources.some((item) => item.url === url))
      story.sources.push(source);
    story.availableAt = Math.min(story.availableAt, storyAvailableAt);
    story.affectedMarkets = [
      ...new Set([
        ...story.affectedMarkets,
        ...(evidence.affectedMarkets ?? []),
      ]),
    ];
  }
  const recent = events.findLast(
    (e) =>
      e.status === 'published' &&
      e.publishedAt !== null &&
      e.publishedAt <= asOf,
  );
  const next = events.find(
    (e) => e.status === 'scheduled' && (e.scheduledAt ?? -1) >= asOf,
  );
  const untimed = events.find(
    (e) => e.status === 'scheduled' && e.precision === 'day',
  );
  const fact = recent?.facts?.find(
    (f) => f.consensus && f.consensus.availableAt < recent.publishedAt!,
  );
  const surpriseFor = (metric: string, unit: string) => {
    const measurement = recent?.facts?.find(
      (f) =>
        f.metric === metric &&
        f.unit === unit &&
        f.consensus &&
        f.consensus.availableAt < recent.publishedAt!,
    );
    return measurement?.consensus
      ? measurement.actual - measurement.consensus.value
      : null;
  };
  const coveredAt = (provider: NewsEvent['provider']) =>
    archive.coverage.some(
      (c) => c.provider === provider && c.start <= asOf && asOf < c.end,
    );
  const coverage = providers.filter(coveredAt);
  const worldCoverage = WORLD_NEWS_PROVIDERS.filter(coveredAt);
  return {
    asOf,
    status:
      coverage.length === providers.length
        ? 'available'
        : coverage.length ||
            events.length ||
            worldEvents.length ||
            worldCoverage.length
          ? 'partial'
          : 'unavailable',
    events,
    ...(publications.length ? { publications } : {}),
    ...(worldEvents.length ? { worldEvents } : {}),
    ...(worldStories.size ? { worldStories: [...worldStories.values()] } : {}),
    ...(worldCoverage.length ? { worldCoverage } : {}),
    coverage,
    features: {
      recentType: recent?.type ?? null,
      upcomingType: next?.type ?? untimed?.type ?? null,
      minutesSinceRelease:
        recent?.publishedAt != null
          ? (asOf - recent.publishedAt) / minute
          : null,
      minutesToRelease:
        next?.scheduledAt != null ? (next.scheduledAt - asOf) / minute : null,
      surprise: fact?.consensus ? fact.actual - fact.consensus.value : null,
      coreCpiSurprisePp: surpriseFor('core_cpi_mom', 'percent'),
      corePceSurprisePp: surpriseFor('core_pce_mom', 'percent'),
      payrollsSurpriseJobs: surpriseFor('nonfarm_payrolls_change', 'jobs'),
      policyRateSurprisePp: surpriseFor('target_rate_upper', 'percent'),
      reactionBtcPct: null,
      reactionRelativePct: null,
      reactionBreadth: null,
    },
  };
}

/** Anchors use the close immediately before release and the first entirely post-release close. */
export function newsReactionWindow(snapshot: NewsContext) {
  if (snapshot.features.minutesSinceRelease === null) return null;
  const release =
    snapshot.asOf - snapshot.features.minutesSinceRelease * minute;
  const before =
    Math.floor(release / NEWS_REACTION_BAR) * NEWS_REACTION_BAR -
    NEWS_REACTION_BAR;
  const after = Math.ceil(release / NEWS_REACTION_BAR) * NEWS_REACTION_BAR;
  return after + NEWS_REACTION_BAR <= snapshot.asOf ? { before, after } : null;
}
