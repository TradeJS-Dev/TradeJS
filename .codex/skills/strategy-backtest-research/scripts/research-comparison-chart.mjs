#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'tradejs-research-comparison-chart/v1';
const SUMMARY_SCHEMA = 'tradejs-research-comparison-chart-summary/v1';
const MAX_SERIES = 24;
const MAX_INPUT_POINTS = 200_000;
const MAX_RENDER_POINTS = 1_200;
const ROLES = new Set(['baseline', 'candidate', 'reference', 'diagnostic']);
const EQUITY_STATUSES = new Set(['observed', 'verified-empty', 'unavailable']);
const ROLE_LABELS = {
  baseline: 'BASELINE',
  candidate: 'CANDIDATE',
  reference: 'REFERENCE',
  diagnostic: 'DIAGNOSTIC',
};
const DEFAULT_COLORS = [
  '#1e456a',
  '#087d69',
  '#8b5cf6',
  '#d97706',
  '#b42318',
  '#2563eb',
  '#64748b',
  '#be185d',
];

const fail = (message) => {
  throw new Error(message);
};

const textValue = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${name} must be a non-empty string`);
  }
  return value.trim();
};

const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${name} must be a finite number`);
  }
  return value;
};

const integer = (value, name) => {
  const resolved = finite(value, name);
  if (!Number.isInteger(resolved)) fail(`${name} must be an integer`);
  return resolved;
};

const nonNegativeInteger = (value, name) => {
  const resolved = integer(value, name);
  if (resolved < 0) fail(`${name} must be non-negative`);
  return resolved;
};

const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
};

const stableStringify = (value) => JSON.stringify(stableValue(value));

const resolveColor = (value, index) => {
  const color = value ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/u.test(color)) {
    fail(`series[${index}].color must be a six-digit hex color`);
  }
  return color.toLowerCase();
};

const validatePoint = (point, name) => {
  if (!Array.isArray(point) || point.length !== 2) {
    fail(`${name} must be [timestamp, value]`);
  }
  return [integer(point[0], `${name}[0]`), finite(point[1], `${name}[1]`)];
};

const buildTradeCurve = ({ trades, start, end, name }) => {
  if (!Array.isArray(trades)) fail(`${name}.trades must be an array`);
  if (trades.length > MAX_INPUT_POINTS) {
    fail(`${name}.trades exceeds the ${MAX_INPUT_POINTS} point limit`);
  }
  const ordered = trades
    .map((point, index) => {
      const [timestamp, pnl] = validatePoint(point, `${name}.trades[${index}]`);
      if (timestamp < start || timestamp >= end) {
        fail(`${name}.trades[${index}] is outside the comparison window`);
      }
      return { timestamp, pnl, index };
    })
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.index - right.index,
    );
  let cumulative = 0;
  let peak = 0;
  let streak = 0;
  const points = [[start, 0, 0, 0]];
  for (const trade of ordered) {
    cumulative += trade.pnl;
    peak = Math.max(peak, cumulative);
    streak = trade.pnl < 0 ? streak + 1 : 0;
    points.push([trade.timestamp, cumulative, peak - cumulative, streak]);
  }
  points.push([end, cumulative, peak - cumulative, streak]);
  return {
    points,
    trades: ordered.length,
    pnl: cumulative,
    renderStatus: 'observed',
    streakSemantics: 'consecutive losing completed trades',
  };
};

