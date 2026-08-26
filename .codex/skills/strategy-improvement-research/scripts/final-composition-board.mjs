#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'tradejs-final-composition-board/v1';
const REQUIRED_WINDOWS = [365, 180, 90, 30, 7];
const SHA256_RE = /^[a-f0-9]{64}$/u;
const DIRECTION_POLICIES = new Set([
  'both',
  'long_only',
  'short_only',
  'direction_aware',
]);
const GATE_SOURCES = new Set(['current', 'variant']);

const fail = (message) => {
  throw new Error(message);
};

const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${name} must be a finite number`);
  }
  return value;
};

const nonNegative = (value, name) => {
  const resolved = finite(value, name);
  if (resolved < 0) fail(`${name} must be non-negative`);
  return resolved;
};

const integer = (value, name) => {
  const resolved = finite(value, name);
  if (!Number.isInteger(resolved)) fail(`${name} must be an integer`);
  return resolved;
};

const textValue = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${name} must be a non-empty string`);
  }
  return value.trim();
};

const shaValue = (value, name) => {
  const resolved = textValue(value, name);
  if (!SHA256_RE.test(resolved)) fail(`${name} must be a lowercase SHA-256`);
  return resolved;
};

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

export const stableStringify = (value) => JSON.stringify(stableValue(value));

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const sha256File = async (filePath) => {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
};

const resolveArtifact = (artifactRoot, artifact, name) => {
  if (!artifact || typeof artifact !== 'object') {
    fail(`${name} must be an artifact object`);
  }
  const declaredPath = textValue(artifact.path, `${name}.path`);
  const expectedSha256 = shaValue(artifact.sha256, `${name}.sha256`);
  const root = path.resolve(artifactRoot);
  const absolutePath = path.resolve(root, declaredPath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    fail(`${name}.path escapes artifact root: ${declaredPath}`);
  }
  return { declaredPath, absolutePath, expectedSha256 };
};

const validateMetrics = (metrics, name) => {
  if (!metrics || typeof metrics !== 'object') fail(`${name} is required`);
  return {
    trades: nonNegative(
      integer(metrics.trades, `${name}.trades`),
      `${name}.trades`,
    ),
    pnl: finite(metrics.pnl, `${name}.pnl`),
    profitFactor:
      metrics.profitFactor === null
        ? null
        : nonNegative(metrics.profitFactor, `${name}.profitFactor`),
    maxDrawdown: nonNegative(metrics.maxDrawdown, `${name}.maxDrawdown`),
  };
};

const validateTerminal = (terminal, name) => {
  if (!Array.isArray(terminal)) fail(`${name} must be an array`);
  const byDays = new Map();
  for (const [index, row] of terminal.entries()) {
    const days = integer(row?.days, `${name}[${index}].days`);
    if (byDays.has(days)) fail(`${name} contains duplicate ${days}d`);
    byDays.set(days, {
      days,
      trades: nonNegative(
        integer(row?.trades, `${name}[${index}].trades`),
        `${name}[${index}].trades`,
      ),
      pnl: finite(row?.pnl, `${name}[${index}].pnl`),
    });
  }
  if (
    REQUIRED_WINDOWS.some((days) => !byDays.has(days)) ||
    byDays.size !== REQUIRED_WINDOWS.length
  ) {
    fail(`${name} must contain exactly 365d, 180d, 90d, 30d, and 7d`);
  }
  return REQUIRED_WINDOWS.map((days) => byDays.get(days));
};

const validateEquity = (equity, name, comparisonWindow, expectedPnl) => {
  if (!Array.isArray(equity) || equity.length < 2) {
    fail(`${name} must contain at least two [timestamp, pnl] points`);
  }
  let previous = -Infinity;
  const resolved = equity.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) {
      fail(`${name}[${index}] must be [timestamp, pnl]`);
    }
    const timestamp = integer(point[0], `${name}[${index}][0]`);
    const pnl = finite(point[1], `${name}[${index}][1]`);
    if (timestamp <= previous)
      fail(`${name} timestamps must be strictly increasing`);
    if (
      timestamp < comparisonWindow.start ||
      timestamp >= comparisonWindow.end
    ) {
      fail(`${name}[${index}] is outside the common comparison window`);
    }
    previous = timestamp;
    return [timestamp, pnl];
  });
  if (Math.abs(resolved.at(-1)[1] - expectedPnl) > 0.01) {
    fail(`${name} final PnL must match metrics.pnl within 0.01`);
  }
  return resolved;
};

