#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadExecutedCompositionReport,
  readExecutedDescriptor,
  readExecutedEquity,
  resolveExecutedSelection,
  validateExecutedCompositionReport,
} from './executed-composition-report.mjs';
import {
  boundPath,
  canonicalJson,
} from '../../ai-train-local-research/scripts/decision-capture-join.mjs';

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
      ...(composition.compiledGateAuthority
        ? {
            compiledGateAuthoritySha256:
              composition.compiledGateAuthority.sha256,
          }
        : {}),
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
  if (input.executionBasis === 'closed-loop-execution')
    return validateExecutedBoard(input);
  if (
    input.executionBasis !== undefined &&
    input.executionBasis !== 'posthoc-subset'
  )
    fail('Unknown executionBasis');
  const strategy = textValue(input.strategy, 'strategy');
  const researchId = textValue(input.researchId, 'researchId');
  const title = textValue(input.title, 'title');
  const subtitle = textValue(input.subtitle, 'subtitle');
  const baselineId = textValue(input.baselineId, 'baselineId');
  const selectedId =
    input.selectedId === null
      ? null
      : textValue(input.selectedId, 'selectedId');
  if (
    input.metricBasis !== undefined &&
    !['decision-time', 'completed-trade'].includes(input.metricBasis)
  ) {
    fail('metricBasis must be decision-time or completed-trade');
  }
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
    if (
      gateSource === 'current' &&
      composition.compiledGateAuthority !== undefined
    ) {
      fail(
        `${name}.composition.compiledGateAuthority is reserved for candidate gates`,
      );
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
      ...(composition.compiledGateAuthority === undefined
        ? {}
        : { compiledGateAuthority: composition.compiledGateAuthority }),
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
  if (selectedId !== null && !selected) {
    fail('selectedId must identify a final composition');
  }
  const terminalComparisonInput =
    input.terminalComparisonIds === undefined
      ? selected?.role === 'candidate'
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
    selected?.role === 'candidate' &&
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
    ...(input.metricBasis === undefined
      ? {}
      : { metricBasis: input.metricBasis }),
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
  const selected =
    board.candidates.find(({ id }) => id === board.selectedId) ?? baseline;
  const noEligible = board.selectedId === null;
  const terminalCandidates = board.terminalComparisonIds.map((id) =>
    board.candidates.find((candidate) => candidate.id === id),
  );
  const terminalSeries = [baseline, ...terminalCandidates];
  const selectedColor = selected.color;
  const cards = [
    {
      label: 'Trades',
      value: String(selected.metrics.trades),
      detail: noEligible
        ? 'Baseline diagnostics'
        : `baseline ${baseline.metrics.trades} · ${selected.metrics.trades - baseline.metrics.trades >= 0 ? '+' : ''}${selected.metrics.trades - baseline.metrics.trades}`,
    },
    {
      label: 'PnL',
      value: formatNumber(selected.metrics.pnl),
      detail: noEligible
        ? 'Baseline diagnostics'
        : pctDelta(selected.metrics.pnl, baseline.metrics.pnl),
    },
    {
      label: 'Profit factor',
      value: formatNumber(selected.metrics.profitFactor, 3),
      detail: noEligible
        ? 'Baseline diagnostics'
        : `baseline ${formatNumber(baseline.metrics.profitFactor, 3)}`,
    },
    {
      label: 'Max drawdown',
      value: formatNumber(selected.metrics.maxDrawdown),
      detail: noEligible
        ? 'Baseline diagnostics'
        : pctDelta(
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
      return `<g data-terminal-legend="${escapeXml(candidate.id)}"><rect x="${x}" y="402" width="16" height="16" rx="3" fill="${candidate.color}"/><text x="${x + 24}" y="416" class="axis">${escapeXml(truncate(candidate.label, Math.floor((terminalLegendWidth - 35) / 9)))}</text></g>`;
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
  const pointGroups = new Map();
  const points = board.candidates
    .map((candidate, index) => {
      const x = sx(candidate.metrics.maxDrawdown);
      const y = sy(candidate.metrics.pnl);
      const selectedPoint = candidate.id === board.selectedId;
      const key = stableStringify([
        candidate.metrics.maxDrawdown,
        candidate.metrics.pnl,
      ]);
      const group = pointGroups.get(key) ?? [];
      group.push({ candidate, index, x, y });
      pointGroups.set(key, group);
      return `${selectedPoint ? `<circle cx="${x}" cy="${y}" r="24" fill="${candidate.color}" opacity="0.18"/>` : ''}<circle data-scatter-point="${escapeXml(candidate.id)}" cx="${x}" cy="${y}" r="${selectedPoint ? 12 : 9}" fill="${candidate.color}" stroke="${selectedPoint ? '#7a321b' : '#ffffff'}" stroke-width="${selectedPoint ? 3 : 2}"/>`;
    })
    .join('');
  const pointLabels = [...pointGroups.values()]
    .map((group) => {
      const { candidate, x, y } =
        group.find((point) => point.candidate.id === board.selectedId) ??
        group[0];
      const labelOnLeft = x > scatter.x + scatter.width * 0.66;
      const label = group
        .map(({ index }) =>
          index === 0 ? '0' : String.fromCharCode(64 + index),
        )
        .join(' / ');
      return `<text data-point-label-ids="${escapeXml(group.map(({ candidate }) => candidate.id).join(','))}" x="${x + (labelOnLeft ? -14 : 14)}" y="${y + 5}" text-anchor="${labelOnLeft ? 'end' : 'start'}" class="pointLabel" fill="${candidate.id === board.selectedId ? candidate.color : '#24302a'}">${label}</text>`;
    })
    .join('');

  const limitations = board.limitations.length
    ? `Limitations: ${board.limitations.join(' · ')}`
    : 'Limitations: none recorded';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(board.strategy)} final composition dashboard"><style>.bg{fill:#f5f4ef}.panel{fill:#fff;stroke:#ddd9d0;stroke-width:2}.title{font:500 42px Arial,sans-serif;fill:#17211d}.subtitle{font:22px Arial,sans-serif;fill:#38433e}.cardLabel{font:21px Arial,sans-serif;fill:#303a35}.cardValue{font:500 44px Arial,sans-serif}.cardDetail{font:18px Arial,sans-serif;fill:#303a35}.section{font:500 27px Arial,sans-serif;fill:#17211d}.muted{font:18px Arial,sans-serif;fill:#45514a}.axis{font:15px Arial,sans-serif;fill:#58645e}.grid{stroke:#d9ddd9;stroke-width:1.5}.faint{opacity:.5}.barValue{font:16px Arial,sans-serif;fill:#24302a}.windowLabel{font:20px Arial,sans-serif;fill:#24302a}.windowCount{font:15px Arial,sans-serif;fill:#45514a}.pointLabel{font:16px Arial,sans-serif}.footer{font:18px Arial,sans-serif;fill:#6b4b1f}</style><rect width="100%" height="100%" class="bg"/><text x="72" y="70" class="title">${escapeXml(board.strategy)} · ${escapeXml(noEligible ? 'No eligible composition' : selected.label)}</text><text x="72" y="108" class="subtitle">${escapeXml(board.subtitle)}</text>${cardsMarkup}<rect x="72" y="330" width="1040" height="650" rx="20" class="panel"/><text x="100" y="380" class="section">PnL in terminal windows</text>${terminalLegend}<rect x="1145" y="330" width="585" height="650" rx="20" class="panel"/><text x="1180" y="380" class="section">Final compositions: PnL ↔ drawdown</text><text x="1180" y="412" class="muted">Higher and farther left is preferable</text><g>${barGrid}<line x1="${bar.x}" x2="${bar.x + bar.width}" y1="${zeroY}" y2="${zeroY}" stroke="#8f9994" stroke-width="1.5"/>${bars}</g><g>${scatterGrid}${points}${pointLabels}<text x="${scatter.x + scatter.width / 2}" y="${scatter.y + scatter.height + 65}" text-anchor="middle" class="muted">MaxDD (trade stream)</text></g><g><rect x="72" y="1020" width="1658" height="112" rx="16" fill="#fff5dd" stroke="#efd79c" stroke-width="2"/>${svgTextLines({ lines: [truncate(limitations, 155), `Risk normalization: MAX_LOSS_VALUE=${board.normalization.maxLossValue} · ${board.normalization.pnlUnit} · ${board.researchId}`], x: 98, y: 1062, lineHeight: 30, className: 'footer' })}</g></svg>`;
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
  const left = 110;
  const right = 70;
  const top = 150;
  const columns = 3;
  const legendRows = Math.ceil(board.candidates.length / columns);
  const legendTop = 110;
  const legendRowHeight = 58;
  const bottom = Math.max(300, legendTop + legendRows * legendRowHeight + 32);
  const plotHeight = 750;
  const height = top + plotHeight + bottom;
  const plotWidth = width - left - right;
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
  const spanDays = (maxTime - minTime) / 86_400_000;
  const xTicks = Array.from({ length: 6 }, (_, index) => {
    const timestamp = Math.round(minTime + ((maxTime - minTime) * index) / 5);
    const date = new Date(timestamp);
    const label =
      spanDays >= 730
        ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
        : spanDays >= 90
          ? date.toLocaleDateString('en-CA', {
              timeZone: 'UTC',
              year: 'numeric',
              month: 'short',
            })
          : date.toLocaleDateString('en-CA', {
              timeZone: 'UTC',
              month: 'short',
              day: '2-digit',
            });
    return { label, timestamp };
  });
  const xGrid = xTicks
    .map(({ label, timestamp }) => {
      const position = x(timestamp);
      return `<line x1="${position}" x2="${position}" y1="${top}" y2="${height - bottom}" class="grid faint"/><text x="${position}" y="${height - bottom + 34}" text-anchor="middle" class="axis">${escapeXml(label)}</text>`;
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
  const legendWidth = (width - left - right) / columns;
  const legend = board.candidates
    .map((candidate, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const lx = left + column * legendWidth;
      const ly = height - bottom + legendTop + row * legendRowHeight;
      return `<g data-equity-legend="${escapeXml(candidate.id)}" transform="translate(${lx},${ly})"><rect width="18" height="18" rx="3" fill="${candidate.color}"/><text x="28" y="15" class="legendLabel">${index === 0 ? '0' : String.fromCharCode(64 + index)} · ${escapeXml(truncate(candidate.label, 35))}</text><text x="28" y="37" class="legendMetric">N=${candidate.metrics.trades} · PnL=${formatNumber(candidate.metrics.pnl, 1)} · DD=${formatNumber(candidate.metrics.maxDrawdown, 1)}</text></g>`;
    })
    .join('');
  const selected = board.candidates.find(({ id }) => id === board.selectedId);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(board.strategy)} final composition equity"><style>.bg{fill:#fff}.title{font:700 36px Arial,sans-serif;fill:#172033}.subtitle{font:18px Arial,sans-serif;fill:#687184}.axis{font:15px Arial,sans-serif;fill:#687184}.grid{stroke:#e2e6eb;stroke-width:1.5}.faint{opacity:.55}.legendLabel{font:600 17px Arial,sans-serif;fill:#263044}.legendMetric{font:15px Arial,sans-serif;fill:#687184}.axisTitle{font:17px Arial,sans-serif;fill:#394459}</style><rect width="100%" height="100%" class="bg"/><text x="${left}" y="58" class="title">${escapeXml(board.title)}</text><text x="${left}" y="92" class="subtitle">Baseline = current gate behavior; candidates = core + own deterministic gate</text><text x="${left}" y="120" class="subtitle">${board.selectedId === null ? 'No eligible composition' : `Selected: ${escapeXml(selected.label)}`} · ${escapeXml(board.subtitle)}</text>${yGrid}${xGrid}<line x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}" stroke="#aab2bd" stroke-width="1.5"/>${curves}<line x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}" stroke="#7d8795" stroke-width="1.5"/><line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" stroke="#7d8795" stroke-width="1.5"/><text x="${left + plotWidth / 2}" y="${height - bottom + 67}" text-anchor="middle" class="axisTitle">Date (UTC)</text><text x="30" y="${top + plotHeight / 2}" transform="rotate(-90 30 ${top + plotHeight / 2})" text-anchor="middle" class="axisTitle">Cumulative PnL (${escapeXml(board.normalization.pnlUnit)})</text>${legend}</svg>`;
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
      ...(candidate.composition.compiledGateAuthority
        ? ['compiledGateAuthority']
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
  if (spec?.executionBasis === 'closed-loop-execution')
    return generateExecutedBoard({ spec, artifactRoot, outDir, png });
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
    ...(board.metricBasis === undefined
      ? {}
      : { metricBasis: board.metricBasis }),
    rendering: {
      equityInterpolation: 'linear',
      meaning:
        'Lines connect event samples; not an intratrade or mark-to-market path.',
      metricInputsChanged: false,
    },
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

const validateExecutedBoard = (input) => {
  if (
    input.metricBasis !== 'completed-trade' ||
    input.normalization?.maxLossValue !== 10
  )
    fail('Executed board requires completed trades and risk10');
  if (
    !Array.isArray(input.candidates) ||
    input.candidates.length < 2 ||
    input.candidates.length > 100
  )
    fail('Executed board requires bounded complete candidate universe');
  const ids = new Set();
  for (const c of input.candidates) {
    if (!c.id || ids.has(c.id)) fail('Duplicate/missing executed candidate');
    ids.add(c.id);
    if (
      c.riskUnit !== 10 ||
      c.composition?.kind !== 'core+deterministic-gate' ||
      c.composition.executionBasis !== 'closed-loop-execution'
    )
      fail('Raw/posthoc candidate cannot enter executed board');
    if (
      !['PASS', 'FAIL', 'UNKNOWN'].includes(c.selectionDecision?.status) ||
      c.status !== c.selectionDecision.status
    )
      fail('Executed decision status required');
    if (!/^#[0-9a-fA-F]{6}$/u.test(c.color))
      fail('Safe candidate color required');
    for (const key of [
      'executedCompositionAuthority',
      'executedCompositionReport',
      'executedCompositionReceipt',
    ])
      if (
        !c.composition[key]?.path ||
        !SHA256_RE.test(c.composition[key]?.sha256 ?? '')
      )
        fail('Executed authority/report/receipt descriptors required');
    validateExecutedCompositionReport({
      schema: 'tradejs-executed-composition-report/v1',
      executionBasis: input.executionBasis,
      metricBasis: input.metricBasis,
      matrices: c.matrices,
      selectionDecision: c.selectionDecision,
      equity: c.equity,
    });
    if (
      (c.role === 'baseline' && c.composition.gateSource !== 'current') ||
      (c.role === 'candidate' && c.composition.gateSource !== 'variant')
    )
      fail(
        'Current research baseline and own-gate candidates must remain distinct',
      );
  }
  if (
    input.candidates.filter((c) => c.role === 'baseline').length !== 1 ||
    input.candidates.find((c) => c.id === input.baselineId)?.role !== 'baseline'
  )
    fail('Exactly one current-gate research baseline required');
  if (
    !['selected', 'no-eligible-composition', 'authority-blocked'].includes(
      input.selectionDisposition,
    )
  )
    fail('Explicit executed selection disposition required');
  if (input.selectionDisposition === 'selected') {
    if (
      !ids.has(input.selectedId) ||
      input.candidates.find((c) => c.id === input.selectedId).status !==
        'PASS' ||
      input.finalSelectable !== true
    )
      fail('Selected id must be eligible PASS');
  } else if (
    input.selectedId !== null ||
    input.finalSelectable !==
      (input.selectionDisposition === 'no-eligible-composition')
  )
    fail('Null selected id and exact finalSelectable required');
  if (Buffer.byteLength(canonicalJson(input)) > 16777216)
    fail('Small executed board spec bound exceeded');
  return structuredClone(input);
};

// Fixed time buckets retain first/last/min/max actual observations; metrics
// never consume these bounded, rendering-only points.
export const reduceExecutedEquity = async ({
  projectRoot,
  equity,
  comparisonWindow,
  buckets = 300,
}) => {
  if (!Number.isInteger(buckets) || buckets < 1 || buckets > 1200)
    fail('Invalid rendering bucket bound');
  const stored = Array.from({ length: buckets }, () => null);
  let count = 0,
    previous = -Infinity,
    last = null;
  for await (const point of readExecutedEquity(projectRoot, equity)) {
    if (
      point[0] < comparisonWindow.start ||
      point[0] >= comparisonWindow.end ||
      point[0] <= previous
    )
      fail('Observed equity outside frozen calendar');
    previous = point[0];
    count++;
    last = point;
    const index = Math.min(
      buckets - 1,
      Math.floor(
        ((point[0] - comparisonWindow.start) /
          (comparisonWindow.end - comparisonWindow.start)) *
          buckets,
      ),
    );
    const bucket = stored[index];
    if (!bucket)
      stored[index] = { first: point, last: point, min: point, max: point };
    else {
      bucket.last = point;
      if (point[1] < bucket.min[1]) bucket.min = point;
      if (point[1] > bucket.max[1]) bucket.max = point;
    }
  }
  const points = [];
  for (const bucket of stored)
    if (bucket)
      for (const point of [
        bucket.first,
        bucket.min,
        bucket.max,
        bucket.last,
      ].sort((a, b) => a[0] - b[0]))
        if (points.at(-1)?.[0] !== point[0]) points.push(point);
  return {
    points,
    fullResolutionRows: count,
    finalPnl: last?.[1] ?? null,
    maxRetainedPoints: buckets * 4,
    reduction: 'fixed-time-bucket first/last/min/max; rendering only',
  };
};

const executedTitle = (board) =>
  board.selectionDisposition === 'authority-blocked'
    ? 'Evaluation blocked'
    : board.selectionDisposition === 'no-eligible-composition'
      ? 'No eligible composition'
      : `Selected by frozen criteria: ${board.selectedId}`;

const EXECUTED_PIXEL_LIMIT = 200_000_000;
const executedKey = (i) => `C${String(i).padStart(2, '0')}`;
const executedPageName = (c, i) =>
  `final-composition-matrix-${String(i + 1).padStart(3, '0')}-${c.id.replace(/[^a-zA-Z0-9_-]/gu, '-').slice(0, 100)}`;
const executedTicks = (min, max) =>
  [
    ...new Set([
      min,
      min + (max - min) / 4,
      (min + max) / 2,
      min + ((max - min) * 3) / 4,
      max,
      ...(min <= 0 && max >= 0 ? [0] : []),
    ]),
  ]
    .filter((v) => v === 0 || Math.abs(v / (max - min)) >= 0.06)
    .sort((a, b) => a - b);
const executedUtcTicks = ({ start, end }) => {
  const ticks = [start, end];
  const date = new Date(start);
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const months = [];
  while (date.getTime() < end) {
    months.push(date.getTime());
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  for (const [i, t] of months.entries())
    if (
      i % Math.max(1, Math.ceil(months.length / 5)) === 0 &&
      t - start > (end - start) * 0.08 &&
      end - t > (end - start) * 0.08
    )
      ticks.push(t);
  return ticks.sort((a, b) => a - b);
};
const executedWrapped = (value, width) => {
  // 9px is a conservative advance for the fixed 14px monospace labels.
  const limit = Math.max(1, Math.floor(width / 9));
  const parts = [];
  for (const original of String(value).split('\n')) {
    let line = original;
    while (line.length > limit) {
      const space = line.lastIndexOf(' ', limit);
      const cut = space > 0 ? space + 1 : limit;
      parts.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    parts.push(line);
  }
  return parts;
};
const executedCanvas = (name, width) => {
  const boxes = [],
    markup = [];
  let bottom = 0;
  const text = (value, x, top, boxWidth, lane, attributes = '') => {
    const lines = executedWrapped(value, boxWidth),
      height = lines.length * 20;
    const box = { name, lane, x, y: top, width: boxWidth, height };
    boxes.push(box);
    bottom = Math.max(bottom, top + height);
    markup.push(
      `<g data-label-box="${x},${top},${boxWidth},${height}" data-label-lane="${escapeXml(lane)}" ${attributes}>${lines.map((line, i) => `<text x="${x}" y="${top + 15 + i * 20}">${escapeXml(line)}</text>`).join('')}</g>`,
    );
    return height;
  };
  const raw = (s) => markup.push(s);
  const finish = (height, pixelLimit) => {
    if (!Number.isFinite(height) || width * height > pixelLimit)
      fail(`Executed ${name} pixel budget exceeded before write/rasterization`);
    for (const box of boxes)
      if (
        box.x < 0 ||
        box.y < 0 ||
        box.x + box.width > width ||
        box.y + box.height > height
      )
        fail(`Executed label outside ${name}`);
    return {
      width,
      height,
      boxes,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(name)}"><style>text{font:14px monospace;fill:#172033}.grid{stroke:#dae0e7;stroke-width:1}.zero{stroke:#69778b;stroke-width:2}</style><rect width="100%" height="100%" fill="#fff"/>${markup.join('')}</svg>`,
    };
  };
  return {
    text,
    raw,
    finish,
    get bottom() {
      return bottom;
    },
  };
};

// Pure presentation: only verified cells/criteria/curves are projected here.
// Every visible label has a conservative monospace box exposed for audit.
export const renderExecutedPresentation = ({
  board,
  curves,
  criteria = {},
  pixelLimit = EXECUTED_PIXEL_LIMIT,
}) => {
  if (
    !Number.isSafeInteger(pixelLimit) ||
    pixelLimit < 1 ||
    pixelLimit > EXECUTED_PIXEL_LIMIT
  )
    fail('Invalid executed pixel limit');
  const width = 2100,
    baseline = board.candidates.find((c) => c.id === board.baselineId);
  const dashboard = executedCanvas('compact executed dashboard', width);
  dashboard.text(executedTitle(board), 38, 25, 2020, 'heading');
  dashboard.text(
    'Closed-loop completed trades; diagnostic full/terminal/scatter views do not select a winner. Absolute deltas, never a ratio to zero baseline.',
    38,
    55,
    2020,
    'heading',
  );
  const headerHeight = dashboard.text(
    `Frozen observed TEST criteria: ${canonicalJson(criteria)}`,
    38,
    85,
    2020,
    'heading',
  );
  dashboard.text(
    'Complete observed/stress TEST booleans below; 99+99 cells and every metric on each candidate page and readable appendix.',
    38,
    95 + headerHeight,
    2020,
    'heading',
  );
  const tableTop = 130 + headerHeight;
  const columns = [38, 140, 270, 410, 600, 760, 960, 1160, 1350, 1550, 1810];
  const headings = [
    'Key',
    'Status',
    'N',
    'PnL',
    'PF',
    'MaxDD',
    'Cadence/day',
    'ΔPnL',
    'ΔMaxDD',
    'Observed criteria',
    '20bps criteria',
  ];
  headings.forEach((v, i) =>
    dashboard.text(
      v,
      columns[i],
      tableTop,
      (columns[i + 1] ?? 2070) - columns[i] - 15,
      `kpi-${i}`,
    ),
  );
  const pages = [],
    appendix = [];
  for (const [i, c] of board.candidates.entries()) {
    const top = tableTop + 50 + i * 170,
      delta = (k) =>
        Number.isFinite(c.metrics[k]) && Number.isFinite(baseline.metrics[k])
          ? formatNumber(c.metrics[k] - baseline.metrics[k])
          : '—';
    const decision = c.selectionDecision;
    const values = [
      executedKey(i),
      c.status,
      c.metrics.trades,
      formatNumber(c.metrics.pnl),
      formatNumber(c.metrics.profitFactor, 3),
      formatNumber(c.metrics.maxDrawdown),
      formatNumber(c.metrics.cadencePerDay, 4),
      delta('pnl'),
      delta('maxDrawdown'),
      canonicalJson(decision.observed ?? decision.criteria ?? decision.status),
      canonicalJson(decision.stress ?? decision.stress20bps ?? decision.status),
    ];
    // Compact complete statuses; full rule names/values remain in the key map.
    values[9] = decision.rules
      .filter((r) => !r.id.startsWith('stress-'))
      .map((r) => `${r.id.replace('test-', '')}:${r.status}`)
      .join('\n');
    values[10] = decision.rules
      .filter((r) => r.id.startsWith('stress-'))
      .map((r) => `${r.id.replace('stress-', '')}:${r.status}`)
      .join('\n');
    values.forEach((v, n) =>
      dashboard.text(
        v,
        columns[n],
        top,
        (columns[n + 1] ?? 2070) - columns[n] - 15,
        `kpi-${n}`,
        n === 0 ? `data-kpi-row="${escapeXml(c.id)}"` : '',
      ),
    );
    const name = executedPageName(c, i),
      page = executedCanvas(`matrix ${executedKey(i)}`, width);
    let y = 25;
    y +=
      page.text(
        `${executedKey(i)} · ${c.label} · ${c.id} · ${c.status}`,
        38,
        y,
        2020,
        'page-head',
      ) + 12;
    y +=
      page.text(
        `Selection: ${canonicalJson(decision)}; only OUTER_TEST_FROZEN / ALL_UNIVERSE / ALL is frozen criteria. Every other row diagnostic.`,
        38,
        y,
        2020,
        'page-head',
      ) + 12;
    const cellKeys = [],
      counts = {};
    for (const basis of ['observed', 'stress20bps']) {
      counts[basis] = 0;
      for (const axis of ['exitWindow', 'decisionPartition']) {
        y += page.text(`${basis} ${axis}`, 38, y, 2020, 'matrix') + 10;
        for (const cell of c.matrices[basis][axis]) {
          const identity = `${c.id}/${basis}/${axis}/${cell.id}/${cell.symbolGroupId}/${cell.direction}`;
          if (cellKeys.includes(identity))
            fail('Duplicate matrix page cell identity');
          cellKeys.push(identity);
          counts[basis]++;
          const criteria =
            cell.id === 'OUTER_TEST_FROZEN' &&
            cell.symbolGroupId === 'ALL_UNIVERSE' &&
            cell.direction === 'ALL';
          const label = `${criteria ? 'FROZEN CRITERIA' : 'diagnostic'} | ${cell.id} | ${cell.symbolGroupId} | ${cell.direction} | N ${cell.trades} | events ${cell.completedEvents} | PnL ${formatNumber(cell.pnl)} | PnL/trade ${formatNumber(cell.pnlPerTrade)} | PF ${formatNumber(cell.profitFactor, 3)} (${cell.profitFactorStatus}) | WR ${formatNumber(cell.winRate)} | MaxDD ${formatNumber(cell.maxDrawdown)} | cadence ${formatNumber(cell.cadencePerDay, 4)} | ${cell.authorityStatus}/${cell.economicCompletenessStatus}`;
          y +=
            page.text(
              label,
              38,
              y,
              2020,
              'matrix',
              `data-matrix-cell="${escapeXml(identity)}" data-criteria="${criteria}"`,
            ) + 12;
          // Nonvisual compatibility index, not monolithic matrix text rows.
          dashboard.raw(
            `<metadata data-cell="${escapeXml(identity)}" data-matrix-page="${escapeXml(name)}"/>`,
          );
          appendix.push({ candidateId: c.id, basis, axis, identity, cell });
        }
      }
    }
    if (counts.observed !== 99 || counts.stress20bps !== 99)
      fail('Matrix page must contain exactly 99+99 cells');
    y +=
      page.text(
        `Crossings/intersections (not additive): ${canonicalJson(c.crossing)}`,
        38,
        y,
        2020,
        'matrix',
      ) + 12;
    page.text(
      'All original metric fields, field availability and full matrices are retained in final-composition-metrics.json and final-composition-metrics.md.',
      38,
      y,
      2020,
      'matrix',
    );
    pages.push({
      candidateId: c.id,
      ordinal: i + 1,
      name,
      observedCells: 99,
      stress20bpsCells: 99,
      cellIdentities: cellKeys,
      ...page.finish(page.bottom + 30, pixelLimit),
    });
  }
  let y = tableTop + 65 + board.candidates.length * 170;
  dashboard.text(
    'Terminal PnL and completed N — ALL candidates, all five windows (diagnostic)',
    38,
    y,
    2020,
    'terminal-heading',
  );
  y += 35;
  const terminalValues = board.candidates
    .flatMap((c) =>
      c.terminal
        .filter((t) => REQUIRED_WINDOWS.includes(t.days))
        .map((t) => t.pnl),
    )
    .filter(Number.isFinite);
  const [terminalMin, terminalMax] = niceBounds(terminalValues, true);
  const tx = (v) => ((v - terminalMin) / (terminalMax - terminalMin)) * 270;
  dashboard.text(
    `Bar domain: ${formatNumber(terminalMin)} → 0 → ${formatNumber(terminalMax)} PnL (${board.normalization.pnlUnit})`,
    38,
    y,
    2020,
    'terminal-heading',
  );
  y += 30;
  REQUIRED_WINDOWS.forEach((days, i) =>
    dashboard.text(`${days}d`, 270 + i * 350, y, 300, `terminal-${i}`),
  );
  y += 28;
  for (const [i, c] of board.candidates.entries()) {
    dashboard.text(executedKey(i), 38, y, 150, 'terminal-key');
    for (const [n, days] of REQUIRED_WINDOWS.entries()) {
      const t = c.terminal.find((t) => t.days === days),
        left = 270 + n * 350;
      dashboard.text(
        `${formatNumber(t?.pnl)} · N ${t?.trades ?? '—'}`,
        left,
        y,
        310,
        `terminal-${n}`,
        `data-terminal-candidate="${escapeXml(c.id)}" data-days="${days}"`,
      );
      dashboard.raw(
        `<line data-terminal-zero="${days}" x1="${left + tx(0)}" x2="${left + tx(0)}" y1="${y + 22}" y2="${y + 38}" class="zero"/>`,
      );
      if (Number.isFinite(t?.pnl))
        dashboard.raw(
          `<rect x="${left + Math.min(tx(0), tx(t.pnl))}" y="${y + 25}" width="${Math.max(0.4, Math.abs(tx(t.pnl) - tx(0)))}" height="8" fill="${c.color}"/>`,
        );
    }
    y += 48;
  }
  y += 25;
  dashboard.text(
    'Full-period diagnostic PnL versus realized MaxDD — every point, deterministic side labels',
    38,
    y,
    2020,
    'scatter-heading',
  );
  y += 40;
  const plotTop = y,
    plotHeight = Math.max(360, board.candidates.length * 26),
    numeric = board.candidates.filter(
      (c) =>
        Number.isFinite(c.metrics.pnl) &&
        Number.isFinite(c.metrics.maxDrawdown),
    );
  const [lo, hi] = niceBounds(
      numeric.map((c) => c.metrics.pnl),
      true,
    ),
    ddMax = Math.max(1, ...numeric.map((c) => c.metrics.maxDrawdown)),
    sx = (n) => 140 + (n / ddMax) * 700,
    sy = (n) => plotTop + ((hi - n) / (hi - lo)) * plotHeight;
  for (const tick of executedTicks(lo, hi)) {
    const py = sy(tick);
    dashboard.raw(
      `<line x1="140" x2="840" y1="${py}" y2="${py}" class="${tick === 0 ? 'zero' : 'grid'}" data-pnl-tick="${tick}"/>`,
    );
    dashboard.text(formatNumber(tick), 38, py - 10, 95, 'scatter-y-tick');
  }
  for (const tick of executedTicks(0, ddMax)) {
    const px = sx(tick);
    dashboard.raw(
      `<line x1="${px}" x2="${px}" y1="${plotTop}" y2="${plotTop + plotHeight}" class="grid"/>`,
    );
    dashboard.text(
      formatNumber(tick),
      px - 45,
      plotTop + plotHeight + 12,
      95,
      'scatter-x-tick',
    );
  }
  dashboard.text(
    `PnL (${board.normalization.pnlUnit})`,
    38,
    plotTop - 25,
    650,
    'scatter-axis',
  );
  dashboard.text(
    'Realized MaxDD',
    300,
    plotTop + plotHeight + 45,
    500,
    'scatter-axis',
  );
  for (const [i, c] of board.candidates.entries()) {
    const top = plotTop + i * 26;
    dashboard.text(
      `${executedKey(i)} · ${c.status}`,
      1040,
      top,
      300,
      'scatter-label',
      `data-scatter-label="${escapeXml(c.id)}"`,
    );
    if (numeric.includes(c))
      dashboard.raw(
        `<circle data-scatter-point="${escapeXml(c.id)}" cx="${sx(c.metrics.maxDrawdown).toFixed(2)}" cy="${sy(c.metrics.pnl).toFixed(2)}" r="6" fill="${c.color}"/><line x1="${sx(c.metrics.maxDrawdown)}" y1="${sy(c.metrics.pnl)}" x2="1020" y2="${top + 10}" stroke="${c.color}"/>`,
      );
  }
  y = plotTop + plotHeight + 95;
  dashboard.text(
    'Candidate key map and exact observed/stress criterion booleans (no omitted candidates)',
    38,
    y,
    2020,
    'key-map-heading',
  );
  y += 30;
  for (const [i, c] of board.candidates.entries()) {
    y +=
      dashboard.text(
        `${executedKey(i)}: ${c.id} · ${c.label} · ${canonicalJson(c.selectionDecision)}`,
        38,
        y,
        2020,
        'key-map',
        `data-criteria-candidate="${escapeXml(c.id)}"`,
      ) + 12;
  }
  const compact = dashboard.finish(dashboard.bottom + 30, pixelLimit);
  const equity = executedCanvas('actual executed cumulative equity', 1800),
    plot = { left: 150, right: 1670, top: 170, bottom: 810 };
  equity.text(executedTitle(board), 38, 25, 1720, 'equity-heading');
  equity.text(
    'Actual closed-loop cumulative PnL · straight observation interpolation · no raw/posthoc curves',
    38,
    55,
    1720,
    'equity-heading',
  );
  const [emin, emax] = niceBounds(
      curves.flatMap((c) => c.points.map((p) => p[1])),
      true,
    ),
    ex = (t) =>
      plot.left +
      ((t - board.comparisonWindow.start) /
        (board.comparisonWindow.end - board.comparisonWindow.start)) *
        (plot.right - plot.left),
    ey = (n) =>
      plot.top + ((emax - n) / (emax - emin)) * (plot.bottom - plot.top);
  equity.text(
    `Cumulative PnL (${board.normalization.pnlUnit})`,
    38,
    125,
    850,
    'equity-axis',
  );
  for (const tick of executedTicks(emin, emax)) {
    const py = ey(tick);
    equity.raw(
      `<line x1="${plot.left}" x2="${plot.right}" y1="${py}" y2="${py}" class="${tick === 0 ? 'zero' : 'grid'}" data-pnl-tick="${tick}"/>`,
    );
    equity.text(formatNumber(tick), 38, py - 10, 100, 'equity-y-tick');
  }
  for (const tick of executedUtcTicks(board.comparisonWindow)) {
    const px = ex(tick),
      label = `${new Date(tick).toISOString().slice(0, 10)} UTC`;
    equity.raw(
      `<line data-utc-tick="${tick}" x1="${px}" x2="${px}" y1="${plot.top}" y2="${plot.bottom}" class="grid"/>`,
    );
    equity.text(
      label,
      Math.min(1610, Math.max(100, px - 70)),
      840,
      150,
      'equity-x-tick',
    );
  }
  equity.text(
    'Date (UTC); exact start/end ticks are annotations, not synthetic equity samples',
    150,
    880,
    1520,
    'equity-axis',
  );
  let legendTop = 925;
  for (const [i, c] of board.candidates.entries()) {
    const curve = curves[i];
    if (curve.points.length) {
      const points = curve.points
        .map(([t, p]) => `${ex(t).toFixed(2)},${ey(p).toFixed(2)}`)
        .join(' ');
      equity.raw(
        `<g data-observed-equity="${escapeXml(c.id)}">${curve.points.length === 1 ? `<circle cx="${ex(curve.points[0][0])}" cy="${ey(curve.points[0][1])}" r="4" fill="${c.color}"/>` : `<polyline points="${points}" fill="none" stroke="${c.color}" stroke-width="2"/>`}</g>`,
      );
    } else
      equity.raw(
        `<g data-non-observation="${escapeXml(c.id)}">${c.equity.status === 'verified-empty' ? `<line data-zero-guide="${escapeXml(c.id)}" x1="${plot.left}" x2="${plot.right}" y1="${ey(0)}" y2="${ey(0)}" stroke="${c.color}" stroke-dasharray="8 8"/>` : ''}</g>`,
      );
    legendTop +=
      equity.text(
        `${executedKey(i)} · ${c.id} · ${c.label} · ${c.status} · N=${c.metrics.trades} · PnL=${formatNumber(c.metrics.pnl)} · MaxDD=${formatNumber(c.metrics.maxDrawdown)} · samples=${curve.fullResolutionRows}${!curve.points.length ? (c.equity.status === 'verified-empty' ? ' · verified empty; zero guide is not observed equity' : ' · equity unavailable (UNKNOWN)') : ''}`,
        38,
        legendTop,
        1720,
        'equity-legend',
      ) + 12;
  }
  return {
    dashboard: compact,
    equity: equity.finish(equity.bottom + 30, pixelLimit),
    pages,
    appendix,
  };
};

const generateExecutedBoard = async ({ spec, artifactRoot, outDir, png }) => {
  const board = validateExecutedBoard(spec);
  const preRun = await readExecutedDescriptor(
    artifactRoot,
    board.selectionAuthority,
  );
  const inputs = [board.selectionAuthority],
    curves = [];
  for (const c of board.candidates) {
    const p = c.composition;
    const { report, authority } = await loadExecutedCompositionReport({
      projectRoot: artifactRoot,
      authority: p.executedCompositionAuthority,
      report: p.executedCompositionReport,
      receipt: p.executedCompositionReceipt,
    });
    if (
      canonicalJson(authority.selectionAuthority) !==
      canonicalJson(board.selectionAuthority)
    )
      fail('Board selection authority differs from candidate authority');
    if (
      report.candidateId !== c.id ||
      report.researchId !== board.researchId ||
      report.comparisonWindow.start !== board.comparisonWindow.start ||
      report.comparisonWindow.end !== board.comparisonWindow.end ||
      !sameBoardData(c, report)
    )
      fail('Executed board copied economics differ from report');
    c.compositionFingerprint = sha256(
      stableStringify({
        executionBasis: board.executionBasis,
        metricBasis: board.metricBasis,
        authority: p.executedCompositionAuthority,
        report: p.executedCompositionReport,
        receipt: p.executedCompositionReceipt,
        inputs: report.inputs,
      }),
    );
    inputs.push(
      p.executedCompositionAuthority,
      p.executedCompositionReport,
      p.executedCompositionReceipt,
    );
    const reduced = await reduceExecutedEquity({
      projectRoot: artifactRoot,
      equity: c.equity,
      comparisonWindow: board.comparisonWindow,
    });
    if (reduced.finalPnl !== null && reduced.finalPnl !== c.metrics.pnl)
      fail('Executed observed equity final PnL mismatch');
    curves.push(reduced);
  }
  const resolved = resolveExecutedSelection(board.candidates, preRun.value);
  if (
    canonicalJson(resolved) !==
    canonicalJson({
      selectedId: board.selectedId,
      selectionDisposition: board.selectionDisposition,
      finalSelectable: board.finalSelectable,
    })
  )
    fail('Board selection contradicts frozen algorithm');
  // Validate the entire layout and every per-page pixel budget before any write.
  const presentation = renderExecutedPresentation({
    board,
    curves,
    criteria: preRun.value.criteria,
  });
  const absoluteOutDir = boundPath(artifactRoot, outDir, false);
  await mkdir(absoluteOutDir); // Exclusive directory; never overwrite old charts.
  const files = [];
  for (const [name, { svg }] of [
    ['final-composition-dashboard', presentation.dashboard],
    ['final-composition-equity', presentation.equity],
    ...presentation.pages.map((page) => [page.name, page]),
  ]) {
    const file = path.join(absoluteOutDir, `${name}.svg`);
    await writeFile(file, svg + '\n', { flag: 'wx' });
    files.push(file);
    if (png) {
      const pngFile = path.join(absoluteOutDir, `${name}.png`);
      const { default: sharp } = await import('sharp');
      await writeFile(pngFile, await sharp(Buffer.from(svg)).png().toBuffer(), {
        flag: 'wx',
      });
      files.push(pngFile);
    }
  }
  const metricsPath = path.join(
    absoluteOutDir,
    'final-composition-metrics.json',
  );
  await writeFile(
    metricsPath,
    JSON.stringify(
      {
        schema: 'tradejs-executed-metric-appendix/v1',
        cells: presentation.appendix,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  files.push(metricsPath);
  const readablePath = path.join(
    absoluteOutDir,
    'final-composition-metrics.md',
  );
  const readable = [
    '# Complete verified metric appendix',
    '',
    'Diagnostic cells do not select a winner. Only OUTER_TEST_FROZEN/ALL_UNIVERSE/ALL uses frozen criteria. Values and availability are copied without recomputation.',
    '',
  ];
  for (const row of presentation.appendix) {
    readable.push(
      `## ${row.identity}`,
      '',
      '| Field | Exact value |',
      '| --- | --- |',
    );
    for (const [key, value] of Object.entries(row.cell))
      readable.push(
        `| ${key} | ${JSON.stringify(value).replaceAll('|', '\\|')} |`,
      );
    readable.push('');
  }
  await writeFile(readablePath, readable.join('\n') + '\n', { flag: 'wx' });
  files.push(readablePath);
  for (const ref of inputs)
    if ((await sha256File(boundPath(artifactRoot, ref.path))) !== ref.sha256)
      fail('Board inputs changed while rendering');
  const summary = {
    schema: 'tradejs-final-composition-summary/v1',
    executionBasis: board.executionBasis,
    metricBasis: board.metricBasis,
    researchId: board.researchId,
    strategy: board.strategy,
    baselineId: board.baselineId,
    selectedId: board.selectedId,
    selectionDisposition: board.selectionDisposition,
    finalSelectable: board.finalSelectable,
    comparisonWindow: board.comparisonWindow,
    coverage: { requestedDays: 1825, coveredDays: 1461 },
    specSha256: sha256(stableStringify(spec)),
    inputs,
    rendering: {
      equityInterpolation: 'linear',
      metricInputsChanged: false,
      reduction: curves.map(({ points: _points, ...receipt }) => receipt),
      zeroGuidesAreObservedSamples: false,
      pagination: 'per-candidate-matrix/v1',
      matrixPages: await Promise.all(
        presentation.pages.map(async (page) => ({
          candidateId: page.candidateId,
          ordinal: page.ordinal,
          observedCells: page.observedCells,
          stress20bpsCells: page.stress20bpsCells,
          cellIdentities: page.cellIdentities,
          width: page.width,
          height: page.height,
          svg: {
            path: `${page.name}.svg`,
            sha256: await sha256File(
              path.join(absoluteOutDir, `${page.name}.svg`),
            ),
          },
          png: png
            ? {
                path: `${page.name}.png`,
                sha256: await sha256File(
                  path.join(absoluteOutDir, `${page.name}.png`),
                ),
              }
            : null,
        })),
      ),
      metricAppendix: {
        json: 'final-composition-metrics.json',
        readable: 'final-composition-metrics.md',
      },
    },
    limitations: board.limitations,
    candidates: board.candidates.map((c) => ({ ...c })),
    artifacts: Object.fromEntries(
      await Promise.all(
        files.map(async (file) => [
          path.basename(file),
          await sha256File(file),
        ]),
      ),
    ),
  };
  const summaryPath = path.join(
    absoluteOutDir,
    'final-composition-summary.json',
  );
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n', {
    flag: 'wx',
  });
  return { summary, summaryPath };
};
const sameBoardData = (c, report) => {
  const metrics = report.matrices.observed.exitWindow.find(
    (cell) =>
      cell.id === 'FULL_1461D' &&
      cell.symbolGroupId === 'ALL_UNIVERSE' &&
      cell.direction === 'ALL',
  );
  const terminal = [1460, 1095, 365, 180, 90, 30, 7].map((days) => ({
    days,
    ...report.matrices.observed.exitWindow.find(
      (cell) =>
        cell.id === `LAST_${days}D` &&
        cell.symbolGroupId === 'ALL_UNIVERSE' &&
        cell.direction === 'ALL',
    ),
  }));
  return (
    canonicalJson({
      metrics: c.metrics,
      terminal: c.terminal,
      matrices: c.matrices,
      equity: c.equity,
      selectionDecision: c.selectionDecision,
      crossing: c.crossing,
      funnel: c.funnel,
    }) ===
    canonicalJson({
      metrics,
      terminal,
      matrices: report.matrices,
      equity: report.equity,
      selectionDecision: report.selectionDecision,
      crossing: report.crossing,
      funnel: report.funnel,
    })
  );
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