const buildEquityCurve = ({
  equity,
  equityStatus,
  metrics,
  start,
  end,
  name,
}) => {
  if (!Array.isArray(equity)) fail(`${name}.equity must be an array`);
  if (equity.length > MAX_INPUT_POINTS) {
    fail(`${name}.equity exceeds the ${MAX_INPUT_POINTS} point limit`);
  }
  const renderStatus = equityStatus ?? 'observed';
  if (!EQUITY_STATUSES.has(renderStatus)) {
    fail(`${name}.equityStatus is invalid`);
  }
  if (renderStatus === 'observed' && equity.length === 0) {
    fail(`${name}.equity must be non-empty when observed`);
  }
  if (renderStatus !== 'observed' && equity.length !== 0) {
    fail(`${name}.equity must be empty unless equityStatus is observed`);
  }
  const trades = nonNegativeInteger(metrics?.trades, `${name}.metrics.trades`);
  const metricPnl = finite(metrics?.pnl, `${name}.metrics.pnl`);
  if (renderStatus === 'verified-empty') {
    if (trades !== 0 || metricPnl !== 0) {
      fail(`${name} verified-empty equity requires zero trades and PnL`);
    }
    return {
      points: [
        [start, 0, 0, 0],
        [end, 0, 0, 0],
      ],
      trades,
      pnl: metricPnl,
      renderStatus,
      streakSemantics: 'no observed completed trades',
    };
  }
  if (renderStatus === 'unavailable') {
    return {
      points: [],
      trades,
      pnl: metricPnl,
      renderStatus,
      streakSemantics: 'unavailable',
    };
  }
  let previousTimestamp = -Infinity;
  let previousPnl = 0;
  let peak = 0;
  let streak = 0;
  const points = [];
  for (const [index, rawPoint] of equity.entries()) {
    const [timestamp, cumulative] = validatePoint(
      rawPoint,
      `${name}.equity[${index}]`,
    );
    if (timestamp < start || timestamp >= end) {
      fail(`${name}.equity[${index}] is outside the comparison window`);
    }
    if (timestamp <= previousTimestamp) {
      fail(`${name}.equity timestamps must be strictly increasing`);
    }
    const delta = cumulative - previousPnl;
    peak = Math.max(peak, cumulative);
    streak = delta < 0 ? streak + 1 : 0;
    points.push([timestamp, cumulative, peak - cumulative, streak]);
    previousTimestamp = timestamp;
    previousPnl = cumulative;
  }
  return {
    points,
    trades,
    pnl: previousPnl,
    renderStatus,
    streakSemantics: 'consecutive negative realized-equity steps',
  };
};

export const validateResearchComparisonSpec = (input) => {
  if (!input || typeof input !== 'object') fail('spec must be an object');
  if (input.schema !== SCHEMA) fail(`spec.schema must be ${SCHEMA}`);
  const window = {
    start: integer(input.window?.start, 'window.start'),
    end: integer(input.window?.end, 'window.end'),
    ...(input.window?.highlightStart === undefined
      ? {}
      : {
          highlightStart: integer(
            input.window.highlightStart,
            'window.highlightStart',
          ),
        }),
  };
  if (window.end <= window.start) fail('window.end must be after window.start');
  if (
    window.highlightStart !== undefined &&
    (window.highlightStart <= window.start ||
      window.highlightStart >= window.end)
  ) {
    fail('window.highlightStart must be inside the comparison window');
  }
  if (
    !Array.isArray(input.series) ||
    input.series.length < 1 ||
    input.series.length > MAX_SERIES
  ) {
    fail(`series must contain between 1 and ${MAX_SERIES} entries`);
  }
  const ids = new Set();
  const series = input.series.map((entry, index) => {
    const name = `series[${index}]`;
    const id = textValue(entry?.id, `${name}.id`);
    if (ids.has(id)) fail(`duplicate series id: ${id}`);
    ids.add(id);
    const role = textValue(entry.role, `${name}.role`);
    if (!ROLES.has(role)) fail(`${name}.role is invalid`);
    if ((entry.trades === undefined) === (entry.equity === undefined)) {
      fail(`${name} must declare exactly one of trades or equity`);
    }
    const curve =
      entry.trades !== undefined
        ? buildTradeCurve({
            trades: entry.trades,
            start: window.start,
            end: window.end,
            name,
          })
        : buildEquityCurve({
            equity: entry.equity,
            equityStatus: entry.equityStatus,
            metrics: entry.metrics,
            start: window.start,
            end: window.end,
            name,
          });
    if (entry.metrics !== undefined) {
      const expectedTrades = nonNegativeInteger(
        entry.metrics.trades,
        `${name}.metrics.trades`,
      );
      const expectedPnl = finite(entry.metrics.pnl, `${name}.metrics.pnl`);
      if (entry.trades !== undefined && expectedTrades !== curve.trades) {
        fail(`${name}.metrics.trades does not match trades.length`);
      }
      if (
        curve.renderStatus !== 'unavailable' &&
        Math.abs(expectedPnl - curve.pnl) > 0.01
      ) {
        fail(`${name}.metrics.pnl does not match final cumulative PnL`);
      }
    }
    return {
      id,
      label: textValue(entry.label, `${name}.label`),
      role,
      color: resolveColor(entry.color, index),
      source: entry.trades === undefined ? 'equity' : 'trades',
      ...curve,
    };
  });
  if (series.filter(({ role }) => role === 'baseline').length !== 1) {
    fail('series must contain exactly one explicit baseline');
  }
  return {
    schema: SCHEMA,
    title: textValue(input.title, 'title'),
    subtitle: textValue(input.subtitle, 'subtitle'),
    universeLabel: textValue(input.universeLabel, 'universeLabel'),
    pnlUnit: textValue(input.pnlUnit, 'pnlUnit'),
    window,
    series,
  };
};

