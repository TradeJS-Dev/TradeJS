import assert from 'node:assert/strict';
import {
  createDiskBacktestHistory,
  createTestConnector,
} from '@tradejs/node/backtest';
import {
  createStrategyRuntime,
  releaseStrategyIndicatorsReplayCache,
  releaseStrategyReplayCache,
  withReplayStrategyManifests,
} from '@tradejs/node/strategies';
import type {
  Connector,
  Direction,
  PortfolioEntryBatch,
  PortfolioEntryCandidate,
  PortfolioStrategyEntry,
  Signal,
  Strategy,
  StrategyConfig,
  StrategyCreatorParams,
} from '@tradejs/types';
import {
  choosePortfolioEntries,
  validatePortfolioSelection,
} from './portfolioSelection';
import {
  openPortfolioSnapshot,
  visiblePortfolioHistory,
} from './portfolioSnapshot';

type Capture = Parameters<
  NonNullable<StrategyCreatorParams['selectReplayEntry']>
>[0];
type TestConnector = ReturnType<typeof createTestConnector>;
type Offer = {
  runtime: ChildRuntime;
  captured: Capture;
  candidate: PortfolioEntryCandidate;
};
type ChildRuntime = {
  name: string;
  symbol: string;
  ratio: number;
  availableAt: number;
  executionTime: number;
  test: TestConnector;
  run: Strategy;
  minimumRR: Readonly<Record<Direction, number>>;
  capture?: (entry: Offer) => Promise<boolean>;
  position?: { signalId: string; delayed: boolean; risk: number };
};

export interface PortfolioReplayWindow {
  symbols: readonly string[];
  activeFrom: Readonly<Record<string, number>>;
  start: number;
  end: number;
  warmupBars: number;
}

const step = 15 * 60_000;

const unavailable = async () => {
  throw new Error('Operation outside portfolio simulation');
};
const offlineConnector: Connector = {
  universe: 'crypto',
  capabilities: { supportedUniverses: ['crypto'], defaultUniverse: 'crypto' },
  listInstruments: async () => [],
  getTickers: async () => [],
  kline: unavailable,
  getState: unavailable,
  setState: unavailable,
  getPosition: unavailable,
  getPositions: unavailable,
  placeOrder: unavailable,
  setTakeProfits: unavailable,
  setStopLoss: unavailable,
  closePosition: unavailable,
};

function toCandidate(
  { signal, decision, reason, approved }: Capture,
  strategy: string,
  symbol: string,
): PortfolioEntryCandidate {
  const analysis = signal.aiAnalysis;
  return {
    id: signal.signalId,
    strategy,
    symbol,
    direction: decision.entryContext.direction,
    stop: decision.orderPlan.stopLossPrice,
    targets: decision.orderPlan.takeProfits.map(({ price }) => price),
    gate: {
      approved,
      reason,
      rawQuality: analysis?.quality ?? null,
      explicitHardBlock:
        Boolean(
          analysis &&
            'structuralHardBlockReasons' in analysis &&
            Array.isArray(analysis.structuralHardBlockReasons) &&
            analysis.structuralHardBlockReasons.length,
        ) ||
        /\bhard[- _]?block\b/i.test(
          JSON.stringify(analysis?.qualityReason ?? ''),
        ),
    },
  };
}

