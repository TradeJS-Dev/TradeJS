import {
  tradeCandleWindow,
  type VisualTrade,
  type VisualCandle,
} from './model';
import type { DrawdownEpisode } from './analysis';
import { escapeResearchHtml as esc } from '../strategyResearch/reportFormat';
import { researchLineChart } from '../strategyResearch/charts';
export { esc };
const fmt = (n: number | null) =>
  n === null ? 'unknown' : Number(n.toPrecision(6)).toString();
const utc = (n: number) =>
  new Date(n).toISOString().slice(0, 16).replace('T', ' ');
const text = (
  x: number,
  y: number,
  value: unknown,
  size = 15,
  color = '#213547',
) =>
  `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${color}">${esc(String(value))}</text>`;
export function chartCandles(trade: VisualTrade): VisualCandle[] {
  const closes: number[] = [];
  return trade.candles.map((b) => {
    closes.push(b.close);
    const sma = (n: number) =>
      closes.length < n
        ? null
        : closes.slice(-n).reduce((s, v) => s + v, 0) / n;
    const mid = sma(20),
      sd =
        mid === null
          ? null
          : Math.sqrt(
              closes.slice(-20).reduce((s, v) => s + (v - mid) ** 2, 0) / 20,
            );
    return {
      ...b,
      smaFast: b.smaFast ?? sma(14),
      smaSlow: b.smaSlow ?? sma(50),
      bbUpper: b.bbUpper ?? (mid !== null && sd !== null ? mid + 2 * sd : null),
      bbLower: b.bbLower ?? (mid !== null && sd !== null ? mid - 2 * sd : null),
    };
  });
}
function pricePanel(
  t: VisualTrade,
  c: VisualCandle[],
  step: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (!c.length) return text(x, y + 30, 'No cached candles in this window');
  const times = c.map((b) => b.timestamp),
    start = times[0],
    end = times.at(-1)! + step;
  let low = Math.min(t.entryPrice, t.exitPrice, ...c.map((b) => b.low)),
    high = Math.max(t.entryPrice, t.exitPrice, ...c.map((b) => b.high));
  for (const v of [t.stop, t.target])
    if (v !== null) {
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
  const pad = (high - low) * 0.05 || 1;
  low -= pad;
  high += pad;
  const X = (v: number) => x + (w * (v - start)) / Math.max(1, end - start),
    Y = (v: number) => y + h - (h * (v - low)) / (high - low);
  const id = `clip-${x}-${y}`;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" stroke="#cbd5df"/>`;
  for (let i = 0; i <= 4; i++)
    s +=
      `<path d="M${x} ${y + (h * i) / 4}h${w}" stroke="#e5eaf0"/>` +
      text(
        x + w + 5,
        y + (h * i) / 4 + 4,
        fmt(high - ((high - low) * i) / 4),
        11,
      );
  s += `<defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs><g clip-path="url(#${id})">`;
  for (const z of t.figures.zones)
    s += `<rect x="${Math.min(X(z.start.timestamp), X(z.end.timestamp))}" y="${Math.min(Y(z.start.value), Y(z.end.value))}" width="${Math.abs(X(z.end.timestamp) - X(z.start.timestamp))}" height="${Math.abs(Y(z.end.value) - Y(z.start.value))}" fill="#dceafa" opacity=".5"/>`;
  const stride = Math.max(1, Math.ceil(c.length / 900)),
    width = Math.max(0.7, ((w * step) / (end - start)) * stride * 0.65);
  for (let i = 0; i < c.length; i += stride) {
    const a = c.slice(i, i + stride),
      first = a[0],
      last = a.at(-1)!,
      hi = Math.max(...a.map((b) => b.high)),
      lo = Math.min(...a.map((b) => b.low)),
      color = last.close >= first.open ? '#0a8069' : '#c73f52',
      xx = X(first.timestamp);
    s += `<path d="M${xx} ${Y(lo)}V${Y(hi)}" stroke="${color}"/><rect x="${xx - width / 2}" y="${Math.min(Y(first.open), Y(last.close))}" width="${width}" height="${Math.max(0.8, Math.abs(Y(first.open) - Y(last.close)))}" fill="${color}"/>`;
  }
  for (const [key, color] of [
    ['smaFast', '#d88b00'],
    ['smaSlow', '#8555cc'],
    ['bbUpper', '#8898ab'],
    ['bbLower', '#8898ab'],
  ]) {
    let previous: number | null = null;
    const path = c
      .map((b) => {
        const v = b[key];
        if (v == null) {
          previous = null;
          return '';
        }
        const command =
          previous === null || b.timestamp - previous !== step ? 'M' : 'L';
        previous = b.timestamp;
        return `${command}${X(b.timestamp)},${Y(v)}`;
      })
      .join(' ');
    s += `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.4"/>`;
  }
  for (const line of t.figures.lines)
    s += `<polyline points="${line.points.map((p) => `${X(p.timestamp)},${Y(p.value)}`).join(' ')}" fill="none" stroke="#0284c7" stroke-width="2"/>`;
  for (const group of t.figures.points)
    for (const p of group.points)
      s += `<circle cx="${X(p.timestamp)}" cy="${Y(p.value)}" r="3" fill="#0284c7"/>`;
  for (const [label, value, color] of [
    ['SL', t.stop, '#c73f52'],
    ['TP', t.target, '#0a8069'],
  ] as const)
    if (value !== null)
      s +=
        `<path d="M${x} ${Y(value)}h${w}" stroke="${color}" stroke-dasharray="5 4"/>` +
        text(x + 4, Y(value) - 5, label, 12, color);
  for (const [i, [label, timestamp, value]] of (
    [
      ['SIGNAL', t.signalTime, null],
      ['ENTRY', t.entryTime, t.entryPrice],
      ['EXIT', t.exitTime, t.exitPrice],
    ] as const
  ).entries())
    if (timestamp >= start && timestamp <= end) {
      s +=
        `<path d="M${X(timestamp)} ${y}v${h}" stroke="#2563eb" stroke-dasharray="3 4"/>` +
        text(
          Math.max(x + 3, Math.min(x + w - 75, X(timestamp) + 4)),
          y + 17 + i * 17,
          label,
          12,
        );
      if (value !== null)
        s += `<circle cx="${X(timestamp)}" cy="${Y(value)}" r="5" fill="white" stroke="#2563eb" stroke-width="2"/>`;
    }
  return (
    s +
    '</g>' +
    text(x, y + h + 20, utc(start), 12) +
    text(x + w - 145, y + h + 20, utc(end), 12) +
    text(
      x,
      y - 8,
      `OHLC aggregation: ${stride} native bars per displayed candle`,
      11,
    )
  );
}
export function renderTradeSvg(t: VisualTrade, intervalMs: number) {
  const candles = chartCandles({
    ...t,
    candles: tradeCandleWindow(t, intervalMs),
  });
  const start = Math.min(
      t.signalTime - 90 * intervalMs,
      t.entryTime - 90 * intervalMs,
    ),
    end = t.exitTime + 20 * intervalMs;
  const visible = candles.filter(
    (c) => c.timestamp >= start && c.timestamp <= end,
  );
  const held = candles.filter(
      (b) =>
        b.timestamp >= t.entryTime && b.timestamp + intervalMs <= t.exitTime,
    ),
    risk = t.stop === null ? null : Math.abs(t.entryPrice - t.stop),
    sign = t.direction === 'LONG' ? 1 : -1;
  const expected = visible.length
    ? Math.floor(
        (visible.at(-1)!.timestamp - visible[0].timestamp) / intervalMs,
      ) + 1
    : 0;
  const complete =
    held.length > 0 &&
    held[0].timestamp === t.entryTime &&
    held.at(-1)!.timestamp + intervalMs === t.exitTime &&
    held.every(
      (b, i) => !i || b.timestamp - held[i - 1].timestamp === intervalMs,
    );
  const mfe =
      complete && risk
        ? Math.max(
            0,
            ...held.map(
              (b) =>
                (sign === 1 ? b.high - t.entryPrice : t.entryPrice - b.low) /
                risk,
            ),
          )
        : null,
    mae =
      complete && risk
        ? Math.max(
            0,
            ...held.map(
              (b) =>
                (sign === 1 ? t.entryPrice - b.low : b.high - t.entryPrice) /
                risk,
            ),
          )
        : null;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1050" viewBox="0 0 1600 1050"><rect width="1600" height="1050" fill="#f3f6fa"/>`;
  svg +=
    text(40, 35, `${t.strategy} · ${t.symbol} · ${t.direction}`, 25) +
    text(
      40,
      64,
      `${t.pnl > 0 ? 'WIN' : t.pnl < 0 ? 'LOSS' : 'FLAT'} · net ${fmt(t.pnl)} USDT · ${utc(t.entryTime)} → ${utc(t.exitTime)} UTC`,
      17,
    );
  svg += text(
    40,
    88,
    'Saved indicator series when supplied; otherwise analytical SMA14/50 and BB20 ±2σ (not strategy calculations).',
    12,
  );
  svg += pricePanel(t, visible, intervalMs, 40, 120, 1440, 330);
  const maxVolume = Math.max(1, ...visible.map((b) => b.volume));
  svg += text(40, 497, 'Native-bar volume', 13);
  for (const b of visible) {
    const x =
      40 +
      (1440 * (b.timestamp - (visible[0]?.timestamp ?? 0))) /
        Math.max(
          1,
          (visible.at(-1)?.timestamp ?? 0) +
            intervalMs -
            (visible[0]?.timestamp ?? 0),
        );
    svg += `<path d="M${x} 575v${(-65 * b.volume) / maxVolume}" stroke="#8cabbc"/>`;
  }
  svg +=
    text(
      40,
      615,
      'Entry detail: signal and actual fill are separate events',
      15,
    ) +
    pricePanel(
      t,
      candles.filter(
        (b) =>
          b.timestamp >= t.signalTime - 30 * intervalMs &&
          b.timestamp <= t.entryTime + 12 * intervalMs,
      ),
      intervalMs,
      40,
      645,
      960,
      260,
    );
  const details = [
    `Entry ${fmt(t.entryPrice)} / exit ${fmt(t.exitPrice)}`,
    `MFE ${fmt(mfe)} R / MAE ${fmt(mae)} R`,
    `Full held bars available: ${complete}`,
    `Missing display bars: ${expected - visible.length}`,
    `Pockets: ${
      Object.entries(t.pockets)
        .map(([k, v]) => `${k}=${v ? 'pass' : 'fail'}`)
        .join(', ') || 'unknown'
    }`,
  ];
  details.forEach(
    (v, i) =>
      (svg += text(
        1080,
        665 + i * 38,
        v.length > 58 ? v.slice(0, 55) + '…' : v,
        13,
      )),
  );
  svg +=
    text(
      40,
      960,
      'MFE/MAE exclude partial entry/exit bars and require complete held coverage; these are retrospective diagnostics.',
      13,
    ) +
    text(40, 988, `Trade ID: ${t.id}`.slice(0, 180), 12) +
    text(
      40,
      1015,
      'Outcome-balanced charts describe cases, not the population win rate. Pocket overlays do not simulate skipped entries.',
      12,
    );
  return {
    svg: svg + '</svg>',
    audit: {
      visibleCandles: visible.length,
      missingCandles: expected - visible.length,
      completeHeld: complete,
      mfeR: mfe,
      maeR: mae,
      entryCovered: visible.some(
        (b) =>
          b.timestamp <= t.entryTime && b.timestamp + intervalMs > t.entryTime,
      ),
      exitCovered: visible.some(
        (b) =>
          b.timestamp <= t.exitTime && b.timestamp + intervalMs > t.exitTime,
      ),
    },
  };
}
export function renderDrawdownSvg(episode: DrawdownEpisode) {
  const curve = researchLineChart(
    [
      { label: 'Realized equity', points: episode.points, color: '#2563eb' },
      {
        label: 'Prior peak',
        points: [
          [episode.start, episode.peak],
          [episode.end, episode.peak],
        ],
        color: '#c73f52',
      },
    ],
    episode.id,
  );
  const plot = curve
    .slice(curve.indexOf('<svg'), curve.indexOf('</svg>') + 6)
    .replace(
      'viewBox="0 0 960 285"',
      'x="20" y="100" width="1160" height="360" viewBox="0 0 960 285"',
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#f3f6fa"/>${text(35, 35, `${episode.id}: depth ${fmt(episode.depth)} USDT`, 24)}${text(35, 65, `${utc(episode.start)} → ${utc(episode.end)} UTC · ${episode.recovered ? 'recovered' : 'unrecovered / right-censored'}`, 16)}${plot}${Object.entries(
    episode.contributions,
  )
    .filter(([k]) => k.startsWith('symbol:'))
    .sort((a, b) => a[1].pnl - b[1].pnl)
    .slice(0, 5)
    .map(([k, v], i) =>
      text(40, 500 + i * 30, `${k} · N=${v.n} · PnL=${fmt(v.pnl)}`, 16),
    )
    .join(
      '',
    )}${text(35, 675, 'Completed-trade equity; simultaneous exits netted. Includes recovery trades. Not mark-to-market drawdown.', 13)}</svg>`;
}