const formatNumber = (value, digits = 2) => {
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toFixed(digits);
};

const truncate = (value, maxLength) =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;

const formatAxis = (value) => {
  const normalized = Math.abs(value) < 1e-9 ? 0 : value;
  if (Math.abs(normalized) >= 1_000_000) {
    return `${formatNumber(normalized / 1_000_000, 1)}m`;
  }
  if (Math.abs(normalized) >= 1_000) {
    return `${formatNumber(normalized / 1_000, 1)}k`;
  }
  if (Number.isInteger(normalized)) return String(normalized);
  return formatNumber(normalized, 1);
};

const niceScale = (values, divisions = 5) => {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const rawStep = Math.max(1e-9, (high - low || 1) / divisions);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const scaled = rawStep / magnitude;
  const stepMultiplier =
    scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  const step = stepMultiplier * magnitude;
  const min = Math.floor(low / step) * step;
  const max = Math.max(min + step, Math.ceil(high / step) * step);
  return { min, max, step };
};

const downsample = (points, maxPoints = MAX_RENDER_POINTS) => {
  if (points.length <= maxPoints) return points;
  const selected = new Set([0, points.length - 1]);
  const buckets = Math.max(1, Math.floor((maxPoints - 2) / 6));
  const bucketSize = (points.length - 2) / buckets;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = 1 + Math.floor(bucket * bucketSize);
    const end = Math.min(
      points.length - 1,
      1 + Math.floor((bucket + 1) * bucketSize),
    );
    const indices = Array.from(
      { length: Math.max(1, end - start) },
      (_, offset) => Math.min(points.length - 2, start + offset),
    );
    for (const field of [1, 2, 3]) {
      selected.add(
        indices.reduce((best, index) =>
          points[index][field] < points[best][field] ? index : best,
        ),
      );
      selected.add(
        indices.reduce((best, index) =>
          points[index][field] > points[best][field] ? index : best,
        ),
      );
    }
  }
  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => points[index]);
};

const isoDate = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);

const text = (x, y, value, attributes = '') =>
  `<text x="${x}" y="${y}" ${attributes}>${escapeXml(value)}</text>`;