export async function replayPortfolioStrategy({
  entry,
  config,
  userName,
  connectorName,
  snapshotDirectory,
  window,
  progress,
}: {
  entry: PortfolioStrategyEntry;
  config: StrategyConfig;
  userName: string;
  connectorName: string;
  snapshotDirectory: string;
  window: PortfolioReplayWindow;
  progress?: (event: { time: number; offered: number; filled: number }) => void;
}) {
  const children = entry.resolveChildren(config);
  return withReplayStrategyManifests(
    children.map(({ entry }) => entry),
    async () => {
      const names = children.map(({ entry: child }) => child.manifest.name);
      assert.ok(
        names.length > 0 && new Set(names).size === names.length,
        'Expected unique child strategies',
      );
      const { start, end, symbols, activeFrom, warmupBars } = window;
      assert.ok(start < end && start % step === 0 && end % step === 0);
      assert.ok(
        new Set(symbols).size === symbols.length &&
          symbols.includes('BTCUSDT') &&
          symbols.includes('ETHUSDT'),
      );
      const tape = openPortfolioSnapshot(snapshotDirectory, symbols);
      const history = createDiskBacktestHistory(snapshotDirectory);
      const replayKey = `portfolio-replay:${entry.manifest.name}:${start}:${end}`;
      const { feeRate, slippageBps, maxPositions } = entry.execution;
      try {
        const primary = tape.candles(15);
        const tables = new Map([[15, primary]]);
        const first = (start - primary.first) / step;
        const last = (end - primary.first) / step;
        assert.ok(
          first >= warmupBars && last <= primary.series.get('BTCUSDT')!.length,
          'Replay exceeds snapshot coverage',
        );
        const marketBar = (symbol: string, index: number, interval = 15) =>
          tables.get(interval)?.series.get(symbol)?.at(index);
        const funding = new Map(
          symbols.map((symbol) => [
            symbol,
            tape.funding(symbol, Math.max(start, activeFrom[symbol]), end),
          ]),
        );
        const starting = new Map<number, ChildRuntime[]>();
        const all: ChildRuntime[] = [];

        for (const { entry: child, config: childConfig } of children) {
          const name = child.manifest.name;
          const interval = Number(childConfig.INTERVAL);
          const ratio = interval / 15;
          assert.ok(
            Number.isSafeInteger(ratio) &&
              ratio > 0 &&
              warmupBars % ratio === 0,
            name,
          );
          if (!tables.has(interval))
            tables.set(interval, tape.candles(interval));
          const table = tables.get(interval)!;
          assert.equal(table.first, primary.first, name);
          const executionConfig = child.parseConfig({
            ...childConfig,
            ENV: 'PARITY',
            MAKE_ORDERS: true,
          });
          const create = createStrategyRuntime({
            strategyName: name,
            defaults: child.defaults,
            createCore: child.createCore,
            manifest: child.manifest,
            detectorKey: child.detectorKey,
            detectorNoSignalSkipReason: child.detectorNoSignalSkipReason,
          });

          for (const symbol of symbols) {
            const availableAt = Math.max(start, activeFrom[symbol]);
            assert.ok(
              Number.isSafeInteger(availableAt) &&
                availableAt % (interval * 60_000) === 0,
              symbol,
            );
            if (availableAt >= end) continue;
            const ready = (availableAt - primary.first) / step;
            const warm = (key: string) =>
              visiblePortfolioHistory(
                table.series.get(key)!,
                (ready - warmupBars) / ratio,
                ready / ratio,
              );
            const rates = funding.get(symbol)!;
            const test = createTestConnector(offlineConnector, {
              aiEnabled: true,
              fastMode: true,
              fundingRates: rates,
              executionCostModel: {
                fees: {
                  makerRate: feeRate,
                  takerRate: feeRate,
                  source: 'config',
                },
                slippage: {
                  baseBps: slippageBps,
                  spreadMultiplier: 0,
                  marketImpactBps: 0,
                  delayRiskMultiplier: 0,
                  source: 'config',
                },
                funding: {
                  enabled: true,
                  source: 'historical',
                  points: rates.length,
                },
                leverage: {
                  requested: executionConfig.LEVERAGE,
                  effective: executionConfig.LEVERAGE,
                  maxAllowed: null,
                },
                quality: 'full',
                capturedAt: 0,
              },
            });
            const runtime: ChildRuntime = {
              name,
              symbol,
              ratio,
              availableAt,
              test,
              executionTime: availableAt,
              minimumRR: {
                LONG: Number(executionConfig.LONG?.minRiskRatio),
                SHORT: Number(executionConfig.SHORT?.minRiskRatio),
              },
              run: await create({
                userName,
                connectorName,
                symbol,
                universe: 'crypto',
                assetClass: 'crypto',
                config: executionConfig,
                policyProfileId: executionConfig.POLICY_PROFILE_ID,
                runtimeConfigSnapshot: { userConfig: {} },
                sharedIndicatorsReplayKey: `${replayKey}:${symbol}:${interval}`,
                backtestHistory: history,
                data: warm(symbol),
                btcData: warm('BTCUSDT'),
                ethData: warm('ETHUSDT'),
                connector: test,
                async selectReplayEntry(captured) {
                  const candidate = toCandidate(captured, name, symbol);
                  return runtime.capture!({ candidate, captured, runtime });
                },
              }),
            };
            if (ratio > 1) {
              const { placeOrder, closePosition } = test;
              test.placeOrder = (order) =>
                placeOrder({
                  ...order,
                  timestamp: Math.max(order.timestamp, runtime.executionTime),
                });
              test.closePosition = (order) =>
                closePosition({
                  ...order,
                  timestamp: Math.max(order.timestamp, runtime.executionTime),
                });
            }
            const existing = starting.get(ready);
            if (existing) existing.push(runtime);
            else starting.set(ready, [runtime]);
            all.push(runtime);
          }
        }

        const trades: {
          strategy: string;
          symbol: string;
          direction: Direction;
          entry: number;
          exit: number;
          pnl: number;
          funding: number;
          slippage: number;
          fee: number;
          qty: number;
          entryPrice: number;
          requestedRisk: number;
          exception: boolean;
          delayed: boolean;
          earlyExit: boolean;
        }[] = [];
        const pending = new Map<number, Offer[]>();
        const live: ChildRuntime[] = [];
        const occupied = new Set<string>();
        let offered = 0;
        let filled = 0;
        let delayedFilled = 0;
        let maxOpenPositions = 0;

        const collect = async (runtime: ChildRuntime) => {
          for (const record of await runtime.test.drainMlResultsBatch()) {
            const result = record.tradeResult;
            const position = runtime.position;
            assert.ok(
              result && position && record.signalId === position.signalId,
              'Exit without matching candidate',
            );
            runtime.position = undefined;
            occupied.delete(runtime.symbol);
            trades.push({
              strategy: runtime.name,
              symbol: runtime.symbol,
              direction: result.direction,
              entry: result.entryTimestamp,
              exit: result.exitTimestamp,
              pnl: result.netProfit,
              funding: result.fundingFee ?? 0,
              slippage: result.totalSlippageCost ?? 0,
              fee: result.openFee + result.closeFee,
              qty: result.qty,
              entryPrice: result.entryPrice,
              requestedRisk: position.risk,
              exception: position.delayed,
              delayed: position.delayed,
              earlyExit: false,
            });
          }
        };
        const claim = (
          runtime: ChildRuntime,
          signal: Signal,
          risk: number,
          delayed: boolean,
        ) => {
          assert.ok(
            !occupied.has(runtime.symbol) && occupied.size < maxPositions,
          );
          occupied.add(runtime.symbol);
          runtime.position = { signalId: signal.signalId, risk, delayed };
          filled++;
          if (delayed) delayedFilled++;
        };
        const checkCapacity = (symbol: string) =>
          occupied.size < maxPositions && !occupied.has(symbol);

        for (let index = first; index < last; index++) {
          const newlyListed = starting.get(index);
          if (newlyListed) live.push(...newlyListed);
          const time = primary.first + index * step;
          const due = pending.get(time);
          pending.delete(time);
          for (const { captured, candidate, runtime } of due ?? []) {
            const candle = marketBar(runtime.symbol, index - 1)!;
            const openingPrice = marketBar(runtime.symbol, index)!.open;
            const sized = entry.confirmEntry({
              candidate,
              candle,
              openingPrice,
              minNetRewardToRisk: runtime.minimumRR[candidate.direction],
            });
            if (!sized || !checkCapacity(runtime.symbol)) continue;
            assert.ok(
              Number.isFinite(sized.qty) &&
                sized.qty > 0 &&
                Number.isFinite(sized.risk) &&
                sized.risk > 0,
            );
            const { signal, decision } = captured;
            assert.ok(
              await runtime.test.placeOrder({
                symbol: runtime.symbol,
                price: openingPrice,
                qty: sized.qty,
                direction: candidate.direction,
                timestamp: time,
                signal,
              }),
            );
            assert.ok(
              await runtime.test.setTakeProfits({
                symbol: runtime.symbol,
                direction: candidate.direction,
                takeProfits: decision.orderPlan.takeProfits,
              }),
            );
            assert.ok(
              await runtime.test.setStopLoss({
                symbol: runtime.symbol,
                direction: candidate.direction,
                stopLossPrice: candidate.stop,
              }),
            );
            claim(runtime, signal, sized.risk, true);
          }
          for (const runtime of live) {
            if (!runtime.position) continue;
            await runtime.test.checkExits(marketBar(runtime.symbol, index)!);
            await collect(runtime);
          }

          if (index < last - 1) {
            await choosePortfolioEntries<string | Signal, Offer>(
              live
                .filter((runtime) => (index + 1) % runtime.ratio === 0)
                .map((runtime) => async (capture) => {
                  const barIndex = (index + 1) / runtime.ratio - 1;
                  const at = (symbol: string) =>
                    marketBar(symbol, barIndex, runtime.ratio * 15)!;
                  runtime.capture = capture;
                  runtime.executionTime = time;
                  try {
                    return await runtime.run(
                      at(runtime.symbol),
                      at('BTCUSDT'),
                      at('ETHUSDT'),
                    );
                  } finally {
                    runtime.capture = undefined;
                  }
                }),
              async (offers) => {
                if (!offers.length) return;
                for (const runtime of live) {
                  if (
                    runtime.position &&
                    !(await runtime.test.getPosition(runtime.symbol))
                  ) {
                    await collect(runtime);
                  }
                }
                const batch: PortfolioEntryBatch = {
                  closedAt: time + step,
                  candidates: offers.map(({ entry: offer }) => offer.candidate),
                  market: {
                    candle: (symbol, barsAgo) =>
                      Number.isSafeInteger(barsAgo) && barsAgo >= 0
                        ? marketBar(symbol, index - barsAgo)
                        : undefined,
                  },
                };
                const selection = entry.selectEntries(batch);
                validatePortfolioSelection(batch, selection, step);
                offered += selection.ranked.length + selection.pending.length;
                const byId = new Map(
                  offers.map((offer) => [offer.entry.candidate.id, offer]),
                );
                assert.equal(
                  byId.size,
                  offers.length,
                  'Duplicate signal identity',
                );
                for (const { candidateId, confirmAt } of selection.pending) {
                  if (confirmAt >= end) continue;
                  if (!pending.has(confirmAt)) pending.set(confirmAt, []);
                  pending.get(confirmAt)!.push(byId.get(candidateId)!.entry);
                }
                for (const id of selection.ranked) {
                  const offer = byId.get(id)!;
                  const {
                    runtime,
                    captured: { signal },
                  } = offer.entry;
                  if (!checkCapacity(runtime.symbol)) continue;
                  assert.equal(
                    await runtime.test.getPosition(runtime.symbol),
                    null,
                  );
                  const outcome = await offer.submit();
                  if (await runtime.test.getPosition(runtime.symbol)) {
                    claim(
                      runtime,
                      signal,
                      Number(config.MAX_LOSS_VALUE),
                      false,
                    );
                  } else if (
                    typeof outcome !== 'string' &&
                    outcome.orderStatus === 'completed'
                  ) {
                    throw new Error(`Completed without a position: ${id}`);
                  }
                }
              },
            );
          }
          maxOpenPositions = Math.max(maxOpenPositions, occupied.size);
          if ((index - first + 1) % (7 * 96) === 0)
            progress?.({ time, offered, filled });
        }

        for (const runtime of all) {
          const position = await runtime.test.getPosition(runtime.symbol);
          if (!position) continue;
          const candle = marketBar(runtime.symbol, last - 1)!;
          await runtime.test.closePosition({
            ...position,
            timestamp: candle.timestamp,
            price: candle.close,
          });
          await collect(runtime);
        }
        assert.equal(trades.length, filled);
        trades.sort(
          (a, b) =>
            a.exit - b.exit ||
            a.entry - b.entry ||
            a.symbol.localeCompare(b.symbol),
        );
        return {
          start,
          end,
          symbols,
          strategy: entry.manifest.name,
          trades,
          stats: { filled, delayedFilled, maxOpenPositions },
        };
      } finally {
        releaseStrategyIndicatorsReplayCache(replayKey);
        releaseStrategyReplayCache(replayKey);
        history.close();
        tape.close();
      }
    },
  );
}
