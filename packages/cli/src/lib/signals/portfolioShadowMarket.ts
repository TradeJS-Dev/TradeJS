import {
  createStrategyRuntime,
  withReplayStrategyManifests,
} from '@tradejs/node/strategies';
import type {
  Connector,
  Interval,
  KlineChartData,
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

export async function loadPortfolioShadowMarket({
  entry,
  config,
  symbols,
  marketConnector,
  connectorName,
  userName,
  closedAt,
  cacheOnly,
}: {
  entry: PortfolioStrategyEntry;
  config: StrategyConfig;
  symbols: readonly string[];
  marketConnector: Connector;
  connectorName: string;
  userName: string;
  closedAt: number;
  cacheOnly: boolean;
}): Promise<PortfolioShadowMarket> {
  const children = entry.resolveChildren(config);
  const due = children.filter(
    ({ config }) => closedAt % intervalMs(config) === 0,
  );
  const intervals = new Set<Interval>([
    '15',
    ...due.map(({ config }) => String(config.INTERVAL) as Interval),
  ]);
  const tables = new Map<Interval, Map<string, KlineChartData>>();
  const lookups = new Map<string, Map<number, KlineChartData[number]>>();
  for (const interval of intervals) {
    const table = new Map<string, KlineChartData>();
    tables.set(interval, table);
    for (const symbol of new Set([...symbols, 'BTCUSDT', 'ETHUSDT'])) {
      const candles = await marketConnector.kline({
        symbol,
        interval,
        start: closedAt - historyMs,
        end: closedAt + 1,
        cacheOnly,
        silent: true,
      });
      table.set(symbol, candles);
      if (interval === '15')
        lookups.set(
          symbol,
          new Map(candles.map((candle) => [candle.timestamp, candle])),
        );
      const required = closedAt - Number(interval) * 60_000;
      if (!candles.some((candle) => candle.timestamp === required)) {
        throw new Error(
          `Missing closed ${interval}m candle for ${symbol} at ${closedAt}`,
        );
      }
    }
  }
  const candidates: Array<PortfolioShadowMarket['candidates'][number]> = [];
  await withReplayStrategyManifests(
    children.map(({ entry }) => entry),
    async () => {
      for (const child of due) {
        const { entry: definition, config: childConfig } = child;
        const interval = String(childConfig.INTERVAL) as Interval;
        const table = tables.get(interval)!;
        const lastAt = closedAt - intervalMs(childConfig);
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
        for (const symbol of symbols) {
          const { alignedCoinCandles, alignedBtcCandles } =
            alignSymbolWithBtcReference(
              table.get(symbol)!.filter((candle) => candle.timestamp <= lastAt),
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
            continue;
          const connector = createReadOnlySimulation(
            marketConnector,
            closedAt,
            cacheOnly,
          );
          const run = await create({
            symbol,
            userName,
            connectorName,
            connector,
            universe: 'crypto',
            assetClass: 'crypto',
            config: {
              ...childConfig,
              ENV: 'PARITY',
              MAKE_ORDERS: true,
              PORTFOLIO_POLICY: undefined,
            },
            portfolioShadow: true,
            runtimeConfigSnapshot: { userConfig: {} },
            data: alignedCoinCandles.slice(0, -1),
            btcData: alignedBtcCandles.slice(0, -1),
            ethData: alignedCoinCandles
              .slice(0, -1)
              .flatMap((item) => alignedEth.get(item.timestamp) ?? []),
            selectReplayEntry: async (captured) => {
              const strategy = definition.manifest.name;
              const proposal = toPortfolioCandidate(captured, strategy, symbol);
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
                    Number(childConfig[proposal.direction]?.minRiskRatio) || 0,
                });
              }
              return false;
            },
          });
          await run(candle, btcCandle, ethCandle);
        }
      }
    },
  );
  return {
    candidates,
    market: {
      candle: (symbol, ago) =>
        lookups.get(symbol)?.get(closedAt - (ago + 1) * portfolioShadowStep),
    },
    openingPrice: (symbol) => lookups.get(symbol)?.get(closedAt)?.open,
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