const renderValidatedResearchComparisonSvg = (spec) => {
  const width = 1280;
  const left = 92;
  const right = 1228;
  const plotWidth = right - left;
  const legendColumns = 2;
  const legendRows = Math.ceil(spec.series.length / legendColumns);
  const height = 795 + Math.max(0, legendRows - 1) * 52;
  const x = (timestamp) =>
    left +
    ((timestamp - spec.window.start) / (spec.window.end - spec.window.start)) *
      plotWidth;
  const renderedSeries = spec.series.map((entry) => ({
    ...entry,
    renderedPoints: downsample(entry.points),
  }));
  const drawPanel = ({ top, panelHeight, field, title: panelTitle, dates }) => {
    const values = spec.series.flatMap(({ points }) =>
      points.map((point) => point[field]),
    );
    const scale = niceScale(values);
    const y = (value) =>
      top +
      panelHeight -
      ((value - scale.min) / (scale.max - scale.min)) * panelHeight;
    const nodes = [text(left, top - 12, panelTitle, 'class="heading"')];
    if (spec.window.highlightStart !== undefined) {
      nodes.push(
        `<rect x="${x(spec.window.highlightStart)}" y="${top}" width="${right - x(spec.window.highlightStart)}" height="${panelHeight}" class="highlight"/>`,
      );
    }
    for (
      let value = scale.min, guard = 0;
      value <= scale.max + scale.step / 2 && guard < 20;
      value += scale.step, guard += 1
    ) {
      const yy = y(value);
      nodes.push(
        `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" class="grid" data-value-tick="${value}"${field === 1 ? ` data-pnl-tick="${value}"` : ''}/>`,
        text(
          left - 8,
          yy + 4,
          formatAxis(value),
          'text-anchor="end" class="axis"',
        ),
      );
    }
    for (let index = 0; index <= 6; index += 1) {
      const timestamp =
        spec.window.start + (index / 6) * (spec.window.end - spec.window.start);
      const xx = x(timestamp);
      nodes.push(
        `<line x1="${xx}" y1="${top}" x2="${xx}" y2="${top + panelHeight}" class="grid"${dates ? ` data-utc-tick="${timestamp}"` : ''}/>`,
      );
      if (dates) {
        nodes.push(
          text(
            xx,
            top + panelHeight + 22,
            isoDate(timestamp),
            'text-anchor="middle" class="axis"',
          ),
        );
      }
    }
    for (const entry of renderedSeries) {
      if (entry.renderStatus === 'unavailable') continue;
      const points = entry.renderedPoints
        .map(
          (point) => `${x(point[0]).toFixed(2)},${y(point[field]).toFixed(2)}`,
        )
        .join(' ');
      nodes.push(
        entry.renderedPoints.length === 1
          ? `<circle cx="${x(entry.renderedPoints[0][0]).toFixed(2)}" cy="${y(entry.renderedPoints[0][field]).toFixed(2)}" r="3" data-series="${escapeXml(entry.id)}" fill="${entry.color}"/>`
          : `<polyline points="${points}" data-series="${escapeXml(entry.id)}"${entry.renderStatus === 'verified-empty' ? ` data-zero-guide="${escapeXml(entry.id)}" stroke-dasharray="8 8"` : ''} stroke="${entry.color}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
      );
    }
    return nodes.join('');
  };
  const metadata = `Date (UTC): ${isoDate(spec.window.start)} — ${isoDate(spec.window.end)} · ${spec.universeLabel}${spec.window.highlightStart === undefined ? '' : ' · заливка показывает выделенный период'}`;
  const legend = spec.series
    .map((entry, index) => {
      const column = index % legendColumns;
      const row = Math.floor(index / legendColumns);
      const lx = left + 570 * column;
      const ly = 728 + 52 * row;
      const label = `${ROLE_LABELS[entry.role]} · ${truncate(entry.label, 48)}`;
      const availability =
        entry.renderStatus === 'verified-empty'
          ? ' · EMPTY (zero guide)'
          : entry.renderStatus === 'unavailable'
            ? ' · UNKNOWN (no equity)'
            : '';
      const availabilityDetail =
        entry.renderStatus === 'verified-empty'
          ? '<desc>verified empty; zero guide is not observed equity</desc>'
          : entry.renderStatus === 'unavailable'
            ? '<desc>equity unavailable (UNKNOWN)</desc>'
            : '';
      return `<g data-legend="${escapeXml(entry.id)}" data-role="${entry.role}" data-equity-legend="${escapeXml(entry.id)}" transform="translate(${lx},${ly})"><title>${escapeXml(entry.label)}</title>${availabilityDetail}<rect width="12" height="12" rx="3" fill="${entry.color}"/>${text(19, 10, label, 'class="heading"')}${text(19, 31, `N=${entry.trades} · PnL ${formatNumber(entry.pnl)} ${spec.pnlUnit}${availability}`, 'class="axis"')}</g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(spec.title)}">
<title>${escapeXml(spec.title)}</title>
<desc>${escapeXml(`${spec.subtitle}. Baseline and every comparison series are labelled by role.`)}</desc>
<style>text{font:14px Arial,sans-serif;fill:#172842}.axis{fill:#526680;font-size:12px}.heading{font-weight:700;font-size:15px}.grid{stroke:#dce6ef;stroke-width:1}.highlight{fill:#edf4f9}</style>
<rect width="100%" height="100%" fill="#fff"/>
${text(left, 42, spec.title, 'style="font-size:28px;font-weight:700"')}
${text(left, 69, metadata, 'class="axis"')}
${text(left, 88, spec.subtitle, 'class="axis"')}
${drawPanel({ top: 120, panelHeight: 232, field: 1, title: 'Накопленный net PnL после комиссий и проскальзывания', dates: false })}
${drawPanel({ top: 395, panelHeight: 128, field: 2, title: 'Просадка от максимума net PnL', dates: false })}
${drawPanel({ top: 566, panelHeight: 110, field: 3, title: 'Последовательные убыточные сделки / отрицательные шаги equity', dates: true })}
${legend}
</svg>`;
};

export const renderResearchComparisonSvg = (input) =>
  renderValidatedResearchComparisonSvg(validateResearchComparisonSpec(input));

const renderPng = async (svg, outputPath) => {
  const { default: sharp } = await import('sharp');
  await writeFile(outputPath, await sharp(Buffer.from(svg)).png().toBuffer(), {
    flag: 'wx',
  });
};

export const generateResearchComparisonChart = async ({
  spec,
  outBase,
  png = true,
}) => {
  const validated = validateResearchComparisonSpec(spec);
  const absoluteBase = path.resolve(outBase);
  await mkdir(path.dirname(absoluteBase), { recursive: true });
  const svg = `${renderValidatedResearchComparisonSvg(validated)}\n`;
  const svgPath = `${absoluteBase}.svg`;
  const pngPath = `${absoluteBase}.png`;
  const summaryPath = `${absoluteBase}.summary.json`;
  await writeFile(svgPath, svg, { flag: 'wx' });
  const artifacts = { [path.basename(svgPath)]: sha256(svg) };
  if (png) {
    await renderPng(svg, pngPath);
    artifacts[path.basename(pngPath)] = sha256(await readFile(pngPath));
  }
  const summary = {
    schema: SUMMARY_SCHEMA,
    inputSha256: sha256(stableStringify(spec)),
    window: validated.window,
    pnlUnit: validated.pnlUnit,
    rendering: {
      interpolation: 'linear-between-realized-observations',
      maxRenderPointsPerSeries: MAX_RENDER_POINTS,
      metricsUseFullResolution: true,
      panels: ['cumulative-net-pnl', 'realized-drawdown', 'loss-streak'],
      rolesAreExplicit: true,
    },
    series: validated.series.map((entry) => ({
      id: entry.id,
      label: entry.label,
      role: entry.role,
      source: entry.source,
      trades: entry.trades,
      pnl: entry.pnl,
      fullResolutionPoints: entry.points.length,
      streakSemantics: entry.streakSemantics,
      renderStatus: entry.renderStatus,
    })),
    artifacts,
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
    flag: 'wx',
  });
  return { svgPath, ...(png ? { pngPath } : {}), summaryPath, summary };
};

const parseArgs = (args) => {
  const options = { png: true };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--no-png') {
      options.png = false;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith('--')) fail(`Value required: ${key}`);
    if (key === '--spec') options.specPath = value;
    else if (key === '--out') options.outBase = value;
    else fail(`Unknown option: ${key}`);
  }
  if (!options.specPath) fail('--spec is required');
  if (!options.outBase) fail('--out is required');
  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const spec = JSON.parse(
    await readFile(path.resolve(options.specPath), 'utf8'),
  );
  process.stdout.write(
    `${JSON.stringify(await generateResearchComparisonChart({ spec, outBase: options.outBase, png: options.png }), null, 2)}\n`,
  );
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