const compositionFingerprint = (composition) =>
  sha256(
    stableStringify({
      kind: composition.kind,
      gateSource: composition.gateSource,
      coreResearchId: composition.coreResearchId,
      coreConfigSha256: composition.coreConfigSha256,
      coreResultSha256: composition.coreResult.sha256,
      coreExportSha256: composition.coreExport.sha256,
      gateReportSha256: composition.gateReport.sha256,
      gateAuthoritySha256: composition.gateAuthority?.sha256 ?? null,
      gateFingerprint: composition.gateFingerprint,
      configFingerprint: composition.configFingerprint,
      contextFingerprint: composition.contextFingerprint,
      directionPolicy: composition.directionPolicy,
      minQuality: composition.minQuality,
    }),
  );

export const validateBoardSpec = (input) => {
  if (!input || typeof input !== 'object') fail('spec must be an object');
  if (input.schema !== SCHEMA) fail(`spec.schema must be ${SCHEMA}`);
  const strategy = textValue(input.strategy, 'strategy');
  const researchId = textValue(input.researchId, 'researchId');
  const title = textValue(input.title, 'title');
  const subtitle = textValue(input.subtitle, 'subtitle');
  const baselineId = textValue(input.baselineId, 'baselineId');
  const selectedId = textValue(input.selectedId, 'selectedId');
  const comparisonWindow = {
    start: integer(input.comparisonWindow?.start, 'comparisonWindow.start'),
    end: integer(input.comparisonWindow?.end, 'comparisonWindow.end'),
  };
  if (comparisonWindow.end <= comparisonWindow.start) {
    fail('comparisonWindow.end must be greater than comparisonWindow.start');
  }
  const normalization = {
    pnlUnit: textValue(input.normalization?.pnlUnit, 'normalization.pnlUnit'),
    maxLossValue: nonNegative(
      input.normalization?.maxLossValue,
      'normalization.maxLossValue',
    ),
  };
  if (!Array.isArray(input.candidates) || input.candidates.length < 2) {
    fail('candidates must contain a gated baseline and at least one candidate');
  }
  const ids = new Set();
  const candidates = input.candidates.map((candidate, index) => {
    const name = `candidates[${index}]`;
    const id = textValue(candidate?.id, `${name}.id`);
    if (ids.has(id)) fail(`duplicate candidate id: ${id}`);
    ids.add(id);
    const role = textValue(candidate.role, `${name}.role`);
    if (!['baseline', 'candidate'].includes(role)) {
      fail(`${name}.role must be baseline or candidate`);
    }
    const riskUnit = nonNegative(candidate.riskUnit, `${name}.riskUnit`);
    if (riskUnit !== normalization.maxLossValue) {
      fail(`${name}.riskUnit must equal normalization.maxLossValue`);
    }
    const composition = candidate.composition;
    if (!composition || composition.kind !== 'core+deterministic-gate') {
      fail(`${name}.composition.kind must be core+deterministic-gate`);
    }
    const directionPolicy = textValue(
      composition.directionPolicy,
      `${name}.composition.directionPolicy`,
    );
    if (!DIRECTION_POLICIES.has(directionPolicy)) {
      fail(`${name}.composition.directionPolicy is invalid`);
    }
    const gateSource = textValue(
      composition.gateSource,
      `${name}.composition.gateSource`,
    );
    if (!GATE_SOURCES.has(gateSource)) {
      fail(`${name}.composition.gateSource must be current or variant`);
    }
    if (role === 'baseline' && gateSource !== 'current') {
      fail(`${name} baseline must use the current AI-gate`);
    }
    if (role === 'candidate' && gateSource !== 'variant') {
      fail(`${name} candidate must use its own frozen gate variant`);
    }
    if (gateSource === 'current' && !composition.gateAuthority) {
      fail(`${name}.composition.gateAuthority is required for current gate`);
    }
    if (gateSource === 'variant' && composition.gateAuthority !== undefined) {
      fail(`${name}.composition.gateAuthority is reserved for current gate`);
    }
    const resolvedComposition = {
      kind: composition.kind,
      gateSource,
      coreResearchId: textValue(
        composition.coreResearchId,
        `${name}.composition.coreResearchId`,
      ),
      coreConfigSha256: shaValue(
        composition.coreConfigSha256,
        `${name}.composition.coreConfigSha256`,
      ),
      coreResult: composition.coreResult,
      coreExport: composition.coreExport,
      gateReport: composition.gateReport,
      ...(gateSource === 'current'
        ? { gateAuthority: composition.gateAuthority }
        : {}),
      gateFingerprint: shaValue(
        composition.gateFingerprint,
        `${name}.composition.gateFingerprint`,
      ),
      configFingerprint: shaValue(
        composition.configFingerprint,
        `${name}.composition.configFingerprint`,
      ),
      contextFingerprint: shaValue(
        composition.contextFingerprint,
        `${name}.composition.contextFingerprint`,
      ),
      directionPolicy,
      minQuality: nonNegative(
        integer(composition.minQuality, `${name}.composition.minQuality`),
        `${name}.composition.minQuality`,
      ),
    };
    const metrics = validateMetrics(candidate.metrics, `${name}.metrics`);
    return {
      id,
      label: textValue(candidate.label, `${name}.label`),
      role,
      status: textValue(candidate.status, `${name}.status`),
      color: textValue(candidate.color, `${name}.color`),
      riskUnit,
      composition: resolvedComposition,
      metrics,
      terminal: validateTerminal(candidate.terminal, `${name}.terminal`),
      equity: validateEquity(
        candidate.equity,
        `${name}.equity`,
        comparisonWindow,
        metrics.pnl,
      ),
      compositionFingerprint: compositionFingerprint(resolvedComposition),
    };
  });
  const baseline = candidates.find(({ id }) => id === baselineId);
  if (!baseline || baseline.role !== 'baseline') {
    fail('baselineId must identify production core + current AI-gate');
  }
  if (candidates.filter(({ role }) => role === 'baseline').length !== 1) {
    fail('the board must contain exactly one gated baseline');
  }
  const selected = candidates.find(({ id }) => id === selectedId);
  if (!selected) {
    fail('selectedId must identify a final composition');
  }
  const terminalComparisonInput =
    input.terminalComparisonIds === undefined
      ? selected.role === 'candidate'
        ? [selectedId]
        : candidates
            .filter(({ role }) => role === 'candidate')
            .slice(0, 1)
            .map(({ id }) => id)
      : input.terminalComparisonIds;
  if (
    !Array.isArray(terminalComparisonInput) ||
    terminalComparisonInput.length < 1 ||
    terminalComparisonInput.length > 3
  ) {
    fail(
      'terminalComparisonIds must contain between one and three candidate ids',
    );
  }
  const terminalComparisonIds = terminalComparisonInput.map((value, index) =>
    textValue(value, `terminalComparisonIds[${index}]`),
  );
  if (new Set(terminalComparisonIds).size !== terminalComparisonIds.length) {
    fail('terminalComparisonIds must not contain duplicates');
  }
  if (
    selected.role === 'candidate' &&
    !terminalComparisonIds.includes(selectedId)
  ) {
    fail('terminalComparisonIds must include selectedId');
  }
  for (const id of terminalComparisonIds) {
    const candidate = candidates.find((entry) => entry.id === id);
    if (!candidate || candidate.role !== 'candidate') {
      fail(`terminalComparisonIds must identify candidates: ${id}`);
    }
  }
  const limitations = Array.isArray(input.limitations)
    ? input.limitations.map((value, index) =>
        textValue(value, `limitations[${index}]`),
      )
    : fail('limitations must be an array');
  return {
    schema: SCHEMA,
    strategy,
    researchId,
    title,
    subtitle,
    baselineId,
    selectedId,
    terminalComparisonIds,
    comparisonWindow,
    normalization,
    limitations,
    candidates,
  };
};

