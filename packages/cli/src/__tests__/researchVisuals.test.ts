import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  normalizeDataset,
  selectAtlas,
  analyzeVisualTrades,
  drawdownEpisodes,
  generateResearchVisuals,
  renderTradeSvg,
  type VisualTrade,
} from '../lib/researchVisuals';

const trade = (id: string, pnl: number, exitTime = 120000): VisualTrade => ({
  id,
  pnl,
  strategy: 'Example',
  symbol: 'BTCUSDT',
  direction: 'LONG',
  signalTime: 0,
  entryTime: 60000,
  exitTime,
  entryPrice: 100,
  exitPrice: 100 + pnl,
  stop: 90,
  target: 120,
  pockets: {},
  features: {},
  groups: {},
  figures: { lines: [], points: [], zones: [] },
  candles: [0, 60000, 120000].map((timestamp) => ({
    timestamp,
    open: 100,
    high: 110,
    low: 95,
    close: 101,
    volume: 10,
  })),
});
const dataset = (trades: VisualTrade[], population = 'complete') =>
  normalizeDataset({
    schema: 'tradejs-research-visuals/v1',
    intervalMs: 60000,
    population,
    trades,
  });

test('stratified atlas is stable under input permutation, separate by strategy and outcome', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({
    ...trade(String(i), i % 2 ? 1 : -1),
    signalTime: i,
    entryTime: 1000,
  }));
  rows.push({ ...trade('other', -1), strategy: 'Other' }, trade('flat', 0));
  const chosen = selectAtlas(rows);
  expect(chosen).toEqual(selectAtlas([...rows].reverse()));
  expect(
    chosen.filter((t) => t.strategy === 'Example' && t.pnl > 0),
  ).toHaveLength(100);
  expect(
    chosen.filter((t) => t.strategy === 'Example' && t.pnl < 0),
  ).toHaveLength(100);
  expect(new Set(chosen.map((t) => t.id)).size).toBe(201);
  expect(chosen.some((t) => t.id === 'flat')).toBe(false);
  expect(() => selectAtlas(rows, 0)).toThrow('count');
});

test('selected archives can never be promoted into full portfolio evidence', () => {
  const selected = dataset([trade('a', -3)], 'selected');
  expect(
    normalizeDataset(selected, { population: 'complete' }).population,
  ).toBe('selected');
  expect(
    normalizeDataset(
      {
        schema: 'trade-atlas-chart-points/v1',
        timeframe: 1,
        cards: selected.trades,
      },
      { population: 'complete' },
    ).population,
  ).toBe('selected');
  expect(() => drawdownEpisodes(selected)).toThrow('complete population');
});

test('validation rejects duplicates, mixed runs, bad prices and chronology', () => {
  const a = trade('a', 1);
  expect(() => dataset([a, a])).toThrow('Duplicate trade');
  expect(() =>
    dataset([{ ...a, candles: [a.candles[0], a.candles[0]] }]),
  ).toThrow('Duplicate candle');
  expect(() => dataset([{ ...a, symbol: 'BTCUSDC' }])).toThrow('USDT');
  expect(() => dataset([{ ...a, exitTime: 0 }])).toThrow('chronology');
  expect(() => dataset([{ ...a, entryPrice: NaN }])).toThrow('entryPrice');
  expect(() =>
    normalizeDataset(
      [
        { ...a, backtestRunId: 'one' },
        { ...trade('b', 2), backtestRunId: 'two' },
      ],
      { population: 'complete', intervalMs: 60000 },
    ),
  ).toThrow('Mixed backtest');
});

test('drawdown nets simultaneous exits and tracks recovery and open episodes', () => {
  const rows = [
    trade('gain', 10, 120000),
    trade('loss', -7, 180000),
    trade('offset', 2, 180000),
    trade('recover', 5, 240000),
    trade('last', -2, 300000),
  ];
  rows[1].groups = { volatility: 'high' };
  const episodes = drawdownEpisodes(dataset(rows));
  expect(episodes).toEqual(drawdownEpisodes(dataset([...rows].reverse())));
  expect(episodes).toHaveLength(2);
  expect(episodes[0]).toMatchObject({
    start: 120000,
    trough: 180000,
    end: 240000,
    depth: 5,
    recovered: true,
  });
  expect(episodes[0].contributions['symbol:BTCUSDT']).toMatchObject({
    n: 3,
    pnl: 0,
  });
  expect(episodes[0].contributions['group:volatility:high'].pnl).toBe(-7);
  expect(episodes[1]).toMatchObject({ depth: 2, recovered: false });
  expect(drawdownEpisodes(dataset([trade('first', -4)]))[0].peak).toBe(0);
  expect(
    drawdownEpisodes(dataset([trade('loss', -4), trade('gain', 4)])),
  ).toEqual([]);
  expect(drawdownEpisodes(dataset([]))).toEqual([]);
});

