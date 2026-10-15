#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { summarizeRows } from './ai-gate-ablation.mjs';

// Consume only an existing frozen approval trace; never rebuild/rerank a gate.
export function compareSymbolMix(before, after, minTradesPerSymbol = 1) {
  const group = (rows) => {
    const map = new Map();
    for (const r of rows) {
      if (
        !r.symbol ||
        !Number.isFinite(r.profit) ||
        !Number.isFinite(r.timestamp)
      )
        throw new Error('Invalid frozen approval trace');
      if (!map.has(r.symbol)) map.set(r.symbol, []);
      map.get(r.symbol).push(r);
    }
    return map;
  };
  const a = group(before),
    b = group(after);
  const common = [...a.keys()]
    .filter(
      (s) =>
        a.get(s).length >= minTradesPerSymbol &&
        (b.get(s)?.length ?? 0) >= minTradesPerSymbol,
    )
    .sort();
  const selected = new Set(common);
  const old = before.filter((r) => selected.has(r.symbol)),
    recent = after.filter((r) => selected.has(r.symbol));
  const metrics = (rows) => {
    const m = summarizeRows(rows);
    return Object.fromEntries(
      [
        'trades',
        'events',
        'wins',
        'losses',
        'winRate',
        'totalProfit',
        'profitFactor',
        'averageTrade',
        'averageWin',
        'averageLoss',
      ].map((k) => [k, m[k]]),
    );
  };
  const symbolCells = common.map((symbol) => {
    const x = metrics(a.get(symbol)),
      y = metrics(b.get(symbol));
    const pa = a.get(symbol).length / old.length,
      pb = b.get(symbol).length / recent.length;
    return {
      symbol,
      before: x,
      after: y,
      beforeShare: pa,
      afterShare: pb,
      mixEffect: (pb - pa) * x.averageTrade,
      withinSymbolEffect: pb * (y.averageTrade - x.averageTrade),
    };
  });
  return {
    minTradesPerSymbol,
    symbols: common.length,
    before: metrics(old),
    after: metrics(recent),
    beforeDirections: Object.fromEntries(
      ['LONG', 'SHORT'].map((d) => [
        d,
        metrics(old.filter((r) => r.direction === d)),
      ]),
    ),
    afterDirections: Object.fromEntries(
      ['LONG', 'SHORT'].map((d) => [
        d,
        metrics(recent.filter((r) => r.direction === d)),
      ]),
    ),
    laterAbsentBefore: metrics(after.filter((r) => !a.has(r.symbol))),
    laterAbsentBeforeSymbols: [...b.keys()].filter((s) => !a.has(s)).length,
    meanChange:
      old.length && recent.length
        ? metrics(recent).averageTrade - metrics(old).averageTrade
        : null,
    mixEffect: symbolCells.length
      ? symbolCells.reduce((n, c) => n + c.mixEffect, 0)
      : null,
    withinSymbolEffect: symbolCells.length
      ? symbolCells.reduce((n, c) => n + c.withinSymbolEffect, 0)
      : null,
    symbolCells,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const [input, specFile, output] = process.argv.slice(2);
  if (!output)
    throw new Error(
      'Usage: symbol-mix-diagnostics.mjs <frozen-report.json> <regime-spec.json> <output.json>',
    );
  const bytes = await fs.readFile(input),
    specBytes = await fs.readFile(specFile);
  const report = JSON.parse(bytes),
    spec = JSON.parse(specBytes);
  const hash = (b) => createHash('sha256').update(b).digest('hex');
  const streams = spec.streams.map((name) => {
    const trace = report.variants.find((v) => v.name === name)?.approvedSignals;
    if (!trace) throw new Error(`No frozen trace for ${name}`);
    return {
      name,
      comparisons: spec.comparePeriods.map(([before, after]) => {
        const a = spec.periods.find((p) => p.id === before),
          b = spec.periods.find((p) => p.id === after);
        if (!a || !b) throw new Error('Unknown fixed symbol comparison period');
        const rows = (p) =>
          trace.filter((r) => r.timestamp >= p.start && r.timestamp < p.end);
        return {
          before,
          after,
          allObservedCommon: compareSymbolMix(rows(a), rows(b)),
          supportFiveEach: compareSymbolMix(rows(a), rows(b), 5),
        };
      }),
    };
  });
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        schema: 'tradejs-symbol-mix-diagnostics/v1',
        role: 'Retrospective common-symbol panel; economic summaries only, no exit-ordered risk or causal claim',
        input,
        inputSHA256: hash(bytes),
        specSHA256: hash(specBytes),
        streams,
      },
      null,
      2,
    ) + '\n',
  );
}