const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const formatNumber = (value, digits = 2) =>
  value == null ? 'n/a' : Number(value).toFixed(digits);

const formatCompact = (value) => {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
};

const pctDelta = (value, baseline, lowerIsBetter = false) => {
  if (baseline === 0) return 'n/a';
  const raw = ((value - baseline) / Math.abs(baseline)) * 100;
  const signed = `${raw >= 0 ? '+' : ''}${raw.toFixed(1)}%`;
  return lowerIsBetter ? `${signed} vs baseline` : signed;
};

const niceBounds = (values, includeZero = true) => {
  const source = includeZero ? [...values, 0] : values;
  let min = Math.min(...source);
  let max = Math.max(...source);
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.1);
    min -= padding;
    max += padding;
  }
  const padding = (max - min) * 0.1;
  return [min - padding, max + padding];
};

const svgTextLines = ({
  lines,
  x,
  y,
  lineHeight,
  className,
  anchor = 'start',
}) =>
  lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" text-anchor="${anchor}" class="${className}">${escapeXml(line)}</text>`,
    )
    .join('');

const truncate = (value, limit) =>
  value.length <= limit ? value : `${value.slice(0, Math.max(1, limit - 1))}…`;

const dashboardSvg = (board) => {
  const width = 1800;
  const height = 1200;
  const baseline = board.candidates.find(({ id }) => id === board.baselineId);
  const selected = board.candidates.find(({ id }) => id === board.selectedId);
  const terminalCandidates = board.terminalComparisonIds.map((id) =>
    board.candidates.find((candidate) => candidate.id === id),
  );
  const terminalSeries = [baseline, ...terminalCandidates];
  const selectedColor = selected.color;
  const cards = [
    {
      label: 'Trades',
      value: String(selected.metrics.trades),
      detail: `baseline ${baseline.metrics.trades} · ${selected.metrics.trades - baseline.metrics.trades >= 0 ? '+' : ''}${selected.metrics.trades - baseline.metrics.trades}`,
    },
    {
      label: 'PnL',
      value: formatNumber(selected.metrics.pnl),
      detail: pctDelta(selected.metrics.pnl, baseline.metrics.pnl),
    },
    {
      label: 'Profit factor',
      value: formatNumber(selected.metrics.profitFactor, 3),
      detail: `baseline ${formatNumber(baseline.metrics.profitFactor, 3)}`,
    },
    {
      label: 'Max drawdown',
      value: formatNumber(selected.metrics.maxDrawdown),
      detail: pctDelta(
        selected.metrics.maxDrawdown,
        baseline.metrics.maxDrawdown,
        true,
      ),
    },
  ];
  const cardWidth = 385;
  const cardGap = 22;
  const cardsMarkup = cards
    .map(({ label, value, detail }, index) => {
      const x = 72 + index * (cardWidth + cardGap);
      return `<g><rect x="${x}" y="150" width="${cardWidth}" height="140" rx="16" class="panel"/><text x="${x + 28}" y="190" class="cardLabel">${escapeXml(label)}</text><text x="${x + 28}" y="248" class="cardValue" fill="${index === 1 ? selectedColor : '#17211d'}">${escapeXml(value)}</text><text x="${x + cardWidth - 28}" y="247" text-anchor="end" class="cardDetail">${escapeXml(detail)}</text></g>`;
    })
    .join('');

  const bar = { x: 100, y: 445, width: 980, height: 425 };
  const terminalLegendWidth = bar.width / terminalSeries.length;
  const terminalLegend = terminalSeries
    .map((candidate, index) => {
      const x = bar.x + index * terminalLegendWidth;
      return `<g data-terminal-legend="${escapeXml(candidate.id)}"><rect x="${x}" y="402" width="16" height="16" rx="3" fill="${candidate.color}"/><text x="${x + 24}" y="416" class="axis">${escapeXml(truncate(candidate.label, 40))}</text></g>`;
    })
    .join('');
  const pnlValues = terminalSeries.flatMap(({ terminal }) =>
    terminal.map(({ pnl }) => pnl),
  );
  const [barMin, barMax] = niceBounds(pnlValues);
  const barY = (value) =>
    bar.y + ((barMax - value) / (barMax - barMin)) * bar.height;
  const zeroY = barY(0);
  const barGrid = Array.from({ length: 5 }, (_, index) => {
    const value = barMin + ((barMax - barMin) * index) / 4;
    const y = barY(value);
    return `<line x1="${bar.x}" x2="${bar.x + bar.width}" y1="${y}" y2="${y}" class="grid"/><text x="${bar.x - 16}" y="${y + 5}" text-anchor="end" class="axis">${escapeXml(formatCompact(value))}</text>`;
  }).join('');
  const groupWidth = bar.width / REQUIRED_WINDOWS.length;
  const barGap = 5;
  const singleBarWidth = Math.min(
    38,
    Math.max(
      18,
      (groupWidth - 20 - barGap * (terminalSeries.length - 1)) /
        terminalSeries.length,
    ),
  );
  const bars = REQUIRED_WINDOWS.map((days, index) => {
    const center = bar.x + groupWidth * (index + 0.5);
    const totalBarsWidth =
      singleBarWidth * terminalSeries.length +
      barGap * (terminalSeries.length - 1);
    const firstBarX = center - totalBarsWidth / 2;
    const renderBar = (candidate, value, x) => {
      const y = barY(value);
      const top = Math.min(y, zeroY);
      const h = Math.max(1, Math.abs(zeroY - y));
      return `<rect data-terminal-series="${escapeXml(candidate.id)}" x="${x}" y="${top}" width="${singleBarWidth}" height="${h}" rx="4" fill="${candidate.color}"/><text x="${x + singleBarWidth / 2}" y="${value >= 0 ? top - 10 : top + h + 20}" text-anchor="middle" class="barValue">${escapeXml(formatCompact(value))}</text>`;
    };
    const windowBars = terminalSeries
      .map((candidate, seriesIndex) =>
        renderBar(
          candidate,
          candidate.terminal[index].pnl,
          firstBarX + seriesIndex * (singleBarWidth + barGap),
        ),
      )
      .join('');
    const tradeCounts = terminalSeries
      .map((candidate) => candidate.terminal[index].trades)
      .join(' / ');
    return `${windowBars}<text x="${center}" y="${bar.y + bar.height + 38}" text-anchor="middle" class="windowLabel">${days}d</text><text x="${center}" y="${bar.y + bar.height + 64}" text-anchor="middle" class="windowCount">N ${escapeXml(tradeCounts)}</text>`;
  }).join('');

  const scatter = { x: 1180, y: 400, width: 500, height: 470 };
  const [ddMin, ddMax] = niceBounds(
    board.candidates.map(({ metrics }) => metrics.maxDrawdown),
    false,
  );
  const [pnlMin, pnlMax] = niceBounds(
    board.candidates.map(({ metrics }) => metrics.pnl),
  );
  const sx = (value) =>
    scatter.x + ((value - ddMin) / (ddMax - ddMin)) * scatter.width;
  const sy = (value) =>
    scatter.y + ((pnlMax - value) / (pnlMax - pnlMin)) * scatter.height;
  const scatterGrid = Array.from({ length: 5 }, (_, index) => {
    const pnl = pnlMin + ((pnlMax - pnlMin) * index) / 4;
    const dd = ddMin + ((ddMax - ddMin) * index) / 4;
    const y = sy(pnl);
    const x = sx(dd);
    return `<line x1="${scatter.x}" x2="${scatter.x + scatter.width}" y1="${y}" y2="${y}" class="grid"/><text x="${scatter.x - 12}" y="${y + 5}" text-anchor="end" class="axis">${escapeXml(formatCompact(pnl))}</text><line x1="${x}" x2="${x}" y1="${scatter.y}" y2="${scatter.y + scatter.height}" class="grid faint"/><text x="${x}" y="${scatter.y + scatter.height + 28}" text-anchor="middle" class="axis">${escapeXml(formatCompact(dd))}</text>`;
  }).join('');
  const points = board.candidates
    .map((candidate, index) => {
      const x = sx(candidate.metrics.maxDrawdown);
      const y = sy(candidate.metrics.pnl);
      const selectedPoint = candidate.id === selected.id;
      const labelY = y + ((index % 3) - 1) * 24;
      const labelOnLeft = x > scatter.x + scatter.width * 0.66;
      const labelX = x + (labelOnLeft ? -14 : 14);
      const anchor = labelOnLeft ? 'end' : 'start';
      return `${selectedPoint ? `<circle cx="${x}" cy="${y}" r="24" fill="${candidate.color}" opacity="0.18"/>` : ''}<circle cx="${x}" cy="${y}" r="${selectedPoint ? 12 : 9}" fill="${candidate.color}" stroke="${selectedPoint ? '#7a321b' : '#ffffff'}" stroke-width="${selectedPoint ? 3 : 2}"/><text x="${labelX}" y="${labelY}" text-anchor="${anchor}" class="pointLabel" fill="${selectedPoint ? candidate.color : '#24302a'}">${escapeXml(truncate(candidate.label, 25))}</text>`;
    })
    .join('');

  const limitations = board.limitations.length
    ? `Limitations: ${board.limitations.join(' · ')}`
    : 'Limitations: none recorded';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(board.strategy)} final composition dashboard"><style>.bg{fill:#f5f4ef}.panel{fill:#fff;stroke:#ddd9d0;stroke-width:2}.title{font:500 42px Arial,sans-serif;fill:#17211d}.subtitle{font:22px Arial,sans-serif;fill:#38433e}.cardLabel{font:21px Arial,sans-serif;fill:#303a35}.cardValue{font:500 44px Arial,sans-serif}.cardDetail{font:18px Arial,sans-serif;fill:#303a35}.section{font:500 27px Arial,sans-serif;fill:#17211d}.muted{font:18px Arial,sans-serif;fill:#45514a}.axis{font:15px Arial,sans-serif;fill:#58645e}.grid{stroke:#d9ddd9;stroke-width:1.5}.faint{opacity:.5}.barValue{font:16px Arial,sans-serif;fill:#24302a}.windowLabel{font:20px Arial,sans-serif;fill:#24302a}.windowCount{font:15px Arial,sans-serif;fill:#45514a}.pointLabel{font:16px Arial,sans-serif}.footer{font:18px Arial,sans-serif;fill:#6b4b1f}</style><rect width="100%" height="100%" class="bg"/><text x="72" y="70" class="title">${escapeXml(board.strategy)} · ${escapeXml(selected.label)}</text><text x="72" y="108" class="subtitle">${escapeXml(board.subtitle)}</text>${cardsMarkup}<rect x="72" y="330" width="1040" height="650" rx="20" class="panel"/><text x="100" y="380" class="section">PnL in terminal windows</text>${terminalLegend}<rect x="1145" y="330" width="585" height="650" rx="20" class="panel"/><text x="1180" y="380" class="section">Final compositions: PnL ↔ drawdown</text><text x="1180" y="412" class="muted">Higher and farther left is preferable</text><g>${barGrid}<line x1="${bar.x}" x2="${bar.x + bar.width}" y1="${zeroY}" y2="${zeroY}" stroke="#8f9994" stroke-width="1.5"/>${bars}</g><g>${scatterGrid}${points}<text x="${scatter.x + scatter.width / 2}" y="${scatter.y + scatter.height + 65}" text-anchor="middle" class="muted">Realized MaxDD</text></g><g><rect x="72" y="1020" width="1658" height="112" rx="16" fill="#fff5dd" stroke="#efd79c" stroke-width="2"/>${svgTextLines({ lines: [truncate(limitations, 155), `Risk normalization: MAX_LOSS_VALUE=${board.normalization.maxLossValue} · ${board.normalization.pnlUnit} · ${board.researchId}`], x: 98, y: 1062, lineHeight: 30, className: 'footer' })}</g></svg>`;
};

