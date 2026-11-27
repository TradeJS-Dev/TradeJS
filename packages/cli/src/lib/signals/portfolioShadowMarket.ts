import {
  createStrategyRuntime,
  withReplayStrategyManifests,
} from '@tradejs/node/strategies';
import { runWithConcurrency } from '@tradejs/core/async';
import { logger } from '@tradejs/infra/logger';
import type {
  Connector,
  Interval,
  KlineChartData,
  PortfolioChildRuntime,
  PortfolioPolicyConfig,
  RuntimeLineage,
  PortfolioChildStrategy,
  PortfolioStrategyEntry,
  StrategyConfig,
} from '@tradejs/types';
import { alignSymbolWithBtcReference } from '../marketData/windows';
import { toPortfolioCandidate } from '../portfolio/candidate';
import {
  portfolioShadowStep,
  type PortfolioShadowMarket,
} from './portfolioShadowCycle';
import type {
  LivePortfolioMarket,
  LivePortfolioOffer,
} from './portfolioLiveCycle';

const historyMs = 30 * 86_400_000;
const unavailable = async () => {
  throw new Error('Exchange execution is disabled in portfolio shadow');
};

export const withoutShadowOrders = (connector: Connector): Connector => ({
  ...connector,
  placeOrder: unavailable,
  closePosition: unavailable,
  ...(connector.cancelEntryOrder ? { cancelEntryOrder: unavailable } : {}),
  ...(connector.setPositionProtection
    ? { setPositionProtection: unavailable }
    : {}),
  setTakeProfits: unavailable,
  setStopLoss: unavailable,
});

interface PortfolioMarketInput {
  entry: PortfolioStrategyEntry;
  config: StrategyConfig;
  symbols: readonly string[];
  marketConnector: Connector;
  connectorName: string;
  userName: string;
  closedAt: number;
  cacheOnly: boolean;
}

interface LiveOptions {
  accountId: string;
  deploymentId: string;
  lineage: RuntimeLineage;
  entriesPaused: boolean;
  concurrency: number;
  pending: readonly LivePortfolioOffer[];
}

export async function loadPortfolioShadowMarket(
  input: PortfolioMarketInput,
): Promise<PortfolioShadowMarket> {
  return (await loadPortfolioMarket(input)).shadow;
}

export async function loadPortfolioLiveMarket(
  input: PortfolioMarketInput,
  live: LiveOptions,
): Promise<LivePortfolioMarket> {
  return (await loadPortfolioMarket(input, live)).live;
}

