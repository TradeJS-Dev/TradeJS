import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  normalizeDataset,
  object,
  type VisualDataset,
} from './researchVisuals/model';
import {
  selectAtlas,
  analyzeVisualTrades,
  drawdownEpisodes,
  summarize,
} from './researchVisuals/analysis';
import {
  renderTradeSvg,
  renderDrawdownSvg,
  esc,
} from './researchVisuals/render';
export {
  normalizeDataset,
  selectAtlas,
  analyzeVisualTrades,
  drawdownEpisodes,
  renderTradeSvg,
  renderDrawdownSvg,
};
export type {
  VisualDataset,
  VisualTrade,
  VisualCandle,
} from './researchVisuals/model';
const sha = (v: Buffer | string) =>
  createHash('sha256').update(v).digest('hex');
export interface ResearchVisualOptions {
  inputs: string[];
  outDir: string;
  population?: 'complete' | 'selected';
  intervalMs?: number;
  strategy?: string;
  candlesFile?: string;
  count?: number;
  seed?: string;
  png?: boolean;
}
async function readInput(file: string) {
  const stat = await fs.stat(file);
  if (stat.size > 512 * 1024 * 1024)
    throw new Error('Visual input exceeds 512 MiB');
  const bytes = await fs.readFile(file),
    decoded = file.endsWith('.gz')
      ? gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 })
      : bytes;
  const source = decoded.toString('utf8');
  const value: unknown = /\.jsonl(?:\.gz)?$/.test(file)
    ? source
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    : JSON.parse(source);
  return {
    value,
    receipt: {
      path: path.resolve(file),
      sha256: sha(bytes),
      bytes: bytes.length,
    },
  };
}
export async function generateResearchVisuals(options: ResearchVisualOptions) {
  if (!options.inputs.length) throw new Error('At least one input is required');
  const inputs = await Promise.all(options.inputs.map(readInput));
  if (inputs.length > 1 && inputs.some((i) => !Array.isArray(i.value)))
    throw new Error(
      'Multiple inputs are supported only for JSONL/array shards',
    );
  const candles = options.candlesFile
    ? await readInput(options.candlesFile)
    : undefined;
  const dataset = normalizeDataset(
    inputs.length === 1
      ? inputs[0].value
      : inputs.flatMap((i) => (Array.isArray(i.value) ? i.value : [])),
    {
      population: options.population,
      intervalMs: options.intervalMs,
      strategy: options.strategy,
      candlesBySymbol: candles ? object(candles.value) : undefined,
    },
  );
  const selected = selectAtlas(
    dataset.trades,
    options.count ?? 100,
    options.seed ?? 'trade-atlas/v1',
  );
  const episodes =
    dataset.population === 'complete'
      ? Object.fromEntries(
          (['ALL', 'LONG', 'SHORT'] as const).map((direction) => [
            direction,
            drawdownEpisodes({
              ...dataset,
              trades: dataset.trades.filter(
                (t) => direction === 'ALL' || t.direction === direction,
              ),
            }),
          ]),
        )
      : null;
  const analysis = Object.fromEntries(
    [...new Set(dataset.trades.map((t) => t.strategy))]
      .sort()
      .map((strategy) => [
        strategy,
        analyzeVisualTrades(
          dataset.trades.filter((t) => t.strategy === strategy),
        ),
      ]),
  );
  const out = path.resolve(options.outDir);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.mkdir(out);
  const receipts: Record<string, { sha256: string; bytes: number }> = {};
  const write = async (name: string, data: Buffer | string) => {
    const bytes = typeof data === 'string' ? Buffer.from(data) : data;
    await fs.writeFile(path.join(out, name), bytes, { flag: 'wx' });
    receipts[name] = { sha256: sha(bytes), bytes: bytes.length };
  };
  const manifest = {
    schema: 'tradejs-research-visual-report/v1',
    status: 'running',
    source: dataset.source,
    population: dataset.population,
    populationClaim:
      dataset.population === 'complete'
        ? 'Caller declares complete reconciled population'
        : 'Selected cases; no population or drawdown inference',
    inputs: inputs.map((i) => i.receipt),
    candles: candles?.receipt,
    selection: {
      countPerOutcomePerStrategy: options.count ?? 100,
      seed: options.seed ?? 'trade-atlas/v1',
      method:
        'Equal chronological strata; SHA256 choice within stratum; no replacement',
    },
    summary: summarize(dataset.trades),
    selected: selected.length,
    semantics:
      'Retrospective associations, not causal validation. Pocket labels are supplied snapshots, not a native portfolio rerun.',
  };
  await fs.writeFile(
    path.join(out, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  try {
    await fs.mkdir(path.join(out, 'trades'));
    await fs.mkdir(path.join(out, 'drawdowns'));
    const cards = [];
    for (const [index, trade] of selected.entries()) {
      const name = `trades/${String(index + 1).padStart(4, '0')}-${sha(trade.strategy + ':' + trade.id).slice(0, 12)}`;
      const { svg, audit } = renderTradeSvg(trade, dataset.intervalMs);
      await write(name + '.svg', svg);
      if (options.png)
        await write(
          name + '.png',
          await sharp(Buffer.from(svg)).png().toBuffer(),
        );
      cards.push({
        id: trade.id,
        strategy: trade.strategy,
        symbol: trade.symbol,
        direction: trade.direction,
        pnl: trade.pnl,
        outcome: trade.pnl > 0 ? 'win' : 'loss',
        pockets: trade.pockets,
        svg: name + '.svg',
        image: name + (options.png ? '.png' : '.svg'),
        audit,
      });
    }
    const drawdownCards = [];
    for (const [direction, group] of Object.entries(episodes ?? {}))
      for (const episode of group) {
        const name = `drawdowns/${direction}-${episode.id}`;
        const svg = renderDrawdownSvg(episode);
        await write(name + '.svg', svg);
        if (options.png)
          await write(
            name + '.png',
            await sharp(Buffer.from(svg)).png().toBuffer(),
          );
        drawdownCards.push({
          ...episode,
          direction,
          image: name + (options.png ? '.png' : '.svg'),
        });
      }
    // Retain selected causal render inputs only, not the complete temporary trade export.
    const retained: VisualDataset = {
      ...dataset,
      population: 'selected',
      trades: selected.map((trade) => ({
        ...trade,
        candles: trade.candles.filter(
          (bar) =>
            bar.timestamp >= trade.signalTime - 140 * dataset.intervalMs &&
            bar.timestamp <= trade.exitTime + 20 * dataset.intervalMs,
        ),
      })),
    };
    await write('chart-inputs.json.gz', gzipSync(JSON.stringify(retained)));
    await write(
      'analysis.json',
      JSON.stringify(
        {
          schema: 'tradejs-visual-analysis/v1',
          population: dataset.population,
          analysis,
          drawdowns: episodes,
          cards,
        },
        null,
        2,
      ),
    );
    const option = (value: string) =>
      `<option value="${esc(value)}">${esc(value)}</option>`;
    const selectors = [
      ['strategy', [...new Set(cards.map((c) => c.strategy))]],
      ['outcome', ['win', 'loss']],
      ['direction', ['LONG', 'SHORT']],
      ['pocket', [...new Set(cards.flatMap((c) => Object.keys(c.pockets)))]],
    ]
      .map(
        ([key, values]) =>
          `<label>${key} <select id="${key}"><option value="">all</option>${(values as string[]).map(option).join('')}</select></label>`,
      )
      .join(' ');
    const contrastTables = Object.entries(analysis)
      .map(
        ([strategy, bySide]) =>
          `<h3>${esc(strategy)}</h3>${Object.entries(bySide)
            .map(
              ([side, info]) =>
                `<h4>${side}</h4><table><tr><th>Pocket</th><th>Pass N / PnL</th><th>Fail N / PnL</th><th>Unknown</th></tr>${Object.entries(
                  info.pockets,
                )
                  .map(
                    ([name, p]) =>
                      `<tr><td>${esc(name)}</td><td>${p.pass.n} / ${p.pass.pnl.toFixed(2)}</td><td>${p.fail.n} / ${p.fail.pnl.toFixed(2)}</td><td>${p.unknown}</td></tr>`,
                  )
                  .join(
                    '',
                  )}</table><table><tr><th>Feature</th><th>Win / loss N</th><th>Win median</th><th>Loss median</th><th>Difference / IQR</th><th>Missing</th></tr>${info.contrasts
                  .filter(
                    (c) =>
                      c.wins >= 5 &&
                      c.losses >= 5 &&
                      c.medianDifferenceIqr !== null,
                  )
                  .sort(
                    (a, b) =>
                      Math.abs(b.medianDifferenceIqr!) -
                      Math.abs(a.medianDifferenceIqr!),
                  )
                  .slice(0, 20)
                  .map(
                    (c) =>
                      `<tr><td>${esc(c.feature)}</td><td>${c.wins} / ${c.losses}</td><td>${c.winMedian}</td><td>${c.lossMedian}</td><td>${c.medianDifferenceIqr?.toFixed(2)}</td><td>${c.missing}</td></tr>`,
                  )
                  .join('')}</table>`,
            )
            .join('')}`,
      )
      .join('');
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Trade atlas and drawdown groups</title><style>body{font:16px system-ui;color:#213547;background:#f3f6fa;margin:28px}h1{font-size:30px}section{margin:32px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:18px}article{background:white;padding:16px;border-radius:12px}img{width:100%}select{padding:8px}table{border-collapse:collapse;background:white;margin:16px 0;font-size:14px}td,th{padding:8px;border:1px solid #d9e2ec;text-align:left}a{color:#175eb9}.note{max-width:1100px}article[hidden]{display:none}</style><h1>Trade atlas and drawdown groups</h1><p class="note">${esc(manifest.populationClaim)}. Source: ${esc(dataset.source)}. ${esc(manifest.semantics)}</p><p>Input N=${dataset.trades.length}; selected charts=${cards.length}. Balanced win/loss selection is not a win-rate estimate. Associations below use ${dataset.population === 'complete' ? 'all supplied completed trades' : 'selected cases only, with selection bias'}.</p><p><a href="analysis.json">Full analysis and coverage</a> · <a href="manifest.json">Provenance</a> · <a href="chart-inputs.json.gz">Retained chart inputs</a></p><section><h2>Trade cases</h2>${selectors}<div class="grid">${cards.map((c) => `<article class="trade" data-strategy="${esc(c.strategy)}" data-outcome="${c.outcome}" data-direction="${c.direction}" data-pockets="${esc(JSON.stringify(c.pockets))}"><h3>${esc(c.strategy)} · ${esc(c.symbol)} · ${c.direction} · ${c.pnl.toFixed(2)}</h3><a href="${c.image}"><img loading="lazy" src="${c.image}" alt="${esc(c.id)}"></a><p>${esc(JSON.stringify(c.pockets))}</p><p>Missing bars: ${c.audit.missingCandles}; entry covered: ${c.audit.entryCovered}; exit covered: ${c.audit.exitCovered}</p><a href="${c.svg}">SVG</a></article>`).join('')}</div></section><section><h2>Pockets and feature contrasts</h2><p>Descriptive differences only. No optimized threshold, significance or profitability claim. Tables show features with at least 5 wins and 5 losses; JSON retains all support counts.</p>${contrastTables}</section><section><h2>Drawdown episodes</h2><p>${episodes ? 'Completed-trade equity; same-time exits netted. ALL is portfolio equity, LONG/SHORT are side-only equity. Group contributions overlap across dimensions and include recovery trades.' : 'Unavailable: selected charts cannot reconstruct portfolio drawdowns.'}</p><div class="grid">${drawdownCards
      .map(
        (e) =>
          `<article><h3>${e.direction} · ${e.id} · ${e.depth.toFixed(2)} USDT</h3><a href="${e.image}"><img loading="lazy" src="${e.image}" alt="${e.id}"></a><details><summary>Group contributions</summary><table><tr><th>Group</th><th>N</th><th>PnL</th></tr>${Object.entries(
            e.contributions,
          )
            .map(
              ([name, v]) =>
                `<tr><td>${esc(name)}</td><td>${v.n}</td><td>${v.pnl.toFixed(2)}</td></tr>`,
            )
            .join('')}</table></details></article>`,
      )
      .join(
        '',
      )}</div></section><script>for(const id of ['strategy','outcome','direction','pocket'])document.getElementById(id).addEventListener('change',()=>{for(const card of document.querySelectorAll('.trade'))card.hidden=['strategy','outcome','direction'].some(k=>document.getElementById(k).value&&card.dataset[k]!==document.getElementById(k).value)||(document.getElementById('pocket').value&&JSON.parse(card.dataset.pockets)[document.getElementById('pocket').value]!==true);});</script></html>`;
    await write('index.html', html);
    await fs.writeFile(
      path.join(out, 'manifest.json'),
      JSON.stringify(
        { ...manifest, status: 'complete', files: receipts },
        null,
        2,
      ),
    );
    return {
      outDir: out,
      selected: cards.length,
      episodes: drawdownCards.length,
    };
  } catch (error) {
    await fs.writeFile(
      path.join(out, 'manifest.json'),
      JSON.stringify(
        {
          ...manifest,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    throw error;
  }
}
