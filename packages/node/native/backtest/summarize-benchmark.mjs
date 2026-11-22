import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { summarizeTerminalWindow } from '../../../../.codex/skills/strategy-backtest-research/scripts/fast-ai-export-metrics.mjs';

const [input, reportFile, chartFile, referenceFile] = process.argv.slice(2);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const { start, end, preload, instruments, ...manifest } = readJson(
  `${input}.manifest.json`,
);
const receipt = readJson(`${input}.receipt.json`);
const rows = readFileSync(input, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
assert.equal(rows.length, receipt.selected);
assert.deepEqual(
  rows.map(({ symbol }) => symbol),
  instruments,
);
const completed = rows.filter(({ status }) => status === 'completed');
assert.equal(completed.length, receipt.completed);
assert.ok(completed.length > 0, 'No fully reconciled symbol results');
if (referenceFile) {
  const compared = new Map(
    readJson(referenceFile).symbols.map((row) => [row.symbol, row]),
  );
  for (const row of completed) {
    const other = compared.get(row.symbol);
    assert.equal(row.inputSha256, other?.inputSha256, row.symbol);
    assert.equal(row.comparisonSha256, other.comparisonSha256, row.symbol);
  }
}

const elapsed = ['totalMs', 'prepMs', 'initMs', 'loopMs', 'cpuMs'];
const sum = (values) => values.reduce((total, value) => total + value, 0);
const quantile = (values, fraction) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index);
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
};

const bars = sum(completed.map(({ bars }) => bars));
const evaluationBars = sum(
  completed.map(({ validFrom }) => (end - validFrom) / 900_000),
);
const perf = Object.fromEntries(
  completed[0].times.map(({ variant }) => {
    const measured = completed.map(({ times }) =>
      times.find((entry) => entry.variant === variant),
    );
    const sums = Object.fromEntries(
      elapsed.map((key) => [key, sum(measured.map((entry) => entry[key]))]),
    );
    const relative = measured.map(
      (entry, index) =>
        entry.totalMs /
        completed[index].times.find(({ variant }) => variant === 'ts').totalMs,
    );
    return [
      variant,
      {
        ...sums,
        evaluationBarsPerSecond: (1000 * evaluationBars) / sums.totalMs,
        medianMs: quantile(
          measured.map(({ totalMs }) => totalMs),
          0.5,
        ),
        relativeToTs: {
          p10: quantile(relative, 0.1),
          median: quantile(relative, 0.5),
          p90: quantile(relative, 0.9),
        },
      },
    ];
  }),
);
const detector = Object.fromEntries(
  ['tsMs', 'rustMs', 'packMs', 'patterns'].map((key) => [
    key,
    sum(completed.map((row) => row.detector[key])),
  ]),
);

const trades = completed
  .flatMap(({ symbol, trades }) =>
    trades.map((trade, index) => ({
      symbol,
      signalId: `${symbol}:${trade.entryTimestamp}:${trade.direction}:${index}`,
      direction: trade.direction,
      exitTimestamp: trade.exitTimestamp,
      netProfit: trade.netProfit,
    })),
  )
  .sort(
    (left, right) =>
      left.exitTimestamp - right.exitTimestamp ||
      left.signalId.localeCompare(right.signalId),
  );
assert.ok(
  trades.every(
    ({ exitTimestamp }) => exitTimestamp >= start && exitTimestamp < end,
  ),
);
const metrics = Object.fromEntries(
  [365, 180, 90, 30].map((periodDays) => [
    periodDays,
    summarizeTerminalWindow({
      trades,
      endTimestamp: end,
      periodDays,
      coverageStartTimestamp: start,
    }),
  ]),
);
const digest = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const report = {
  manifest: { ...manifest, start, end, preload, instruments },
  receipt,
  counts: {
    requested: rows.length,
    accepted: completed.length,
    fullYear: completed.filter(({ validFrom }) => validFrom === start).length,
    newer: completed.filter(({ validFrom }) => validFrom > start).length,
    incompleteCache: rows.filter(({ status }) => status === 'incomplete-cache')
      .length,
    insufficientWarmup: rows.filter(
      ({ status }) => status === 'insufficient-warmup',
    ).length,
    barsWithWarmup: bars,
    evaluatedBars: evaluationBars,
  },
  evidence: {
    inputSha256: digest(input),
    manifestSha256: digest(`${input}.manifest.json`),
    parity: 'strict-equality',
  },
  detector,
  perf,
  metrics,
  symbols: rows.map(({ trades: details, ...row }) => ({
    ...row,
    ...(details ? { tradeCount: details.length } : {}),
  })),
};
writeFileSync(reportFile, JSON.stringify(report, null, 2));

if (chartFile) {
  const series = completed[0].times.map(({ variant }) => ({
    id: variant,
    role: variant === 'ts' ? 'baseline' : 'candidate',
    label: `${variant} · без AI-gate`,
    trades: trades.map(({ exitTimestamp, netProfit }) => [
      exitTimestamp,
      netProfit,
    ]),
  }));
  writeFileSync(
    chartFile,
    JSON.stringify({
      schema: 'tradejs-research-comparison-chart/v1',
      title: 'HeadAndShoulders · сравнение TypeScript и Rust',
      subtitle: 'Кривые совпали на одинаковых сделках · инженерный тест',
      universeLabel: `${completed.length} бессрочных USDT-контрактов Bybit`,
      pnlUnit: 'USDT',
      window: { start, end },
      series,
    }),
  );
}
console.log(
  JSON.stringify({
    counts: report.counts,
    perf,
    detector,
    annual: metrics[365],
  }),
);
