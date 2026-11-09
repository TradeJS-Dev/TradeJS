import { readTickerProfiles } from '@tradejs/infra/tickerProfiles';
import {
  isTickerProfileSnapshot,
  tickerProfileMonth,
} from '@tradejs/core/tickerProfiles';
import type { Signal, TickerProfileContext } from '@tradejs/types';
import { getTradejsProjectCwd } from '../tradejsConfig';
import { getStrategyManifest } from '../strategy/manifests';

type ProfileSource = { provider: string; universeId: string };
type CachedProfiles = {
  expires: number;
  value: Promise<Map<string, TickerProfileContext> | null>;
};
const snapshots = new Map<string, CachedProfiles>();
export const resetTickerProfileCache = () => snapshots.clear();
export const resolveTickerProfileSource = (
  strategy: string,
): ProfileSource | undefined => {
  const declared =
    getStrategyManifest(strategy)?.contextRequirements?.tickerProfiles;
  if (declared) return declared;
  const provider = process.env.TICKER_PROFILES_PROVIDER?.trim();
  const universeId = process.env.TICKER_PROFILES_UNIVERSE?.trim();
  if (!provider && !universeId) return undefined;
  if (!provider || !universeId)
    throw new Error(
      'Set both TICKER_PROFILES_PROVIDER and TICKER_PROFILES_UNIVERSE',
    );
  return { provider, universeId };
};
export const loadTickerProfileContext = async ({
  projectRoot,
  provider,
  universeId,
  symbol,
  timestamp,
}: ProfileSource & {
  projectRoot: string;
  symbol: string;
  timestamp: number;
}): Promise<TickerProfileContext | undefined> => {
  const asOf = tickerProfileMonth(timestamp),
    key = JSON.stringify([projectRoot, provider, universeId, asOf]);
  let cached = snapshots.get(key);
  if (!cached || cached.expires < Date.now()) {
    const value = readTickerProfiles(projectRoot, provider, universeId, asOf)
      .then((envelope) => {
        if (!envelope) return null;
        const s = envelope.snapshot;
        if (
          !isTickerProfileSnapshot(s) ||
          s.asOf !== asOf ||
          s.provider !== provider ||
          s.universeId !== universeId
        )
          throw new Error('Ticker profile identity/schema mismatch');
        const entry = snapshots.get(key);
        if (entry) entry.expires = Infinity; // Immutable successful snapshots never change.
        return new Map(
          s.profiles.map((p) => [
            p.symbol,
            Object.freeze({
              ...p,
              definition: s.definition,
              provider,
              universeId,
              snapshotId: envelope.snapshotId,
            }),
          ]),
        );
      })
      .catch((error) => {
        snapshots.delete(key);
        throw error;
      });
    cached = { expires: Date.now() + 60_000, value };
    snapshots.set(key, cached);
    if (snapshots.size > 24) {
      const oldest = snapshots.keys().next().value;
      if (oldest) snapshots.delete(oldest);
    }
  }
  return (await cached.value)?.get(symbol);
};
/** Preserve lazy context properties and never mutate a shared replay context. */
export const withTickerProfile = <T extends object>(
  baseContext: T,
  profile: TickerProfileContext,
): T & { tickerProfile: TickerProfileContext } =>
  Object.defineProperty(
    Object.create(
      Object.getPrototypeOf(baseContext),
      Object.getOwnPropertyDescriptors(baseContext),
    ),
    'tickerProfile',
    { enumerable: true, configurable: true, value: profile },
  );

export const enrichSignalWithTickerProfile = async (
  signal: Signal,
): Promise<void> => {
  const source = resolveTickerProfileSource(signal.strategy);
  if (
    !source ||
    signal.universe === 'tradfi' ||
    !signal.symbol.endsWith('USDT')
  )
    return;
  const profile = await loadTickerProfileContext({
    ...source,
    projectRoot: getTradejsProjectCwd(),
    symbol: signal.symbol,
    timestamp: signal.timestamp,
  });
  if (profile) {
    signal.additionalIndicators = {
      ...signal.additionalIndicators,
      tickerProfile: profile,
    };
  }
};
