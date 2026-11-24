import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip, gunzipSync } from 'node:zlib';

const step = 15 * 60_000;
const day = 96 * step;
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const keyOf = (strategy, symbol) => JSON.stringify([strategy, symbol]);

async function readCandles(file, symbols, intervalMs = step) {
  const series = new Map(symbols.map((symbol) => [symbol, []]));
  const stream = createReadStream(file).pipe(createGunzip());
  for await (const line of createInterface({
    input: stream,
    crlfDelay: Infinity,
  })) {
    const [symbol, ...values] = line.split(',');
    const [
      timestamp,
      open,
      high,
      low,
      close,
      volume,
      turnover,
      buyBase,
      buyQuote,
      sellBase,
      sellQuote,
    ] = values.map((value) => (value === '' ? undefined : Number(value)));
    const bars = series.get(symbol);
    assert.ok(bars, `Unexpected symbol ${symbol}`);
    assert.ok(
      [timestamp, open, high, low, close, volume, turnover].every(
        Number.isFinite,
      ),
    );
    if (bars.length)
      assert.equal(timestamp, bars.at(-1).timestamp + intervalMs, symbol);
    bars.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
      turnover,
      takerBuyBaseVolume: buyBase,
      takerBuyQuoteVolume: buyQuote,
      takerSellBaseVolume: sellBase,
      takerSellQuoteVolume: sellQuote,
    });
  }
  const reference = series.get('BTCUSDT');
  assert.ok(reference?.length);
  for (const [symbol, bars] of series) {
    assert.equal(bars.length, reference.length, symbol);
    assert.equal(bars[0].timestamp, reference[0].timestamp, symbol);
  }
  return series;
}

function loadFunding(directory, symbol, start, end) {
  const file = path.join(directory, `${symbol}.json.gz`);
  const raw = readFileSync(file);
  const payload = JSON.parse(gunzipSync(raw));
  assert.equal(payload.symbol, symbol);
  const points = payload.rates.map(([timestamp, rate]) => ({
    symbol,
    timestamp,
    rate: Number(rate),
  }));
  const maxInterval = 8 * 3_600_000;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    assert.ok(
      Number.isFinite(point.rate) && Number.isSafeInteger(point.timestamp),
      symbol,
    );
    if (i > 0) {
      const previous = points[i - 1].timestamp;
      assert.ok(point.timestamp > previous, symbol);
      if (point.timestamp > start && previous < end) {
        assert.ok(
          point.timestamp - previous <= maxInterval,
          `Funding gap for ${symbol} at ${point.timestamp}`,
        );
      }
    }
  }
  assert.ok(points[0].timestamp <= start + maxInterval, symbol);
  assert.ok(points.at(-1).timestamp >= end - maxInterval, symbol);
  return {
    rates: points.filter(
      ({ timestamp }) => timestamp >= start && timestamp < end,
    ),
    hash: sha(raw),
  };
}

function modelFeatures(offer, priority, series, index) {
  const { strategy, symbol, direction, stop, target } = offer;
  const bars = series.get(symbol);
  const btc = series.get('BTCUSDT');
  const bar = bars[index];
  const side = direction === 'LONG' ? 1 : -1;
  const ret = (data, barsAgo) =>
    Math.log(data[index].close / data[index - barsAgo].close);
  const stopDistance = Math.abs(bar.close - stop) / bar.close;
  const targetDistance = Math.abs(bar.close - target) / bar.close;
  const recentVolume =
    bars
      .slice(index - 16, index)
      .reduce((sum, item) => sum + item.turnover, 0) / 16;
  return [
    ...priority.map((name) => Number(name === strategy)),
    side,
    ...priority.map((name) => (name === strategy ? side : 0)),
    Math.log1p(100 * stopDistance),
    Math.log1p(100 * targetDistance),
    side * ret(btc, 16),
    side * ret(btc, 96),
    side * (ret(bars, 16) - ret(btc, 16)),
    side * (ret(bars, 96) - ret(btc, 96)),
    (bar.high - bar.low) / bar.close,
    Math.log1p(bar.turnover / Math.max(1, recentVolume)),
  ];
}