async function loadPortfolioMarket(
  {
    entry,
    config,
    symbols,
    marketConnector,
    connectorName,
    userName,
    closedAt,
    cacheOnly,
  }: PortfolioMarketInput,
  live?: LiveOptions,
): Promise<{ shadow: PortfolioShadowMarket; live: LivePortfolioMarket }> {
  const children = entry.resolveChildren(config);
  const manifests = children.map(({ entry }) => entry);
  const names = manifests.map(({ manifest }) => manifest.name);
  if (!names.length || new Set(names).size !== names.length)
    throw new Error('Expected unique portfolio children');
  const due = children.filter(
    ({ config, entry: child }) =>
      closedAt % intervalMs(config) === 0 ||
      live?.pending.some(
        ({ candidate }) => candidate.strategy === child.manifest.name,
      ),
  );
  const policy: PortfolioPolicyConfig = {
    id: `portfolio-${entry.manifest.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    scope: 'account',
    riskUnit: 1,
    maxPositions: entry.execution.maxPositions,
    observationIntervalMs: portfolioShadowStep,
    maxPriceAgeMs: portfolioShadowStep,
  };
  const intervals = new Set<Interval>([
    '15',
    ...due.map(({ config }) => String(config.INTERVAL) as Interval),
  ]);
  const tables = new Map<Interval, Map<string, KlineChartData>>();
  const lookups = new Map<string, Map<number, KlineChartData[number]>>();
  const marketSymbols = [...new Set([...symbols, 'BTCUSDT', 'ETHUSDT'])];
  for (const interval of intervals) {
    const table = new Map<string, KlineChartData>();
    tables.set(interval, table);
    const duration = Number(interval) * 60_000;
    const required = Math.floor(closedAt / duration) * duration - duration;
    await runWithConcurrency(
      marketSymbols,
      live?.concurrency ?? 1,
      async (symbol) => {
        const candles = await marketConnector.kline({
          symbol,
          interval,
          start: closedAt - historyMs,
          end: closedAt + 1,
          cacheOnly,
          silent: true,
        });
        if (interval === '15')
          lookups.set(
            symbol,
            new Map(candles.map((candle) => [candle.timestamp, candle])),
          );
        if (!candles.some((candle) => candle.timestamp === required)) {
          if (!live || symbol === 'BTCUSDT' || symbol === 'ETHUSDT') {
            throw new Error(
              `Missing closed ${interval}m candle for ${symbol} at ${closedAt}`,
            );
          }
          return;
        }
        table.set(symbol, candles);
      },
    );
    const missing = marketSymbols.filter((symbol) => !table.has(symbol));
    if (missing.length) {
      logger.warn(
        'Portfolio %s skipped %d symbols without a closed %sm candle at %s: %s',
        live?.deploymentId,
        missing.length,
        interval,
        closedAt,
        missing.join(', '),
      );
    }
  }
  const candidates: Array<PortfolioShadowMarket['candidates'][number]> = [];
  const offers: LivePortfolioOffer[] = [];
  const childrenBySymbol = new Map<
    string,
    {
      runtime: PortfolioChildRuntime;
      candle: KlineChartData[number];
      btcCandle: KlineChartData[number];
    }
  >();
  const runtimeKey = (strategy: string, symbol: string) =>
    JSON.stringify([strategy, symbol]);
  await withReplayStrategyManifests(manifests, async () => {
    for (const child of due) {
      const { entry: definition, config: childConfig } = child;
      const interval = String(childConfig.INTERVAL) as Interval;
      const runtimeConfig = {
        ...childConfig,
        ENV: live ? 'CRON' : 'PARITY',
        MAKE_ORDERS: true,
        PORTFOLIO_POLICY: undefined,
        ...(live
          ? {
              RECORD_RUNTIME_TRADES: true,
              RISK_FEE_RATE: Math.max(
                Number(childConfig.RISK_FEE_RATE ?? 0),
                entry.execution.feeRate,
              ),
              RISK_SLIPPAGE_BPS: Math.max(
                Number(childConfig.RISK_SLIPPAGE_BPS ?? 0),
                entry.execution.slippageBps,
              ),
            }
          : {}),
      };
      const table = tables.get(interval)!;
      const duration = intervalMs(childConfig);
      const lastAt = Math.floor(closedAt / duration) * duration - duration;
      const alignedEth = new Map(
        table
          .get('ETHUSDT')!
          .filter((candle) => candle.timestamp <= lastAt)
          .map((candle) => [candle.timestamp, candle]),
      );
      const btc = table
        .get('BTCUSDT')!
        .filter((candle) => candle.timestamp <= lastAt);
      const create = createStrategyRuntime({
        strategyName: definition.manifest.name,
        defaults: definition.defaults,
        createCore: definition.createCore,
        manifest: definition.manifest,
      });
      await runWithConcurrency(
        [...symbols],
        live?.concurrency ?? 1,
        async (symbol) => {
          const candles = table.get(symbol);
          if (!candles || !tables.get('15')!.has(symbol)) return;
          const strategy = definition.manifest.name;
          const shouldEvaluate = closedAt % duration === 0;
          if (
            !shouldEvaluate &&
            !live?.pending.some(
              ({ candidate }) =>
                candidate.strategy === strategy && candidate.symbol === symbol,
            )
          )
            return;
          const { alignedCoinCandles, alignedBtcCandles } =
            alignSymbolWithBtcReference(
              candles.filter((candle) => candle.timestamp <= lastAt),
              btc,
            );
          const candle = alignedCoinCandles.at(-1);
          const btcCandle = alignedBtcCandles.at(-1);
          const ethCandle = alignedEth.get(lastAt);
          if (
            candle?.timestamp !== lastAt ||
            btcCandle?.timestamp !== lastAt ||
            !ethCandle
          )
            return;
          const connector = live
            ? marketConnector
            : createReadOnlySimulation(marketConnector, closedAt, cacheOnly);
          const run = await create({
            symbol,
            userName,
            connectorName,
            connector,
            universe: 'crypto',
            assetClass: 'crypto',
            config: runtimeConfig,
            ...(live
              ? {
                  accountId: live.accountId,
                  deploymentId: live.deploymentId,
                  entriesPaused: live.entriesPaused,
                  strategyRevision: live.lineage.strategyRevision,
                  runtimeConfigId: `portfolio:${entry.manifest.name}`,
                  runtimeLineage: live.lineage,
                  sharedStrategyStateKey: JSON.stringify([
                    live.deploymentId,
                    live.accountId,
                    live.lineage.strategyRevision,
                    symbol,
                    interval,
                  ]),
                  portfolioLive: {
                    policy,
                    offer(prepared) {
                      const candidate = toPortfolioCandidate(
                        { ...prepared, signal: prepared.decision.signal },
                        strategy,
                        symbol,
                      );
                      if (
                        Number.isFinite(candidate.stop) &&
                        candidate.stop > 0 &&
                        candidate.targets.every(
                          (price) => Number.isFinite(price) && price > 0,
                        )
                      ) {
                        offers.push({
                          candidate,
                          prepared,
                          minNetRewardToRisk:
                            Number(
                              childConfig[candidate.direction]?.minRiskRatio,
                            ) || 0,
                        });
                      }
                    },
                  },
                }
              : { portfolioShadow: true as const }),
            runtimeConfigSnapshot: { userConfig: live ? runtimeConfig : {} },
            data: alignedCoinCandles.slice(0, -1),
            btcData: alignedBtcCandles.slice(0, -1),
            ethData: alignedCoinCandles
              .slice(0, -1)
              .flatMap((item) => alignedEth.get(item.timestamp) ?? []),
            selectReplayEntry: live
              ? undefined
              : async (captured) => {
                  const strategy = definition.manifest.name;
                  const proposal = toPortfolioCandidate(
                    captured,
                    strategy,
                    symbol,
                  );
                  if (
                    Number.isFinite(proposal.stop) &&
                    proposal.stop > 0 &&
                    proposal.targets.every(
                      (price) => Number.isFinite(price) && price > 0,
                    )
                  ) {
                    candidates.push({
                      candidate: {
                        ...proposal,
                        id: JSON.stringify([
                          strategy,
                          symbol,
                          proposal.direction,
                          closedAt,
                        ]),
                      },
                      minNetRewardToRisk:
                        Number(childConfig[proposal.direction]?.minRiskRatio) ||
                        0,
                    });
                  }
                  return false;
                },
          });
          if (live)
            childrenBySymbol.set(runtimeKey(strategy, symbol), {
              runtime: run as PortfolioChildRuntime,
              candle,
              btcCandle,
            });
          if (shouldEvaluate) await run(candle, btcCandle, ethCandle);
        },
      );
    }
  });
  if (live) {
    await childrenBySymbol.values().next().value?.runtime.reconcilePortfolio();
  }
  const market = {
    candle: (symbol: string, ago: number) =>
      lookups.get(symbol)?.get(closedAt - (ago + 1) * portfolioShadowStep),
  };
  return {
    shadow: {
      candidates,
      market,
      openingPrice: (symbol) => lookups.get(symbol)?.get(closedAt)?.open,
    },
    live: {
      offers,
      market,
      async openingPrice({ strategy, symbol, direction }) {
        if (!childrenBySymbol.has(runtimeKey(strategy, symbol))) return;
        const quote = await marketConnector.getTopOfBookTicker?.(symbol);
        const time = Date.now();
        if (
          !quote?.timestamp ||
          quote.timestamp < closedAt ||
          Math.abs(time - quote.timestamp) > 30_000 ||
          quote.askPrice < quote.bidPrice
        )
          return undefined;
        return direction === 'LONG' ? quote.askPrice : quote.bidPrice;
      },
      async submit({ candidate, prepared }, confirmation) {
        if (Date.now() >= closedAt + portfolioShadowStep)
          return 'PORTFOLIO_BOUNDARY_EXPIRED';
        const child = childrenBySymbol.get(
          runtimeKey(candidate.strategy, candidate.symbol),
        );
        if (!child) return 'PORTFOLIO_CHILD_UNAVAILABLE';
        const candle = confirmation
          ? market.candle(candidate.symbol, 0)
          : child.candle;
        const btcCandle = confirmation
          ? market.candle('BTCUSDT', 0)
          : child.btcCandle;
        if (!candle || !btcCandle) return 'PORTFOLIO_MARKET_UNAVAILABLE';
        return withReplayStrategyManifests(manifests, () =>
          child.runtime.submitPortfolioEntry({
            offer: prepared,
            candle,
            btcCandle,
            confirmation,
          }),
        );
      },
    },
  };
}

function intervalMs(config: PortfolioChildStrategy['config']) {
  const minutes = Number(config.INTERVAL);
  if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes % 15) {
    throw new Error(
      'Portfolio shadow requires child intervals that are multiples of M15',
    );
  }
  return minutes * 60_000;
}

function createReadOnlySimulation(
  market: Connector,
  closedAt: number,
  cacheOnly: boolean,
) {
  let state = {};
  const connector: Connector & { __tradejsTestConnector: true } = {
    __tradejsTestConnector: true,
    capabilities: { supportedUniverses: ['crypto'], defaultUniverse: 'crypto' },
    universe: 'crypto',
    getState: async () => state,
    setState: async (next) => {
      state = next;
    },
    kline: (options) =>
      market.kline({
        ...options,
        end: Math.min(options.end, closedAt - 1),
        cacheOnly,
      }),
    getTickers: async () => [],
    listInstruments: async () => [],
    getPosition: async () => null,
    getPositions: async () => [],
    placeOrder: unavailable,
    setStopLoss: unavailable,
    setTakeProfits: unavailable,
    closePosition: unavailable,
  };
  return connector;
}