test('pocket unknowns are distinct and outcome metadata cannot enter feature contrasts', () => {
  const a = { ...trade('a', 3), pockets: { p: true }, features: { atr: 4 } };
  const b = { ...trade('b', -2), pockets: { p: false }, features: { atr: 1 } };
  const c = trade('c', -1);
  const summary = analyzeVisualTrades([a, b, c]).ALL;
  expect(summary.pockets.p).toMatchObject({
    pass: { n: 1 },
    fail: { n: 1 },
    unknown: 1,
  });
  expect(summary.contrasts[0]).toMatchObject({
    winMedian: 4,
    lossMedian: 1,
    missing: 1,
  });
  const parsed = dataset([
    {
      ...a,
      features: {},
      payload: {
        featureSnapshot: {
          definitions: [
            { id: 'input', role: 'input' },
            { id: 'outcome', role: 'outcome' },
          ],
          values: { input: 2, outcome: 10 },
        },
      },
    } as VisualTrade,
  ]);
  expect(parsed.trades[0].features).toEqual({ input: 2 });
});

test('charts flag missing candles and keep partial-bar extremes out of excursion metrics', () => {
  expect(renderTradeSvg(trade('a', 1), 60000).audit).toMatchObject({
    entryCovered: true,
    exitCovered: true,
  });
  const sparse = renderTradeSvg({ ...trade('a', 1), candles: [] }, 60000);
  expect(sparse.svg).toContain('No cached candles');
  expect(sparse.audit).toMatchObject({
    entryCovered: false,
    exitCovered: false,
  });
  const escaped = renderTradeSvg(
    { ...trade('a', 1), strategy: '<script>alert(1)</script>' },
    60000,
  );
  expect(escaped.svg).not.toContain('<script>');
});

test('report writes verifiable SVG/PNG artifacts, preserves selected scope and refuses overwrite', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-visuals-'));
  try {
    const input = path.join(dir, 'input.json'),
      outDir = path.join(dir, 'report');
    await fs.writeFile(
      input,
      JSON.stringify(dataset([trade('loss', -5), trade('recover', 6, 180000)])),
    );
    expect(
      await generateResearchVisuals({ inputs: [input], outDir, png: true }),
    ).toMatchObject({ selected: 2, episodes: 2 });
    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8'),
    );
    expect(manifest.status).toBe('complete');
    for (const [file, receipt] of Object.entries(manifest.files) as Array<
      [string, { sha256: string; bytes: number }]
    >) {
      const content = await fs.readFile(path.join(outDir, file));
      expect(content.length).toBe(receipt.bytes);
      expect(createHash('sha256').update(content).digest('hex')).toBe(
        receipt.sha256,
      );
      if (file.endsWith('.png'))
        expect(content.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    }
    const retained = JSON.parse(
      gunzipSync(
        await fs.readFile(path.join(outDir, 'chart-inputs.json.gz')),
      ).toString(),
    );
    expect(retained.population).toBe('selected');
    await expect(
      generateResearchVisuals({ inputs: [input], outDir }),
    ).rejects.toThrow('EEXIST');
    const selectedOut = path.join(dir, 'selected');
    await generateResearchVisuals({
      inputs: [path.join(outDir, 'chart-inputs.json.gz')],
      outDir: selectedOut,
      population: 'complete',
    });
    expect(
      JSON.parse(
        await fs.readFile(path.join(selectedOut, 'analysis.json'), 'utf8'),
      ).drawdowns,
    ).toBeNull();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('shared market history is normalized once, without copying it into every trade', () => {
  const candles = trade('a', 1).candles;
  const rows = Array.from({ length: 500 }, (_, i) => ({
    ...trade(String(i), 1),
    candles: undefined,
  }));
  const data = normalizeDataset({
    schema: 'tradejs-research-visuals/v1',
    population: 'complete',
    intervalMs: 60000,
    candlesBySymbol: { BTCUSDT: candles },
    trades: rows,
  });
  expect(data.trades[0].candles).toEqual(candles);
  expect(data.trades[0].candles).not.toBe(candles);
  expect(new Set(data.trades.map((t) => t.candles)).size).toBe(1);
  const own = dataset([trade('own', 1)]);
  expect(own.trades[0].candles).toEqual(candles);
});