function fitRidge(rows, penalty) {
  assert.ok(rows.length > 0, 'No closed training trades');
  const width = rows[0].x.length;
  const weightsByTime = new Map();
  for (const row of rows)
    weightsByTime.set(row.time, (weightsByTime.get(row.time) ?? 0) + 1);
  const weight = (row) => 1 / weightsByTime.get(row.time);
  const totalWeight = weightsByTime.size;
  const mean = Array.from(
    { length: width },
    (_, i) =>
      rows.reduce((sum, row) => sum + weight(row) * row.x[i], 0) / totalWeight,
  );
  const scale = mean.map(
    (m, i) =>
      Math.sqrt(
        rows.reduce((sum, row) => sum + weight(row) * (row.x[i] - m) ** 2, 0) /
          totalWeight,
      ) || 1,
  );
  const design = (x) => [
    1,
    ...x.map((value, i) => (value - mean[i]) / scale[i]),
  ];
  const system = Array.from({ length: width + 1 }, (_, row) =>
    Array.from({ length: width + 2 }, (_, col) =>
      row === col && row !== 0 ? penalty : 0,
    ),
  );
  for (const row of rows) {
    const features = design(row.x);
    const w = weight(row);
    for (let i = 0; i < features.length; i++) {
      for (let j = 0; j < features.length; j++)
        system[i][j] += w * features[i] * features[j];
      system[i][features.length] += w * features[i] * row.y;
    }
  }
  // The positive ridge penalty makes the weighted normal matrix positive definite.
  for (let i = 0; i < system.length; i++) {
    const divisor = system[i][i];
    assert.ok(divisor > 0);
    system[i] = system[i].map((value) => value / divisor);
    for (let j = 0; j < system.length; j++) {
      if (i === j) continue;
      const factor = system[j][i];
      system[j] = system[j].map(
        (value, col) => value - factor * system[i][col],
      );
    }
  }
  const coefficients = system.map((row) => row.at(-1));
  return {
    mean,
    scale,
    coefficients,
    rows: rows.length,
    timestamps: totalWeight,
  };
}

function predict(model, x) {
  return x.reduce(
    (score, value, i) =>
      score +
      (model.coefficients[i + 1] * (value - model.mean[i])) / model.scale[i],
    model.coefficients[0],
  );
}

async function runCycle(runtimes, move, choose) {
  const offers = [];
  let pending = runtimes.length;
  let ready;
  const allReady = new Promise((resolve) => {
    ready = resolve;
  });
  if (pending === 0) ready();
  const markReady = () => {
    if (--pending === 0) ready();
  };
  const tasks = runtimes.map(async (runtime) => {
    let offered = false;
    runtime.offer = (offer) =>
      new Promise((reply) => {
        assert.equal(offered, false);
        offered = true;
        offers.push({ ...offer, runtime, reply });
        markReady();
      });
    try {
      return await move(runtime);
    } finally {
      if (!offered) markReady();
      runtime.offer = undefined;
    }
  });
  const completion = Promise.allSettled(tasks);
  await allReady;
  try {
    await choose(offers, tasks);
  } finally {
    for (const offer of offers)
      offer.reply({ allow: false, reason: 'PORTFOLIO_SELECTION' });
  }
  for (const result of await completion) {
    if (result.status === 'rejected') throw result.reason;
  }
}

function summarize(trades, start, end) {
  let pnl = 0,
    peak = 0,
    maxDrawdown = 0,
    won = 0,
    grossWin = 0,
    grossLoss = 0;
  let date,
    batchPnl = 0;
  function observe() {
    pnl += batchPnl;
    peak = Math.max(peak, pnl);
    maxDrawdown = Math.max(maxDrawdown, peak - pnl);
    batchPnl = 0;
  }
  for (const trade of trades) {
    if (date !== undefined && date !== trade.exit) observe();
    date = trade.exit;
    batchPnl += trade.pnl;
    if (trade.pnl > 0) {
      won++;
      grossWin += trade.pnl;
    } else grossLoss -= trade.pnl;
  }
  observe();
  return {
    n: trades.length,
    pnl,
    maxDrawdown,
    pnlPerTrade: trades.length ? pnl / trades.length : null,
    profitFactor: grossLoss ? grossWin / grossLoss : null,
    winRate: trades.length ? won / trades.length : null,
    tradesPerDay: trades.length / ((end - start) / day),
    fundingFee: trades.reduce((sum, trade) => sum + trade.funding, 0),
    fee: trades.reduce((sum, trade) => sum + trade.fee, 0),
    slippageCost: trades.reduce((sum, trade) => sum + trade.slippage, 0),
  };
}

