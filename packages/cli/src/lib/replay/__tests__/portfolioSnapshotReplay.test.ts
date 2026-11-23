import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { PortfolioStrategyEntry, StrategyConfig } from '@tradejs/types';
import {
  openPortfolioSnapshot,
  visiblePortfolioHistory,
} from '../portfolioSnapshot';
import { runPortfolioDeployment } from '../runPortfolioDeployment';

jest.mock(
  '../../../../../node/src/strategyHelpers/marketContextStages',
  () => ({
    enrichSignalWithMarketContextStages: async () => [],
  }),
);

const step = 15 * 60_000;
const first = Date.UTC(2025, 0, 1);
const start = first + 4 * step;
const end = first + 12 * step;
const symbols = ['BTCUSDT', 'ETHUSDT'];
const window = {
  symbols,
  activeFrom: { BTCUSDT: start, ETHUSDT: start },
  warmupBars: 4,
  start,
  end,
};
let projectRoot: string;
const folder = 'snapshot';

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), 'portfolio-snapshot-'));
  const directory = path.join(projectRoot, folder);
  const funding = path.join(directory, 'funding');
  await mkdir(funding, { recursive: true });
  await writeFile(path.join(directory, 'window.json'), JSON.stringify(window));
  for (const [minutes, length] of [
    [15, 12],
    [60, 3],
  ]) {
    const candles = path.join(directory, 'candles', String(minutes));
    await mkdir(candles, { recursive: true });
    await writeFile(
      path.join(candles, 'index.json'),
      JSON.stringify({
        BTCUSDT: { first, n: length },
        ETHUSDT: { first, n: length },
      }),
    );
    for (const symbol of symbols) {
      const data = Buffer.alloc(length * 80);
      for (let row = 0; row < length; row++) {
        const high = minutes === 15 && row === 10 ? 125 : 105;
        const open = minutes === 15 && row === 9 ? 101 : 100;
        const values = [open, high, 99, 100, 1, 100, NaN, 20, NaN, NaN];
        values.forEach((value, field) =>
          data.writeDoubleLE(value, row * 80 + field * 8),
        );
      }
      await writeFile(path.join(candles, `${symbol}.bin`), data);
    }
  }
  for (const symbol of symbols) {
    await writeFile(
      path.join(funding, `${symbol}.json.gz`),
      gzipSync(
        JSON.stringify({
          symbol,
          rates: [
            [first, 0.001],
            [start, 0.002],
            [end, 0.003],
          ],
        }),
      ),
    );
  }
});

afterEach(async () => {
  jest.restoreAllMocks();
  await rm(projectRoot, { recursive: true, force: true });
});

it('exposes only revealed candles and slices funding to the replay window', () => {
  const snapshot = openPortfolioSnapshot(
    path.join(projectRoot, folder),
    symbols,
  );
  try {
    const series = snapshot.candles(15).series.get('BTCUSDT')!;
    const history = visiblePortfolioHistory(series, 1, 4);
    expect(history[3]).toBeUndefined();
    expect(3 in history).toBe(false);
    expect(history.at(-1)).toMatchObject({
      timestamp: first + 3 * step,
      takerBuyQuoteVolume: 20,
    });
    expect(history.at(-1)?.takerBuyBaseVolume).toBeUndefined();
    expect(() => {
      history[0] = series.at(4)!;
    }).toThrow('Unexpected write');
    expect(() => history.push(series.at(5)!)).toThrow();
    expect(history.push(series.at(4)!)).toBe(4);
    expect(history.slice(-2).map(({ timestamp }) => timestamp)).toEqual([
      first + 3 * step,
      start,
    ]);
    expect(snapshot.funding('BTCUSDT', start, end)).toEqual([
      { symbol: 'BTCUSDT', timestamp: start, rate: 0.002 },
    ]);
  } finally {
    snapshot.close();
  }
});