const downsample = (points, maxPoints = 1200) => {
  if (points.length <= maxPoints) return points;
  const selected = [points[0]];
  const buckets = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const bucketSize = (points.length - 2) / buckets;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = 1 + Math.floor(bucket * bucketSize);
    const end = Math.min(
      points.length - 1,
      1 + Math.floor((bucket + 1) * bucketSize),
    );
    const slice = points.slice(start, Math.max(start + 1, end));
    const min = slice.reduce((best, point) =>
      point[1] < best[1] ? point : best,
    );
    const max = slice.reduce((best, point) =>
      point[1] > best[1] ? point : best,
    );
    for (const point of [min, max].sort((left, right) => left[0] - right[0])) {
      if (selected.at(-1) !== point) selected.push(point);
    }
  }
  selected.push(points.at(-1));
  return selected;
};

const equitySvg = (board) => {
  const width = 1800;
  const height = 1200;
  const left = 110;
  const right = 70;
  const top = 150;
  const bottom = 300;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const minTime = board.comparisonWindow.start;
  const maxTime = board.comparisonWindow.end - 1;
  const values = board.candidates.flatMap(({ equity }) =>
    equity.map(([, pnl]) => pnl),
  );
  const [minPnl, maxPnl] = niceBounds(values);
  const x = (timestamp) =>
    left + ((timestamp - minTime) / (maxTime - minTime)) * plotWidth;
  const y = (pnl) => top + ((maxPnl - pnl) / (maxPnl - minPnl)) * plotHeight;
  const yGrid = Array.from({ length: 7 }, (_, index) => {
    const value = minPnl + ((maxPnl - minPnl) * index) / 6;
    const position = y(value);
    return `<line x1="${left}" x2="${width - right}" y1="${position}" y2="${position}" class="grid"/><text x="${left - 18}" y="${position + 5}" text-anchor="end" class="axis">${escapeXml(formatCompact(value))}</text>`;
  }).join('');
  const years = [];
  const startYear = new Date(minTime).getUTCFullYear();
  const endYear = new Date(maxTime).getUTCFullYear();
  for (let year = startYear; year <= endYear; year += 1) {
    const timestamp = Date.UTC(year, 0, 1);
    if (timestamp >= minTime && timestamp <= maxTime)
      years.push({ year, timestamp });
  }
  const xGrid = years
    .map(({ year, timestamp }) => {
      const position = x(timestamp);
      return `<line x1="${position}" x2="${position}" y1="${top}" y2="${height - bottom}" class="grid faint"/><text x="${position}" y="${height - bottom + 34}" text-anchor="middle" class="axis">${year}</text>`;
    })
    .join('');
  const curves = board.candidates
    .map((candidate) => {
      const points = downsample(candidate.equity)
        .map(
          ([timestamp, pnl]) =>
            `${x(timestamp).toFixed(1)},${y(pnl).toFixed(1)}`,
        )
        .join(' ');
      const selected = candidate.id === board.selectedId;
      return `<polyline points="${points}" fill="none" stroke="${candidate.color}" stroke-width="${selected ? 4.5 : 3}" opacity="${selected ? 1 : 0.82}" stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join('');
  const columns = 3;
  const legendWidth = (width - left - right) / columns;
  const legend = board.candidates
    .map((candidate, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const lx = left + column * legendWidth;
      const ly = height - bottom + 85 + row * 58;
      return `<g transform="translate(${lx},${ly})"><rect width="18" height="18" rx="3" fill="${candidate.color}"/><text x="28" y="15" class="legendLabel">${escapeXml(truncate(candidate.label, 35))}</text><text x="28" y="37" class="legendMetric">N=${candidate.metrics.trades} · PnL=${formatNumber(candidate.metrics.pnl, 1)} · DD=${formatNumber(candidate.metrics.maxDrawdown, 1)}</text></g>`;
    })
    .join('');
  const selected = board.candidates.find(({ id }) => id === board.selectedId);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(board.strategy)} final composition equity"><style>.bg{fill:#fff}.title{font:700 36px Arial,sans-serif;fill:#172033}.subtitle{font:18px Arial,sans-serif;fill:#687184}.axis{font:15px Arial,sans-serif;fill:#687184}.grid{stroke:#e2e6eb;stroke-width:1.5}.faint{opacity:.55}.legendLabel{font:600 17px Arial,sans-serif;fill:#263044}.legendMetric{font:15px Arial,sans-serif;fill:#687184}.axisTitle{font:17px Arial,sans-serif;fill:#394459}</style><rect width="100%" height="100%" class="bg"/><text x="${left}" y="58" class="title">${escapeXml(board.title)}</text><text x="${left}" y="92" class="subtitle">Baseline = production core + current AI-gate · candidates = core + own deterministic gate</text><text x="${left}" y="120" class="subtitle">Selected: ${escapeXml(selected.label)} · ${escapeXml(board.subtitle)}</text>${yGrid}${xGrid}<line x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}" stroke="#aab2bd" stroke-width="1.5"/>${curves}<line x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}" stroke="#7d8795" stroke-width="1.5"/><line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" stroke="#7d8795" stroke-width="1.5"/><text x="30" y="${top + plotHeight / 2}" transform="rotate(-90 30 ${top + plotHeight / 2})" text-anchor="middle" class="axisTitle">Cumulative PnL (${escapeXml(board.normalization.pnlUnit)})</text>${legend}</svg>`;
};

const verifyCandidateArtifacts = async (board, artifactRoot) => {
  const verified = [];
  for (const candidate of board.candidates) {
    const artifacts = {};
    const artifactKeys = [
      'coreResult',
      'coreExport',
      'gateReport',
      ...(candidate.composition.gateSource === 'current'
        ? ['gateAuthority']
        : []),
    ];
    for (const key of artifactKeys) {
      const resolved = resolveArtifact(
        artifactRoot,
        candidate.composition[key],
        `${candidate.id}.${key}`,
      );
      const actualSha256 = await sha256File(resolved.absolutePath);
      if (actualSha256 !== resolved.expectedSha256) {
        fail(`${candidate.id}.${key} SHA-256 mismatch`);
      }
      artifacts[key] = {
        path: resolved.declaredPath,
        sha256: actualSha256,
      };
    }
    verified.push({
      ...candidate,
      composition: { ...candidate.composition, ...artifacts },
    });
  }
  return { ...board, candidates: verified };
};

const renderPng = async (svg, outputPath) => {
  const { default: sharp } = await import('sharp');
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
};

export const generateFinalCompositionBoard = async ({
  spec,
  artifactRoot,
  outDir,
  png = true,
}) => {
  const validated = validateBoardSpec(spec);
  const board = await verifyCandidateArtifacts(validated, artifactRoot);
  const absoluteOutDir = path.resolve(outDir);
  await mkdir(absoluteOutDir, { recursive: true });
  const dashboard = dashboardSvg(board);
  const equity = equitySvg(board);
  const dashboardSvgPath = path.join(
    absoluteOutDir,
    'final-composition-dashboard.svg',
  );
  const equitySvgPath = path.join(
    absoluteOutDir,
    'final-composition-equity.svg',
  );
  await writeFile(dashboardSvgPath, `${dashboard}\n`, 'utf8');
  await writeFile(equitySvgPath, `${equity}\n`, 'utf8');
  const rendered = [dashboardSvgPath, equitySvgPath];
  if (png) {
    const dashboardPngPath = path.join(
      absoluteOutDir,
      'final-composition-dashboard.png',
    );
    const equityPngPath = path.join(
      absoluteOutDir,
      'final-composition-equity.png',
    );
    await renderPng(dashboard, dashboardPngPath);
    await renderPng(equity, equityPngPath);
    rendered.push(dashboardPngPath, equityPngPath);
  }
  const artifactHashes = Object.fromEntries(
    await Promise.all(
      rendered.map(async (filePath) => [
        path.basename(filePath),
        await sha256File(filePath),
      ]),
    ),
  );
  const summary = {
    schema: 'tradejs-final-composition-summary/v1',
    strategy: board.strategy,
    researchId: board.researchId,
    baselineId: board.baselineId,
    selectedId: board.selectedId,
    terminalComparisonIds: board.terminalComparisonIds,
    comparisonWindow: board.comparisonWindow,
    normalization: board.normalization,
    limitations: board.limitations,
    candidates: board.candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      role: candidate.role,
      status: candidate.status,
      compositionFingerprint: candidate.compositionFingerprint,
      composition: candidate.composition,
      metrics: candidate.metrics,
      terminal: candidate.terminal,
    })),
    artifacts: artifactHashes,
  };
  const summaryPath = path.join(
    absoluteOutDir,
    'final-composition-summary.json',
  );
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return { summary, summaryPath };
};

const parseArgs = (argv) => {
  const options = { spec: '', outDir: '', artifactRoot: '', png: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inline] = arg.split('=', 2);
    const take = () => {
      if (inline !== undefined) return inline;
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) fail(`${name} requires a value`);
      index += 1;
      return value;
    };
    if (name === '--spec') options.spec = take();
    else if (name === '--outDir') options.outDir = take();
    else if (name === '--artifactRoot') options.artifactRoot = take();
    else if (name === '--noPng') options.png = false;
    else fail(`unknown option: ${arg}`);
  }
  if (!options.spec || !options.outDir) {
    fail(
      'Usage: final-composition-board.mjs --spec <spec.json> --outDir <dir> [--artifactRoot <project>] [--noPng]',
    );
  }
  options.artifactRoot =
    options.artifactRoot || process.env.PROJECT_CWD || process.cwd();
  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const spec = JSON.parse(await readFile(path.resolve(options.spec), 'utf8'));
  const result = await generateFinalCompositionBoard({
    spec,
    artifactRoot: options.artifactRoot,
    outDir: options.outDir,
    png: options.png,
  });
  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