async function main() {
  const [studyDir, mode, smokeDays, selectedVariant] = process.argv.slice(2);
  assert.ok(
    studyDir && ['smoke', 'train', 'test'].includes(mode),
    'Usage: node portfolio-signal-agent.mjs STUDY_DIR smoke|train|test [smokeDays] [testVariant]',
  );
  const root = path.resolve(studyDir);
  const spec = readJson(path.join(root, 'spec.json'));
  assert.ok(spec.symbols.every((symbol) => /^[A-Z0-9]+USDT$/.test(symbol)));
  assert.ok(
    spec.symbols.includes('BTCUSDT') && spec.symbols.includes('ETHUSDT'),
  );
  assert.ok(new Set(spec.symbols).size === spec.symbols.length);
  const production = readJson(path.join(root, 'production.json'));
  const deployments = [production, ...(production.additionalDeployments ?? [])];
  const strategies = deployments.flatMap(
    ({ verification, verificationSha256, verificationBytes, strategies }) => {
      assert.equal(verification.encoding, 'base64');
      const verificationBody = Buffer.from(verification.data, 'base64');
      assert.equal(verificationBody.length, verificationBytes);
      assert.equal(sha(verificationBody), verificationSha256);
      const verified = JSON.parse(verificationBody);
      for (const strategy of strategies) {
        assert.equal(
          strategy.deploymentCompositionId,
          verified.deploymentCompositionId,
        );
        assert.ok(
          verified.verification.strategies.some(
            (item) =>
              item.strategyName === strategy.strategyName &&
              item.strategyRevision === strategy.strategyRevision,
          ),
        );
      }
      return strategies;
    },
  );
  assert.equal(
    new Set(strategies.map((strategy) => strategy.strategyName)).size,
    strategies.length,
  );
  const verificationSha256 = production.verificationSha256;
  const additionalDeploymentHashes = deployments
    .slice(1)
    .map((deployment) => deployment.verificationSha256);

  const runtimeRoot = path.join(root, 'runtime');
  const require = createRequire(path.join(runtimeRoot, 'loader.cjs'));
  const originalProject = process.cwd();
  process.env.PROJECT_CWD = runtimeRoot;
  process.env.TRADEJS_TIMESCALE_READ_ONLY = 'true';
  const {
    createStrategyRuntime,
    registerStrategyEntries,
  } = require('@tradejs/node/strategies');
  const { createTestConnector } = require('@tradejs/node/backtest');
  const { closeRedisConnection } = require('@tradejs/infra/redis');
  const { closeTimescalePool } = require('@tradejs/infra/timescale/client');
  assert.equal(
    readJson(path.join(runtimeRoot, 'node_modules/@tradejs/node/package.json'))
      .version,
    strategies[0].runtimePackageVersion,
  );
  const plugins = new Map(
    strategies.map((strategy) => {
      const packagePath = path.join(
        runtimeRoot,
        'node_modules',
        strategy.strategyPackage,
        'package.json',
      );
      assert.equal(
        readJson(packagePath).version,
        strategy.strategyPackageVersion,
      );
      const entry = require(strategy.strategyPackage).strategyEntries.find(
        (item) => item.manifest.name === strategy.strategyName,
      );
      assert.ok(entry, strategy.strategyName);
      return [strategy.strategyName, entry];
    }),
  );
  registerStrategyEntries([...plugins.values()]);
  const series = await readCandles(
    path.join(root, 'candles.csv.gz'),
    spec.symbols,
  );
  const intervalSeries = new Map([[15, series]]);
  for (const interval of new Set(
    strategies.map((strategy) => Number(strategy.strategyConfig.INTERVAL)),
  )) {
    if (interval === 15) continue;
    assert.ok(
      interval > 15 && interval % 15 === 0,
      `Unsupported interval ${interval}`,
    );
    const native = await readCandles(
      path.join(root, `candles-${interval}.csv.gz`),
      spec.symbols,
      interval * 60_000,
    );
    const primaryBtc = series.get('BTCUSDT'),
      nativeBtc = native.get('BTCUSDT');
    assert.equal(nativeBtc[0].timestamp, primaryBtc[0].timestamp);
    assert.equal(
      nativeBtc.at(-1).timestamp + interval * 60_000,
      primaryBtc.at(-1).timestamp + step,
    );
    intervalSeries.set(interval, native);
  }
  const split = Date.parse(spec.split),
    start = Date.parse(spec.start),
    end = Date.parse(spec.end);
  assert.ok(start < split && (mode === 'train' ? split <= end : split < end));
  const frozenEvaluation = spec.frozenModelSha256 != null;
  if (frozenEvaluation) {
    assert.equal(mode, 'test', 'An externally frozen model is evaluation-only');
    assert.ok(Date.parse(spec.frozenModelTrainingEnd) <= split);
  }
  const trainingWithoutFunding = spec.trainingWithoutFunding === true;
  if (trainingWithoutFunding) assert.equal(mode, 'train');
  const fundingStart = mode === 'test' ? split : start;
  const funding = new Map(
    spec.symbols.map((symbol) => [
      symbol,
      trainingWithoutFunding
        ? { rates: [], hash: null }
        : loadFunding(
            path.resolve(originalProject, spec.fundingDirectory),
            symbol,
            fundingStart,
            end,
          ),
    ]),
  );
  const priority = new Map(spec.priority.map((name, index) => [name, index]));
  assert.equal(priority.size, plugins.size);
  const excludedEvaluationStrategies = new Set(
    spec.excludedEvaluationStrategies ?? [],
  );
  for (const name of excludedEvaluationStrategies)
    assert.ok(plugins.has(name), name);
  if (excludedEvaluationStrategies.size) assert.equal(mode, 'test');
  const btc = series.get('BTCUSDT');
  const indexAt = (time) => {
    const index = (time - btc[0].timestamp) / step;
    assert.ok(
      Number.isInteger(index) &&
        index >= spec.warmupBars &&
        index <= btc.length,
      time,
    );
    return index;
  };
  const modelPath = path.join(root, 'model.json');
  if (frozenEvaluation)
    assert.equal(sha(readFileSync(modelPath)), spec.frozenModelSha256);
  const savedModel =
    mode === 'test' && (!selectedVariant || selectedVariant === 'agent')
      ? readJson(modelPath)
      : null;
  const output = {
    verificationSha256,
    ...(trainingWithoutFunding ? { trainingWithoutFunding } : {}),
    ...(excludedEvaluationStrategies.size
      ? { excludedEvaluationStrategies: [...excludedEvaluationStrategies] }
      : {}),
    ...(frozenEvaluation ? { frozenModelSha256: spec.frozenModelSha256 } : {}),
    ...(additionalDeploymentHashes.length
      ? { additionalDeploymentHashes }
      : {}),
    fundingSha256: Object.fromEntries(
      Array.from(funding, ([symbol, data]) => [symbol, data.hash]),
    ),
    variants: {},
  };

  async function replay(variant, from, to) {
    const first = indexAt(from),
      last = indexAt(to);
    const training = variant === 'training';
    const trades = [],
      trainRows = [];
    const stats = {
      offers: 0,
      filled: 0,
      filteredByCurrentGate: 0,
      otherSkips: {},
      forcedExits: 0,
      maxOpenPositions: 0,
      byStrategy: Object.fromEntries(
        spec.priority.map((name) => [
          name,
          { offers: 0, filled: 0, filteredByCurrentGate: 0 },
        ]),
      ),
    };
    const runtimes = [];

    for (const observed of strategies) {
      const name = observed.strategyName;
      if (excludedEvaluationStrategies.has(name)) continue;
      const entry = plugins.get(name);
      const config = entry.parseConfig({
        ...observed.strategyConfig,
        ENV: 'PARITY',
        MAKE_ORDERS: true,
        AI_ENABLED:
          variant === 'current' && observed.strategyConfig.AI_ENABLED === true,
        MAX_LOSS_VALUE: spec.risk,
      });
      const interval = Number(config.INTERVAL);
      const nativeRatio = interval / 15;
      const native = intervalSeries.get(interval);
      assert.ok(
        native &&
          first % nativeRatio === 0 &&
          spec.warmupBars % nativeRatio === 0,
      );
      const warm = (bars) =>
        bars.slice(
          (first - spec.warmupBars) / nativeRatio,
          first / nativeRatio,
        );
      for (const symbol of spec.symbols) {
        if (observed.selection && !observed.selection.tickers.includes(symbol))
          continue;
        const test = createTestConnector(
          {
            universe: 'crypto',
            capabilities: {},
            kline: async () => {
              throw Error('External candle request in offline replay');
            },
            listInstruments: async () => [],
          },
          {
            aiEnabled: true,
            fastMode: true,
            fundingRates: funding.get(symbol).rates,
            executionCostModel: {
              fees: {
                makerRate: spec.feeRate,
                takerRate: spec.feeRate,
                source: 'config',
              },
              slippage: {
                baseBps: spec.slippageBps,
                spreadMultiplier: 0,
                marketImpactBps: 0,
                delayRiskMultiplier: 0,
                source: 'config',
              },
              funding: trainingWithoutFunding
                ? { enabled: false, source: 'unavailable', points: 0 }
                : {
                    enabled: true,
                    source: 'historical',
                    points: funding.get(symbol).rates.length,
                  },
              leverage: {
                requested: config.LEVERAGE,
                effective: config.LEVERAGE,
                maxAllowed: null,
              },
              quality: 'full',
              capturedAt: 0,
            },
          },
        );
        const runtime = {
          test,
          symbol,
          name,
          claims: new Map(),
          native,
          nativeRatio,
          executionTime: null,
          taskIndex: runtimes.length,
        };
        // Native H1 candles are stamped at their open. Use the shared decision
        // tick for fills so nothing is timestamped before that candle is known.
        if (nativeRatio > 1) {
          const placeOrder = test.placeOrder;
          const closePosition = test.closePosition;
          const atDecisionTick = (order) => ({
            ...order,
            timestamp: Math.max(
              order.timestamp,
              runtime.executionTime ?? order.timestamp,
            ),
          });
          test.placeOrder = (order) => placeOrder(atDecisionTick(order));
          test.closePosition = (order) => closePosition(atDecisionTick(order));
        }
        const existing = entry.manifest.hooks?.beforeEntryGate;
        const create = createStrategyRuntime({
          strategyName: name,
          defaults: entry.defaults,
          createCore: entry.createCore,
          manifest: {
            ...entry.manifest,
            hooks: {
              ...entry.manifest.hooks,
              async beforeEntryGate(params) {
                const previous = await existing?.(params);
                if (previous?.allow === false) return previous;
                const { decision, market } = params;
                const stop = decision.orderPlan.stopLossPrice;
                const target = decision.orderPlan.takeProfits?.[0]?.price;
                assert.ok(decision.signal?.signalId, 'Entry without a signal');
                return runtime.offer({
                  strategy: name,
                  symbol,
                  time: market.candle.timestamp + (nativeRatio - 1) * step,
                  direction: decision.entryContext.direction,
                  stop,
                  target,
                  signalId: decision.signal.signalId,
                });
              },
            },
          },
        });
        runtime.run = await create({
          userName: 'offline-signal-selection',
          connectorName: 'bybit',
          symbol,
          universe: 'crypto',
          assetClass: 'crypto_perpetual',
          config,
          policyProfileId: config.POLICY_PROFILE_ID,
          runtimeConfigSnapshot: { userConfig: {} },
          ...(spec.shareIndicators
            ? {
                sharedIndicatorsReplayKey: `signal-agent:${variant}:${symbol}:${interval}`,
              }
            : {}),
          data: warm(native.get(symbol)),
          btcData: warm(native.get('BTCUSDT')),
          ethData: warm(native.get('ETHUSDT')),
          connector: test,
        });
        runtimes.push(runtime);
      }
    }
    assert.ok(runtimes.length > 0);

    async function collect(runtime) {
      for (const record of await runtime.test.drainMlResultsBatch()) {
        const result = record.tradeResult;
        assert.ok(result, 'Filled trade has no economics');
        assert.ok(
          Number.isFinite(result.netProfit) &&
            result.entryTimestamp <= result.exitTimestamp,
        );
        const claim = runtime.claims.get(record.signalId);
        assert.ok(claim, 'Exit without admission');
        runtime.claims.delete(record.signalId);
        if (training) {
          if (result.exitTimestamp < to) {
            trainRows.push({
              time: claim.time,
              x: claim.x,
              y: result.netProfit / spec.risk,
              strategy: runtime.name,
            });
          }
        } else {
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
          });
        }
      }
    }

    for (let i = first; i < last; i++) {
      const time = btc[i].timestamp;
      const positions = new Set();
      let openCount = 0;
      async function refreshPositions() {
        positions.clear();
        openCount = 0;
        for (const runtime of runtimes) {
          if (await runtime.test.getPosition(runtime.symbol)) {
            openCount++;
            positions.add(runtime.symbol);
          }
        }
      }
      for (const runtime of runtimes) {
        const candle = series.get(runtime.symbol)[i];
        await runtime.test.checkExits(candle);
        await collect(runtime);
      }
      if (i < last - 1) {
        await runCycle(
          runtimes,
          async (runtime) => {
            if ((i + 1) % runtime.nativeRatio !== 0) return undefined;
            const nativeIndex = (i + 1) / runtime.nativeRatio - 1;
            runtime.executionTime = time;
            const result = await runtime.run(
              runtime.native.get(runtime.symbol)[nativeIndex],
              runtime.native.get('BTCUSDT')[nativeIndex],
              runtime.native.get('ETHUSDT')[nativeIndex],
            );
            if (result && typeof result !== 'string') {
              const reason =
                result.orderSkipReason ?? result.orderFailureReason;
              if (reason?.startsWith('AI_')) {
                stats.filteredByCurrentGate++;
                stats.byStrategy[runtime.name].filteredByCurrentGate++;
              } else if (reason && !reason.includes('PORTFOLIO_SELECTION')) {
                stats.otherSkips[reason] = (stats.otherSkips[reason] ?? 0) + 1;
              }
            }
            return result;
          },
          async (offers, tasks) => {
            await refreshPositions();
            stats.offers += offers.length;
            for (const offer of offers) {
              stats.byStrategy[offer.strategy].offers++;
              assert.equal(offer.time, time, 'Unexpected decision time');
              if (training || variant === 'agent') {
                assert.ok(
                  Number.isFinite(offer.stop) && Number.isFinite(offer.target),
                  'Missing fixed protection levels',
                );
                offer.x = modelFeatures(offer, spec.priority, series, i);
                assert.ok(offer.x.every(Number.isFinite));
                if (variant === 'agent')
                  offer.score = predict(savedModel, offer.x);
              }
            }
            const ordered = offers.sort(
              (a, b) =>
                (variant === 'agent' ? b.score - a.score : 0) ||
                priority.get(a.strategy) - priority.get(b.strategy) ||
                a.symbol.localeCompare(b.symbol),
            );
            for (const offer of ordered) {
              if (
                !training &&
                (openCount >= spec.maxPositions || positions.has(offer.symbol))
              )
                continue;
              if (variant === 'agent' && offer.score <= spec.agentMinExpectedR)
                continue;
              const live = offer.runtime;
              assert.equal(
                await live.test.getPosition(live.symbol),
                null,
                'Unexpected scale-in submission',
              );
              offer.reply({ allow: true });
              const result = await tasks[live.taskIndex];
              if (await live.test.getPosition(live.symbol)) {
                stats.filled++;
                stats.byStrategy[offer.strategy].filled++;
                openCount++;
                positions.add(live.symbol);
                live.claims.set(offer.signalId, { time, x: offer.x });
              } else if (result?.orderStatus === 'completed') {
                throw new Error(
                  `Completed without a position: ${offer.signalId}`,
                );
              }
            }
          },
        );
      } else {
        await refreshPositions();
      }
      stats.maxOpenPositions = Math.max(stats.maxOpenPositions, openCount);
      if (!training)
        assert.equal(positions.size, openCount, 'Duplicate symbol position');
      const logEveryDays = frozenEvaluation ? 3 : 30;
      if ((i - first + 1) % (logEveryDays * 96) === 0) {
        console.error(
          variant,
          new Date(time).toISOString(),
          stats.offers,
          stats.filled,
        );
      }
    }
    const finalTime = btc[last - 1].timestamp;
    for (const runtime of runtimes) {
      const position = await runtime.test.getPosition(runtime.symbol);
      if (!position) continue;
      stats.forcedExits++;
      if (!training) {
        await runtime.test.closePosition({
          ...position,
          timestamp: finalTime,
          price: series.get(runtime.symbol)[last - 1].close,
        });
        await collect(runtime);
      }
    }
    if (!training)
      assert.equal(trades.length, stats.filled, 'Fill and trade counts differ');
    else
      assert.equal(
        trainRows.length + stats.forcedExits,
        stats.filled,
        'Training outcome counts differ',
      );
    trades.sort(
      (a, b) =>
        a.exit - b.exit ||
        a.entry - b.entry ||
        a.symbol.localeCompare(b.symbol),
    );
    console.error(variant, JSON.stringify(stats));
    return { trades, trainRows, stats };
  }

  try {
    if (mode === 'train') {
      const result = await replay('training', start, split);
      const subsets = spec.trainingSubsets ?? { model: spec.priority };
      for (const [id, names] of Object.entries(subsets)) {
        assert.match(id, /^[a-zA-Z0-9-]+$/);
        assert.ok(
          names.length > 0 && names.every((name) => priority.has(name)),
        );
        assert.equal(new Set(names).size, names.length);
        const width = spec.priority.length;
        const indices = names.map((name) => priority.get(name));
        const subsetRows = result.trainRows
          .filter((row) => names.includes(row.strategy))
          .map((row) => ({
            ...row,
            x: [
              ...indices.map((i) => row.x[i]),
              row.x[width],
              ...indices.map((i) => row.x[width + 1 + i]),
              ...row.x.slice(2 * width + 1),
            ],
          }));
        const model = fitRidge(subsetRows, spec.ridgePenalty);
        const byStrategy = Object.fromEntries(
          names.map((name) => [
            name,
            subsetRows.filter((row) => row.strategy === name).length,
          ]),
        );
        writeFileSync(
          path.join(root, `${id}.json`),
          JSON.stringify(
            {
              ...model,
              ...output,
              byStrategy,
              ...(spec.trainingSubsets
                ? { featureStrategies: names }
                : { stats: result.stats }),
            },
            null,
            2,
          ),
          { flag: 'wx' },
        );
      }
    } else {
      const variants =
        mode === 'smoke'
          ? ['current', 'training']
          : ['current', 'simple', 'agent'];
      if (savedModel) {
        assert.equal(savedModel.verificationSha256, verificationSha256);
        if (savedModel.featureStrategies)
          assert.deepEqual(savedModel.featureStrategies, spec.priority);
        assert.deepEqual(
          savedModel.additionalDeploymentHashes ?? [],
          additionalDeploymentHashes,
        );
        if (!frozenEvaluation)
          assert.deepEqual(savedModel.fundingSha256, output.fundingSha256);
      }
      const from =
        mode === 'smoke' ? split - Number(smokeDays ?? 7) * day : split;
      const to = mode === 'smoke' ? split : end;
      for (const variant of variants) {
        if (selectedVariant && selectedVariant !== variant) continue;
        const result = await replay(variant, from, to);
        output.variants[variant] = {
          stats: result.stats,
          groups: Object.fromEntries(
            ['ALL', 'LONG', 'SHORT'].map((side) => [
              side,
              summarize(
                result.trades.filter(
                  (trade) => side === 'ALL' || trade.direction === side,
                ),
                from,
                to,
              ),
            ]),
          ),
          trades: result.trades,
        };
      }
      assert.ok(
        Object.keys(output.variants).length,
        'Unknown selected variant',
      );
      writeFileSync(
        path.join(
          root,
          `${mode}${selectedVariant ? '-' + selectedVariant : ''}.json`,
        ),
        JSON.stringify({ ...output, from, to }, null, 2),
        { flag: 'wx' },
      );
    }
  } finally {
    await Promise.all([closeRedisConnection(), closeTimescalePool()]);
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