it('replays a complete H1 batch and fills a deferred candidate on the next M15 opening', async () => {
  const childConfig: StrategyConfig = { INTERVAL: '60', MAX_LOSS_VALUE: 10 };
  const confirmation = jest.fn(() => ({ qty: 0.5, risk: 5 }));
  const entry: PortfolioStrategyEntry = {
    kind: 'portfolio',
    manifest: { name: 'PortfolioFixture' },
    defaults: {},
    parseConfig: () => ({ MAX_LOSS_VALUE: 10 }),
    resolveChildren: () => [
      {
        config: childConfig,
        entry: {
          manifest: { name: 'HourlyFixture' },
          defaults: childConfig,
          parseConfig: (config) => config as StrategyConfig,
          createCore:
            ({ strategyApi }) =>
            (candle) => {
              if (candle.timestamp !== start)
                return strategyApi.skip('NO_SIGNAL');
              return strategyApi.entry({
                direction: 'LONG',
                runtime: {
                  ai: {
                    enabled: true,
                    minQuality: 4,
                    replayAnalyses: symbols.map((symbol) => ({
                      symbol,
                      direction: 'LONG',
                      timestamp: candle.timestamp,
                      analysis: {
                        direction: 'LONG',
                        quality: symbol === 'BTCUSDT' ? 5 : 3,
                      },
                    })),
                  },
                  ml: { enabled: false },
                },
                orderPlan: {
                  qty: 1,
                  stopLossPrice: 90,
                  takeProfits: [{ price: 120, rate: 1 }],
                },
              });
            },
        },
      },
    ],
    execution: { maxPositions: 2, feeRate: 0.001, slippageBps: 2 },
    selectEntries: ({ candidates, closedAt, market }) => {
      expect(closedAt).toBe(first + 8 * step);
      expect(candidates.map(({ symbol }) => symbol).sort()).toEqual(symbols);
      expect(market.candle('BTCUSDT', 0)?.timestamp).toBe(closedAt - step);
      expect(market.candle('BTCUSDT', -1)).toBeUndefined();
      const regular = candidates.find(({ symbol }) => symbol === 'BTCUSDT')!;
      const delayed = candidates.find(({ symbol }) => symbol === 'ETHUSDT')!;
      expect(regular).toMatchObject({
        id: expect.any(String),
        gate: { approved: true },
      });
      expect(delayed).toMatchObject({
        id: expect.any(String),
        gate: { approved: false, reason: 'AI_QUALITY_BELOW_MIN (3 < 4)' },
      });
      return {
        ranked: [regular.id],
        pending: [{ candidateId: delayed.id, confirmAt: closedAt + step }],
      };
    },
    confirmEntry: confirmation,
  };
  const options = {
    entry,
    config: {},
    userName: 'fixture',
    connectorName: 'bybit',
    snapshotDirectory: folder,
    projectRoot,
    output: 'trades.json',
  };
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await runPortfolioDeployment(options);
  expect(confirmation).toHaveBeenCalledTimes(1);
  expect(confirmation).toHaveBeenCalledWith(
    expect.objectContaining({
      candle: expect.objectContaining({ timestamp: first + 8 * step }),
      openingPrice: 101,
    }),
  );
  const result = JSON.parse(
    await readFile(path.join(projectRoot, options.output), 'utf8'),
  );
  expect(result.stats).toEqual({
    filled: 2,
    delayedFilled: 1,
    maxOpenPositions: 2,
  });
  expect(result.trades).toEqual([
    expect.objectContaining({
      symbol: 'BTCUSDT',
      entry: first + 7 * step,
      exit: first + 10 * step,
      delayed: false,
      requestedRisk: 10,
      fee: expect.any(Number),
    }),
    expect.objectContaining({
      symbol: 'ETHUSDT',
      entry: first + 9 * step,
      exit: first + 10 * step,
      delayed: true,
      requestedRisk: 5,
      fee: expect.any(Number),
    }),
  ]);
  expect(
    result.trades.every(
      ({ fee, slippage }: { fee: number; slippage: number }) =>
        fee > 0 && slippage > 0,
    ),
  ).toBe(true);
});
