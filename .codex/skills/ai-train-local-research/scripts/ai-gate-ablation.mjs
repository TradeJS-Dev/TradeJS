#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_DAYS = 30.4375;
const YEAR_DAYS = 365;
const DEFAULT_WINDOWS = [180, 90, 30, 7];
const DEFAULT_QUALITY_THRESHOLDS = [3, 4, 5];
const DEFAULT_CAPACITIES = [1, 3, 5];
const DEFAULT_MA_PERIODS = Array.from(
  { length: 20 },
  (_, index) => (index + 1) * 5,
);
const VARIANT_MODES = new Set(['filter', 'exclude', 'add', 'replace']);

const usage = `Usage:
  node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs [options]

Options:
  --file <path>                 Any shard from a merged AI export
  --strategy <name>            Latest merged export for this strategy token
  --outDir <path>              Dataset directory (default: data/ai/export)
  --variant <spec>             name::mode[@quality][LONG|SHORT]::expression (repeatable)
  --spec <path>                JSON file with a { "variants": [...] } array
  --minQuality <n>             Main baseline threshold (default: 4)
  --qualityThresholds <list>   qN+ summaries (default: 3,4,5)
  --terminalWindows <list>     Terminal windows in days (default: 180,90,30,7)
  --validationSplit <ratio>    Trailing timestamp-grouped tuning share (default: 0.25)
  --testSplit <ratio>          Later timestamp-grouped test share (default: 0)
  --tuningSince <timestamp>    Exact UTC boundary where tuning starts
  --testSince <timestamp>      Exact UTC boundary where test starts
  --capacities <list>          Capacity stress limits (default: 1,3,5)
  --maxLossValue <n>           Per-order loss budget for capacity stress
  --featurePattern <regex>     Inventory matching causal feature paths
  --includeGateContext         Include current gate output fields for audits only
  --movingAverageStudy        Causal SMA/EMA/WMA grid ablation from candle cache
  --maPeriods <list>           Moving-average periods (default: 5,10,...,100)
  --maLookbackBars <n>         EMA approximation history (default: 600)
  --maBatchSize <n>            Timescale events per query (default: 1000)
  --maSqlTimeoutMs <n>         Per-batch SQL timeout (default: 600000)
  --crossStrategy             Search latest exports for shared LONG/SHORT pockets
  --maxDepth <n>              Cross-strategy pocket depth (default: 2)
  --minSupport <n>            Cross-strategy discovery support (default: 100)
  --minValidationSupport <n>  Cross-strategy tuning support (default: 50)
  --maxAtomicPredicates <n>   Cross-strategy predicate pool (default: 160)
  --maxCombinations <n>       Cross-strategy combinations (default: 60000)
  --top <n>                   Cross-strategy candidates per side (default: 10)
  --maxRowsPerStrategy <n>    Balanced discovery cap per strategy (default: 2500)
  --maxRowsPerEvent <n>       Discovery rows per strategy/timestamp (default: 1)
  --minFeatureStrategies <n>  Required strategy coverage per feature (default: 8)
  --minFeatureCoverage <r>    Required row coverage inside a strategy (default: 0.5)
  --minBenchmarkFeatureCoverage <r>
                               Benchmark/reference row coverage (default: 0.1)
  --portfolioCapacity <n>     Maximum simultaneous approval fan-out (default: 5)
  --output <path>              Write Markdown, or JSON when extension is .json
  --json                       Print JSON instead of Markdown
  --list                       List merged export groups and exit
  --help                       Show this help
`;

const isDirectRun = () => {
  const entry = process.argv[1];
  return (
    Boolean(entry) &&
    pathToFileURL(path.resolve(entry)).href === import.meta.url
  );
};

const parseNumberList = (input, fallback) => {
  const values = String(input ?? '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter(Number.isFinite)
    .map((value) => Math.trunc(value))
    .filter((value) => value > 0);
  return values.length ? [...new Set(values)] : fallback;
};

export const parseCliArgs = (argv) => {
  const options = {
    outDir: 'data/ai/export',
    minQuality: 4,
    qualityThresholds: DEFAULT_QUALITY_THRESHOLDS,
    terminalWindows: DEFAULT_WINDOWS,
    validationSplit: 0.25,
    testSplit: 0,
    tuningSince: null,
    testSince: null,
    capacities: DEFAULT_CAPACITIES,
    maxLossValue: null,
    variants: [],
    includeGateContext: false,
    movingAverageStudy: false,
    maPeriods: DEFAULT_MA_PERIODS,
    maLookbackBars: 600,
    maBatchSize: 1_000,
    maSqlTimeoutMs: 600_000,
    crossStrategy: false,
    maxDepth: 2,
    minSupport: 100,
    minValidationSupport: 50,
    maxAtomicPredicates: 160,
    maxCombinations: 60_000,
    top: 10,
    maxRowsPerStrategy: 2_500,
    maxRowsPerEvent: 1,
    minFeatureStrategies: 8,
    minFeatureCoverage: 0.5,
    minBenchmarkFeatureCoverage: 0.1,
    portfolioCapacity: 5,
    json: false,
    list: false,
    help: false,
  };
  const booleanOptions = new Set([
    'includeGateContext',
    'movingAverageStudy',
    'crossStrategy',
    'json',
    'list',
    'help',
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const equalsIndex = argument.indexOf('=');
    const name = argument.slice(2, equalsIndex >= 0 ? equalsIndex : undefined);
    if (booleanOptions.has(name)) {
      options[name] = true;
      continue;
    }
    const value =
      equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : argv[++index];
    if (value == null || value.startsWith('--')) {
      throw new Error(`Missing value for --${name}`);
    }
    if (name === 'variant') {
      options.variants.push(value);
    } else if (name === 'minQuality') {
      options.minQuality = Math.max(1, Math.trunc(Number(value) || 4));
    } else if (name === 'qualityThresholds') {
      options.qualityThresholds = parseNumberList(
        value,
        DEFAULT_QUALITY_THRESHOLDS,
      );
    } else if (name === 'terminalWindows') {
      options.terminalWindows = parseNumberList(value, DEFAULT_WINDOWS);
    } else if (name === 'validationSplit') {
      const parsed = Number(value);
      options.validationSplit = Number.isFinite(parsed)
        ? Math.max(0, Math.min(0.9, parsed))
        : 0.25;
    } else if (name === 'testSplit') {
      const parsed = Number(value);
      options.testSplit = Number.isFinite(parsed)
        ? Math.max(0, Math.min(0.9, parsed))
        : 0;
    } else if (name === 'tuningSince' || name === 'testSince') {
      const numeric = Number(value);
      const parsed = Number.isFinite(numeric) ? numeric : Date.parse(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid timestamp for --${name}: ${value}`);
      }
      options[name] = parsed;
    } else if (name === 'capacities') {
      options.capacities = parseNumberList(value, DEFAULT_CAPACITIES);
    } else if (name === 'maxLossValue') {
      const parsed = Number(value);
      options.maxLossValue =
        Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    } else if (name === 'maPeriods') {
      options.maPeriods = parseNumberList(value, DEFAULT_MA_PERIODS).sort(
        (left, right) => left - right,
      );
    } else if (
      ['minFeatureCoverage', 'minBenchmarkFeatureCoverage'].includes(name)
    ) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
        throw new Error(`Invalid ratio for --${name}: ${value}`);
      }
      options[name] = parsed;
    } else if (
      [
        'maxDepth',
        'minSupport',
        'minValidationSupport',
        'maxAtomicPredicates',
        'maxCombinations',
        'top',
        'maxRowsPerStrategy',
        'maxRowsPerEvent',
        'minFeatureStrategies',
        'portfolioCapacity',
        'maLookbackBars',
        'maBatchSize',
        'maSqlTimeoutMs',
      ].includes(name)
    ) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid positive integer for --${name}: ${value}`);
      }
      options[name] = Math.trunc(parsed);
    } else if (
      [
        'file',
        'strategy',
        'outDir',
        'spec',
        'featurePattern',
        'output',
      ].includes(name)
    ) {
      options[name] = value;
    } else {
      throw new Error(`Unknown option: --${name}`);
    }
  }

  return options;
};

const resolveExactGitCheckout = (input, environmentName) => {
  const requestedRoot = path.resolve(input);
  let exactRoot;
  let gitRoot;
  try {
    exactRoot = fs.realpathSync(requestedRoot);
    gitRoot = fs.realpathSync(
      execFileSync('git', ['-C', exactRoot, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    throw new Error(
      `${environmentName} must identify an existing Git checkout: ${requestedRoot}`,
    );
  }
  if (gitRoot !== exactRoot) {
    throw new Error(
      `${environmentName} must point to the exact Git repository root, not a subdirectory: ${requestedRoot}`,
    );
  }
  return exactRoot;
};

const readRepositoryPackage = (root) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
};

const isFrameworkRepositoryRoot = (root) =>
  readRepositoryPackage(root) != null &&
  fs.existsSync(path.join(root, 'packages', 'node')) &&
  fs.existsSync(path.join(root, 'packages', 'cli'));

const isStandaloneStrategyRepositoryRoot = (root) => {
  const packageJson = readRepositoryPackage(root);
  return (
    /^@tradejs\/strategy-[a-z0-9-]+$/.test(String(packageJson?.name ?? '')) &&
    packageJson.name !== '@tradejs/strategy-kit' &&
    fs.existsSync(path.join(root, 'src'))
  );
};

export const getSourceRepositoryKind = (root) => {
  if (isFrameworkRepositoryRoot(root)) return 'framework';
  if (isStandaloneStrategyRepositoryRoot(root)) return 'strategy';
  return null;
};

export const findSourceRepositoryRoot = () => {
  const explicitSourceRoot = String(
    process.env.TRADEJS_SOURCE_REPOSITORY_ROOT || '',
  ).trim();
  if (!explicitSourceRoot) {
    throw new Error(
      'TRADEJS_SOURCE_REPOSITORY_ROOT is required for AI-gate research.',
    );
  }
  const root = resolveExactGitCheckout(
    explicitSourceRoot,
    'TRADEJS_SOURCE_REPOSITORY_ROOT',
  );
  if (!getSourceRepositoryKind(root)) {
    throw new Error(
      `TRADEJS_SOURCE_REPOSITORY_ROOT must identify a TradeJS framework or standalone strategy repository: ${explicitSourceRoot}`,
    );
  }
  return root;
};

export const findFrameworkRepositoryRoot = (sourceRepositoryRoot) => {
  const explicitFrameworkRoot = String(
    process.env.TRADEJS_FRAMEWORK_REPOSITORY_ROOT || '',
  ).trim();
  if (!explicitFrameworkRoot) {
    if (getSourceRepositoryKind(sourceRepositoryRoot) === 'framework') {
      return sourceRepositoryRoot;
    }
    throw new Error(
      'TRADEJS_FRAMEWORK_REPOSITORY_ROOT is required when TRADEJS_SOURCE_REPOSITORY_ROOT is a standalone strategy checkout.',
    );
  }
  const root = resolveExactGitCheckout(
    explicitFrameworkRoot,
    'TRADEJS_FRAMEWORK_REPOSITORY_ROOT',
  );
  if (!isFrameworkRepositoryRoot(root)) {
    throw new Error(
      `TRADEJS_FRAMEWORK_REPOSITORY_ROOT must identify a TradeJS framework repository with packages/node and packages/cli: ${explicitFrameworkRoot}`,
    );
  }
  return root;
};

export const resolveArtifactProjectRoot = () =>
  path.resolve(String(process.env.PROJECT_CWD || process.cwd()).trim());

const parseDatasetName = (filePath) => {
  const match = path
    .basename(filePath)
    .match(/^ai-dataset-(.+)-merged-(\d+)(?:-part(\d+))?\.jsonl$/i);
  if (!match) return null;
  return {
    strategyToken: match[1],
    mergeId: match[2],
    part: Number(match[3] ?? 0),
  };
};

const compareMergeIds = (left, right) => {
  try {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  } catch {
    return left.localeCompare(right);
  }
};

export const listDatasetGroups = async (outDir) => {
  const entries = await fsp.readdir(outDir);
  const groups = new Map();
  for (const name of entries) {
    const parsed = parseDatasetName(name);
    if (!parsed) continue;
    const key = `${parsed.strategyToken.toLowerCase()}:${parsed.mergeId}`;
    const group = groups.get(key) ?? {
      strategyToken: parsed.strategyToken,
      mergeId: parsed.mergeId,
      files: [],
    };
    group.files.push(path.join(outDir, name));
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      files: group.files.sort((left, right) => {
        const leftPart = parseDatasetName(left)?.part ?? 0;
        const rightPart = parseDatasetName(right)?.part ?? 0;
        return leftPart - rightPart || left.localeCompare(right);
      }),
    }))
    .sort(
      (left, right) =>
        compareMergeIds(left.mergeId, right.mergeId) ||
        left.strategyToken.localeCompare(right.strategyToken),
    );
};

export const latestDatasetGroupsByStrategy = (groups) => {
  const latest = new Map();
  for (const group of groups) {
    const key = normalizeStrategyToken(group.strategyToken);
    const current = latest.get(key);
    if (!current || compareMergeIds(current.mergeId, group.mergeId) < 0) {
      latest.set(key, group);
    }
  }
  return [...latest.values()].sort((left, right) =>
    left.strategyToken.localeCompare(right.strategyToken),
  );
};

const normalizeStrategyToken = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

export const resolveDatasetFiles = async ({
  projectRoot,
  outDir,
  file,
  strategy,
}) => {
  if (file) {
    const explicitPath = path.resolve(projectRoot, file);
    await fsp.access(explicitPath);
    const parsed = parseDatasetName(explicitPath);
    if (!parsed) return [explicitPath];
    const groups = await listDatasetGroups(path.dirname(explicitPath));
    const group = groups.find(
      (candidate) =>
        candidate.mergeId === parsed.mergeId &&
        candidate.strategyToken.toLowerCase() ===
          parsed.strategyToken.toLowerCase(),
    );
    return group?.files.length ? group.files : [explicitPath];
  }

  const resolvedOutDir = path.resolve(projectRoot, outDir);
  const groups = await listDatasetGroups(resolvedOutDir);
  const strategyToken = normalizeStrategyToken(strategy);
  const matching = strategyToken
    ? groups.filter(
        (group) =>
          normalizeStrategyToken(group.strategyToken) === strategyToken,
      )
    : groups;
  const latest = matching.at(-1);
  if (!latest) {
    throw new Error(
      strategy
        ? `No merged export found for ${strategy} in ${resolvedOutDir}`
        : `No merged export found in ${resolvedOutDir}`,
    );
  }
  return latest.files;
};

const tokenizeExpression = (expression) => {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const source = expression.slice(index);
    const whitespace = source.match(/^\s+/);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const operator = source.match(/^(?:&&|\|\||<=|>=|==|!=|<|>|\(|\))/);
    if (operator) {
      tokens.push({ type: 'operator', value: operator[0] });
      index += operator[0].length;
      continue;
    }
    if (source[0] === '"' || source[0] === "'") {
      const quote = source[0];
      let end = 1;
      let escaped = false;
      for (; end < source.length; end += 1) {
        const character = source[end];
        if (!escaped && character === quote) break;
        escaped = !escaped && character === '\\';
        if (character !== '\\') escaped = false;
      }
      if (end >= source.length) {
        throw new Error(`Unterminated string in expression: ${expression}`);
      }
      const raw = source.slice(1, end);
      const value = raw.replace(/\\([\\'"nrt])/g, (_, escapedValue) => {
        const replacements = { n: '\n', r: '\r', t: '\t' };
        return replacements[escapedValue] ?? escapedValue;
      });
      tokens.push({ type: 'value', value });
      index += end + 1;
      continue;
    }
    const number = source.match(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      tokens.push({ type: 'value', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const identifier = source.match(/^[A-Za-z_$][A-Za-z0-9_$.[\]-]*/);
    if (identifier) {
      const raw = identifier[0];
      const literals = new Map([
        ['true', true],
        ['false', false],
        ['null', null],
      ]);
      tokens.push(
        literals.has(raw)
          ? { type: 'value', value: literals.get(raw) }
          : { type: 'identifier', value: raw },
      );
      index += raw.length;
      continue;
    }
    throw new Error(
      `Unexpected token near ${JSON.stringify(source.slice(0, 24))} in ${expression}`,
    );
  }
  return tokens;
};

export const parseRuleExpression = (expression) => {
  const tokens = tokenizeExpression(expression);
  let index = 0;
  const peek = () => tokens[index];
  const consume = (value) => {
    const token = tokens[index];
    if (!token || (value != null && token.value !== value)) {
      throw new Error(
        `Expected ${value ?? 'token'} at token ${index} in ${expression}`,
      );
    }
    index += 1;
    return token;
  };
  const parsePrimary = () => {
    if (peek()?.value === '(') {
      consume('(');
      const nested = parseOr();
      consume(')');
      return nested;
    }
    const feature = consume();
    if (feature.type === 'value' && typeof feature.value === 'boolean') {
      return { kind: 'constant', value: feature.value };
    }
    if (feature.type !== 'identifier') {
      throw new Error(`Expected feature path at token ${index - 1}`);
    }
    const operator = consume();
    if (!['<=', '>=', '==', '!=', '<', '>'].includes(operator.value)) {
      throw new Error(`Unsupported comparison operator: ${operator.value}`);
    }
    const expected = consume();
    if (!['value', 'identifier'].includes(expected.type)) {
      throw new Error(`Expected comparison value at token ${index - 1}`);
    }
    return {
      kind: 'predicate',
      feature: feature.value,
      operator: operator.value,
      expected: expected.value,
    };
  };
  const parseAnd = () => {
    let node = parsePrimary();
    while (peek()?.value === '&&') {
      consume('&&');
      node = { kind: 'and', left: node, right: parsePrimary() };
    }
    return node;
  };
  const parseOr = () => {
    let node = parseAnd();
    while (peek()?.value === '||') {
      consume('||');
      node = { kind: 'or', left: node, right: parseAnd() };
    }
    return node;
  };
  if (!tokens.length) throw new Error('Variant expression must not be empty');
  const rule = parseOr();
  if (index !== tokens.length) {
    throw new Error(`Unexpected trailing token ${tokens[index].value}`);
  }
  return rule;
};

export const evaluateRule = (rule, features) => {
  if (rule.kind === 'constant') return rule.value;
  if (rule.kind === 'and') {
    return (
      evaluateRule(rule.left, features) && evaluateRule(rule.right, features)
    );
  }
  if (rule.kind === 'or') {
    return (
      evaluateRule(rule.left, features) || evaluateRule(rule.right, features)
    );
  }
  const hasFeature = Object.prototype.hasOwnProperty.call(
    features,
    rule.feature,
  );
  if (!hasFeature) return false;
  const actual = features[rule.feature];
  const expected = rule.expected;
  if (rule.operator === '==') return actual === expected;
  if (rule.operator === '!=') return actual !== expected;
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  if (rule.operator === '<=') return actual <= expected;
  if (rule.operator === '>=') return actual >= expected;
  if (rule.operator === '<') return actual < expected;
  return actual > expected;
};

export const parseVariant = (input) => {
  const firstSeparator = input.indexOf('::');
  const secondSeparator = input.indexOf('::', firstSeparator + 2);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator + 2) {
    throw new Error(
      `Invalid variant ${JSON.stringify(input)}. Use name::mode[@quality]::expression`,
    );
  }
  const name = input.slice(0, firstSeparator).trim();
  const modeInput = input.slice(firstSeparator + 2, secondSeparator).trim();
  const expression = input.slice(secondSeparator + 2).trim();
  const directionMatch = modeInput.match(/\[(LONG|SHORT|[^\]]+)\]$/);
  const direction = directionMatch?.[1] ?? null;
  if (direction != null && direction !== 'LONG' && direction !== 'SHORT') {
    throw new Error(`Invalid direction scope in variant ${name}`);
  }
  const scopedModeInput = directionMatch
    ? modeInput.slice(0, directionMatch.index)
    : modeInput;
  const [mode, qualityInput] = scopedModeInput.split('@');
  if (!name || !expression) {
    throw new Error('Variant name and expression must not be empty');
  }
  if (!VARIANT_MODES.has(mode)) {
    throw new Error(`Unsupported variant mode ${JSON.stringify(mode)}`);
  }
  const quality = qualityInput == null ? null : Number(qualityInput);
  if (
    qualityInput != null &&
    (!Number.isFinite(quality) || quality < 1 || quality > 5)
  ) {
    throw new Error(`Invalid added quality in variant ${name}`);
  }
  return {
    name,
    mode,
    quality: quality == null ? null : Math.trunc(quality),
    direction,
    expression,
    rule: parseRuleExpression(expression),
  };
};

const loadVariants = async (inlineVariants, specPath) => {
  const variants = inlineVariants.map(parseVariant);
  if (!specPath) return variants;
  const parsed = JSON.parse(await fsp.readFile(path.resolve(specPath), 'utf8'));
  const entries = Array.isArray(parsed) ? parsed : parsed.variants;
  if (!Array.isArray(entries)) {
    throw new Error(
      'Variant spec must be an array or contain a variants array',
    );
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Each variant spec entry must be an object');
    }
    const qualitySuffix =
      entry.quality == null ? '' : `@${Math.trunc(Number(entry.quality))}`;
    const directionSuffix =
      entry.direction == null ? '' : `[${String(entry.direction)}]`;
    variants.push(
      parseVariant(
        `${entry.name}::${entry.mode}${qualitySuffix}${directionSuffix}::${entry.expression}`,
      ),
    );
  }
  const names = new Set();
  for (const variant of variants) {
    if (names.has(variant.name)) {
      throw new Error(`Duplicate variant name: ${variant.name}`);
    }
    names.add(variant.name);
  }
  return variants;
};

const getPeriodDays = (rows) => {
  if (!rows.length) return 1;
  return Math.max((rows.at(-1).timestamp - rows[0].timestamp) / DAY_MS, 1);
};

const getCalendarDays = (rows) => {
  if (!rows.length) return 1;
  const toUtcDay = (timestamp) => {
    const date = new Date(timestamp);
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
  };
  return Math.max(
    1,
    Math.round(
      (toUtcDay(rows.at(-1).timestamp) - toUtcDay(rows[0].timestamp)) / DAY_MS,
    ) + 1,
  );
};

const percentileNearestRank = (values, percentile) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
};

const summarizeEvents = (
  rows,
  denominatorDays,
  {
    capacities = DEFAULT_CAPACITIES,
    maxLossValue = null,
    calendarDays = null,
  } = {},
) => {
  const events = new Map();
  const activeDays = new Set();
  for (const row of rows) {
    const event = events.get(row.timestamp) ?? { trades: 0, pnl: 0 };
    event.trades += 1;
    event.pnl += row.profit;
    events.set(row.timestamp, event);
    activeDays.add(new Date(row.timestamp).toISOString().slice(0, 10));
  }
  const values = [...events.values()];
  const topEvent = [...values].sort(
    (left, right) =>
      right.trades - left.trades || Math.abs(right.pnl) - Math.abs(left.pnl),
  )[0];
  const safeDenominatorDays = Math.max(denominatorDays, 1);
  const totalProfit = rows.reduce((sum, row) => sum + row.profit, 0);
  const maxBatch = values.length
    ? Math.max(...values.map((event) => event.trades))
    : 0;
  return {
    events: values.length,
    eventsPerDay: values.length / safeDenominatorDays,
    activeDays: activeDays.size,
    activeDayRatio:
      activeDays.size /
      Math.max(1, calendarDays ?? Math.ceil(safeDenominatorDays)),
    tradesPerEvent: values.length ? rows.length / values.length : null,
    p95Batch: percentileNearestRank(
      values.map((event) => event.trades),
      0.95,
    ),
    maxBatch,
    topEventCountShare:
      rows.length && topEvent ? topEvent.trades / rows.length : null,
    topEventPnlShare:
      totalProfit !== 0 && topEvent ? topEvent.pnl / totalProfit : null,
    capacityStress: Object.fromEntries(
      capacities.map((capacityValue) => {
        const capacity = Math.max(1, Math.trunc(capacityValue));
        const accepted = values.reduce(
          (sum, event) => sum + Math.min(event.trades, capacity),
          0,
        );
        return [
          String(capacity),
          {
            capacity,
            accepted,
            overflow: rows.length - accepted,
            overflowEvents: values.filter((event) => event.trades > capacity)
              .length,
            maxSimultaneousStopRisk:
              maxLossValue == null
                ? null
                : Math.min(maxBatch, capacity) * maxLossValue,
          },
        ];
      }),
    ),
  };
};

export const summarizeRows = (
  rows,
  denominatorDays = getPeriodDays(rows),
  summaryOptions = {},
) => {
  let totalProfit = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let drawdownSquares = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;
  let largestLoss = null;
  const months = new Map();
  const symbols = new Map();
  const directions = new Map();

  for (const row of rows) {
    totalProfit += row.profit;
    if (row.profit > 0) {
      wins += 1;
      grossProfit += row.profit;
      currentLossStreak = 0;
    } else if (row.profit < 0) {
      losses += 1;
      grossLoss += Math.abs(row.profit);
      currentLossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
      largestLoss =
        largestLoss == null ? row.profit : Math.min(largestLoss, row.profit);
    } else {
      currentLossStreak = 0;
    }
    equity += row.profit;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    const drawdown = Math.max(0, peak - equity);
    drawdownSquares += drawdown * drawdown;
    const month = new Date(row.timestamp).toISOString().slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + row.profit);
    const symbol = symbols.get(row.symbol) ?? { count: 0, pnl: 0 };
    symbol.count += 1;
    symbol.pnl += row.profit;
    symbols.set(row.symbol, symbol);
    directions.set(row.direction, (directions.get(row.direction) ?? 0) + 1);
  }

  const losingMonthValues = [...months.entries()]
    .filter(([, pnl]) => pnl < 0)
    .map(([month, pnl]) => ({ month, pnl }));
  const topSymbols = [...symbols.entries()]
    .map(([symbol, value]) => ({ symbol, ...value }))
    .sort((left, right) => right.count - left.count || right.pnl - left.pnl)
    .slice(0, 10);
  const averageTrade = rows.length ? totalProfit / rows.length : null;
  const tradeStdDev =
    averageTrade == null
      ? null
      : Math.sqrt(
          rows.reduce((sum, row) => {
            const diff = row.profit - averageTrade;
            return sum + diff * diff;
          }, 0) / rows.length,
        );
  const downsideDeviation = rows.length
    ? Math.sqrt(
        rows.reduce(
          (sum, row) => (row.profit < 0 ? sum + row.profit * row.profit : sum),
          0,
        ) / rows.length,
      )
    : null;
  const safeDenominatorDays = Math.max(denominatorDays, 1);
  const annualizationScale = rows.length
    ? Math.sqrt((rows.length / safeDenominatorDays) * YEAR_DAYS)
    : null;
  const annualizedProfit = (totalProfit / safeDenominatorDays) * YEAR_DAYS;
  const eventSummary = summarizeEvents(
    rows,
    safeDenominatorDays,
    summaryOptions,
  );

  return {
    trades: rows.length,
    wins,
    losses,
    winRate: rows.length ? wins / rows.length : null,
    totalProfit,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averageTrade,
    averageWin: wins > 0 ? grossProfit / wins : null,
    averageLoss: losses > 0 ? grossLoss / losses : null,
    payoffRatio:
      wins > 0 && losses > 0 && grossLoss > 0
        ? grossProfit / wins / (grossLoss / losses)
        : null,
    maxDrawdown,
    maxDrawdownPctOfGrossProfit:
      grossProfit > 0 ? maxDrawdown / grossProfit : null,
    maxDrawdownPctOfTotalProfit:
      totalProfit > 0 ? maxDrawdown / totalProfit : null,
    sharpeRatio:
      tradeStdDev != null &&
      tradeStdDev > 0 &&
      annualizationScale != null &&
      annualizationScale > 0
        ? (averageTrade / tradeStdDev) * annualizationScale
        : null,
    sortinoRatio:
      downsideDeviation != null &&
      downsideDeviation > 0 &&
      annualizationScale != null &&
      annualizationScale > 0
        ? (averageTrade / downsideDeviation) * annualizationScale
        : null,
    calmarRatio: maxDrawdown > 0 ? annualizedProfit / maxDrawdown : null,
    recoveryFactor: maxDrawdown > 0 ? totalProfit / maxDrawdown : null,
    ulcerIndex: rows.length ? Math.sqrt(drawdownSquares / rows.length) : null,
    largestLoss,
    maxLossStreak,
    losingMonths: losingMonthValues.length,
    losingMonthValues,
    cadencePerDay: rows.length / safeDenominatorDays,
    cadencePerWeek: (rows.length / safeDenominatorDays) * 7,
    averageProfitPerDay: totalProfit / safeDenominatorDays,
    averageProfitPerMonth: (totalProfit / safeDenominatorDays) * MONTH_DAYS,
    uniqueTimestamps: eventSummary.events,
    ...eventSummary,
    directionCounts: Object.fromEntries(directions),
    topSymbols,
  };
};

export const isVariantSelected = ({
  variant,
  baselineSelected,
  matches,
  direction,
  threshold,
  defaultQuality,
}) => {
  if (variant.direction != null && variant.direction !== direction) {
    return baselineSelected;
  }
  if (variant.mode === 'filter') return baselineSelected && matches;
  if (variant.mode === 'exclude') return baselineSelected && !matches;
  const variantQuality = variant.quality ?? defaultQuality;
  const ruleSelected = matches && variantQuality >= threshold;
  if (variant.mode === 'add') return baselineSelected || ruleSelected;
  return ruleSelected;
};

const baselineSelectedAt = (row, threshold) =>
  row.directionMatches && row.quality != null && row.quality >= threshold;

const candidateSelectedAt = (
  row,
  variant,
  variantIndex,
  threshold,
  minQuality,
) =>
  isVariantSelected({
    variant,
    baselineSelected: baselineSelectedAt(row, threshold),
    matches: row.variantMatches[variantIndex],
    direction: row.direction,
    threshold,
    defaultQuality: minQuality,
  });

const selectRows = (rows, predicate) => rows.filter(predicate);

const buildPeriodSummaries = ({
  rows,
  selector,
  windows,
  minTimestamp,
  maxTimestamp,
  summaryOptions,
}) => {
  const withCalendarDays = (periodRows) => ({
    ...summaryOptions,
    calendarDays: getCalendarDays(periodRows),
  });
  const result = {
    full: summarizeRows(
      selectRows(rows, selector),
      Math.max((maxTimestamp - minTimestamp) / DAY_MS, 1),
      withCalendarDays(rows),
    ),
  };
  for (const days of windows) {
    const from = maxTimestamp - days * DAY_MS;
    const periodRows = selectRows(rows, (row) => row.timestamp >= from);
    result[`${days}d`] = summarizeRows(
      selectRows(periodRows, selector),
      days,
      withCalendarDays(periodRows),
    );
  }
  return result;
};

export const splitRowsByTimestamp = (rows, validationSplit, testSplit = 0) => {
  const timestamps = [...new Set(rows.map((row) => row.timestamp))];
  if (timestamps.length < 2) {
    return { train: rows, tuning: [], test: [] };
  }
  const getSplitCount = (ratio) =>
    ratio > 0 ? Math.max(1, Math.floor(timestamps.length * ratio)) : 0;
  let testEvents = getSplitCount(testSplit);
  let tuningEvents = getSplitCount(validationSplit);
  const maximumHeldOut = timestamps.length - 1;
  if (testEvents + tuningEvents > maximumHeldOut) {
    const overflow = testEvents + tuningEvents - maximumHeldOut;
    tuningEvents = Math.max(0, tuningEvents - overflow);
  }
  if (testEvents + tuningEvents > maximumHeldOut) {
    testEvents = Math.max(0, maximumHeldOut - tuningEvents);
  }
  const testStart = timestamps.length - testEvents;
  const tuningStart = testStart - tuningEvents;
  const tuningTimestamps = new Set(timestamps.slice(tuningStart, testStart));
  const testTimestamps = new Set(timestamps.slice(testStart));
  return {
    train: rows.filter(
      (row) =>
        !tuningTimestamps.has(row.timestamp) &&
        !testTimestamps.has(row.timestamp),
    ),
    tuning: rows.filter((row) => tuningTimestamps.has(row.timestamp)),
    test: rows.filter((row) => testTimestamps.has(row.timestamp)),
  };
};

export const splitRowsByTimestampBounds = (
  rows,
  tuningSince,
  testSince,
) => {
  if (!Number.isFinite(tuningSince) || !Number.isFinite(testSince)) {
    throw new Error(
      'Exact calendar partitions require both tuningSince and testSince',
    );
  }
  if (tuningSince >= testSince) {
    throw new Error('tuningSince must be earlier than testSince');
  }
  return {
    train: rows.filter((row) => row.timestamp < tuningSince),
    tuning: rows.filter(
      (row) => row.timestamp >= tuningSince && row.timestamp < testSince,
    ),
    test: rows.filter((row) => row.timestamp >= testSince),
  };
};

const summarizeSplit = (rows, selector, summaryOptions) =>
  summarizeRows(selectRows(rows, selector), getPeriodDays(rows), {
    ...summaryOptions,
    calendarDays: getCalendarDays(rows),
  });

const summarizeDirections = (rows, selector, summaryOptions) =>
  Object.fromEntries(
    ['LONG', 'SHORT'].map((direction) => [
      direction,
      summarizeRows(
        selectRows(rows, (row) => row.direction === direction && selector(row)),
        getPeriodDays(rows),
        summaryOptions,
      ),
    ]),
  );

export const buildEquitySeries = (
  rows,
  selector,
  minTimestamp = rows[0]?.timestamp ?? null,
  maxTimestamp = rows.at(-1)?.timestamp ?? null,
) => {
  if (!Number.isFinite(minTimestamp) || !Number.isFinite(maxTimestamp)) {
    return [];
  }
  const byTimestamp = new Map();
  for (const row of rows) {
    if (!selector(row)) continue;
    byTimestamp.set(
      row.timestamp,
      (byTimestamp.get(row.timestamp) ?? 0) + row.profit,
    );
  }
  let cumulative = 0;
  const result = [[minTimestamp, 0]];
  for (const [timestamp, profit] of byTimestamp) {
    cumulative += profit;
    if (timestamp === minTimestamp) result[0] = [timestamp, cumulative];
    else result.push([timestamp, cumulative]);
  }
  if (result.at(-1)[0] !== maxTimestamp) result.push([maxTimestamp, cumulative]);
  return result;
};

const buildPeriodDirectionSummaries = ({
  rows,
  selector,
  windows,
  maxTimestamp,
  summaryOptions,
}) => {
  const result = {
    full: summarizeDirections(rows, selector, {
      ...summaryOptions,
      calendarDays: getCalendarDays(rows),
    }),
  };
  for (const days of windows) {
    const from = maxTimestamp - days * DAY_MS;
    const periodRows = selectRows(rows, (row) => row.timestamp >= from);
    result[`${days}d`] = summarizeDirections(periodRows, selector, {
      ...summaryOptions,
      calendarDays: getCalendarDays(periodRows),
    });
  }
  return result;
};

const summarizeMonths = (rows, selector, summaryOptions) => {
  const months = [
    ...new Set(
      rows.map((row) => new Date(row.timestamp).toISOString().slice(0, 7)),
    ),
  ].sort();
  return Object.fromEntries(
    months.map((month) => [
      month,
      summarizeRows(
        selectRows(
          rows,
          (row) =>
            new Date(row.timestamp).toISOString().startsWith(month) &&
            selector(row),
        ),
        30.4375,
        summaryOptions,
      ),
    ]),
  );
};

const initializeFeatureStat = () => ({
  count: 0,
  nulls: 0,
  numericCount: 0,
  min: null,
  max: null,
  categories: new Map(),
});

const updateFeatureInventory = (inventory, features, pattern) => {
  if (!pattern) return;
  for (const [feature, value] of Object.entries(features)) {
    pattern.lastIndex = 0;
    if (!pattern.test(feature)) continue;
    const stat = inventory.get(feature) ?? initializeFeatureStat();
    stat.count += 1;
    if (value == null) {
      stat.nulls += 1;
    } else if (typeof value === 'number') {
      stat.numericCount += 1;
      stat.min = stat.min == null ? value : Math.min(stat.min, value);
      stat.max = stat.max == null ? value : Math.max(stat.max, value);
    } else if (
      stat.categories.size < 50 ||
      stat.categories.has(String(value))
    ) {
      const key = String(value);
      stat.categories.set(key, (stat.categories.get(key) ?? 0) + 1);
    }
    inventory.set(feature, stat);
  }
};

const finalizeFeatureInventory = (inventory) =>
  [...inventory.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([feature, stat]) => ({
      feature,
      count: stat.count,
      nulls: stat.nulls,
      numericCount: stat.numericCount,
      min: stat.min,
      max: stat.max,
      categories: [...stat.categories.entries()]
        .sort(
          (left, right) =>
            right[1] - left[1] || left[0].localeCompare(right[0]),
        )
        .slice(0, 12)
        .map(([value, count]) => ({ value, count })),
    }));

const signalFromRow = (row) => ({
  ...row.payload.signal,
  strategy: row.payload.signal.strategy,
  figures: row.payload.figures ?? {},
  indicators: row.payload.indicators ?? {},
  additionalIndicators: row.payload.additionalIndicators ?? {},
  prices: row.payload.signal.prices,
});

const newestSourceMtime = async (sourcePath) => {
  let stat;
  try {
    stat = await fsp.stat(sourcePath);
  } catch {
    return 0;
  }
  if (stat.isFile()) {
    return /(?:\.test\.[cm]?[jt]s|\.spec\.[cm]?[jt]s)$/.test(sourcePath)
      ? 0
      : stat.mtimeMs;
  }
  if (!stat.isDirectory()) return 0;
  const entries = await fsp.readdir(sourcePath, { withFileTypes: true });
  const mtimes = await Promise.all(
    entries
      .filter((entry) => entry.name !== '__tests__')
      .map((entry) => newestSourceMtime(path.join(sourcePath, entry.name))),
  );
  return Math.max(0, ...mtimes);
};

const resolveStandaloneStrategyEntrypoint = (sourceRepositoryRoot) => {
  const packageJson = readRepositoryPackage(sourceRepositoryRoot);
  const rootExport = packageJson?.exports?.['.'];
  const relativeEntrypoint =
    (typeof rootExport === 'string'
      ? rootExport
      : rootExport?.import ?? rootExport?.default) ??
    packageJson?.module ??
    packageJson?.main;
  if (!relativeEntrypoint) {
    throw new Error(
      `Standalone strategy ${packageJson?.name ?? sourceRepositoryRoot} has no importable package entrypoint. Run yarn build first.`,
    );
  }
  const entrypoint = path.resolve(sourceRepositoryRoot, relativeEntrypoint);
  if (!entrypoint.startsWith(`${sourceRepositoryRoot}${path.sep}`)) {
    throw new Error(
      `Standalone strategy entrypoint escapes its repository: ${relativeEntrypoint}`,
    );
  }
  return { entrypoint, packageJson };
};

export const loadStandaloneStrategyEntries = async (sourceRepositoryRoot) => {
  if (getSourceRepositoryKind(sourceRepositoryRoot) !== 'strategy') {
    throw new Error(
      `Expected a standalone TradeJS strategy repository: ${sourceRepositoryRoot}`,
    );
  }
  const { entrypoint, packageJson } = resolveStandaloneStrategyEntrypoint(
    sourceRepositoryRoot,
  );
  let outputStat;
  try {
    outputStat = await fsp.stat(entrypoint);
  } catch {
    throw new Error(
      `Missing ${path.relative(sourceRepositoryRoot, entrypoint)} for ${packageJson.name}. Run yarn build in TRADEJS_SOURCE_REPOSITORY_ROOT first.`,
    );
  }
  const sourceMtime = await newestSourceMtime(
    path.join(sourceRepositoryRoot, 'src'),
  );
  if (sourceMtime > outputStat.mtimeMs) {
    throw new Error(
      `Stale ${path.relative(sourceRepositoryRoot, entrypoint)} for ${packageJson.name}. Run yarn build in TRADEJS_SOURCE_REPOSITORY_ROOT first.`,
    );
  }
  const pluginModule = await import(pathToFileURL(entrypoint).href);
  const strategyEntries =
    pluginModule.strategyEntries ?? pluginModule.default?.strategyEntries;
  if (!Array.isArray(strategyEntries) || strategyEntries.length === 0) {
    throw new Error(
      `${packageJson.name} must export a non-empty strategyEntries array from ${path.relative(sourceRepositoryRoot, entrypoint)}.`,
    );
  }
  return {
    entrypoint,
    packageName: packageJson.name,
    strategyEntries,
  };
};

export const ensureRuntimeBuild = async (frameworkRepositoryRoot) => {
  const aiModulePath = path.join(
    frameworkRepositoryRoot,
    'packages/node/dist/ai.mjs',
  );
  const registryModulePath = path.join(
    frameworkRepositoryRoot,
    'packages/node/dist/registry.mjs',
  );
  const pocketModulePath = path.join(
    frameworkRepositoryRoot,
    'packages/cli/dist/lib/aiPocketSearch.js',
  );
  const required = [aiModulePath, registryModulePath, pocketModulePath];
  for (const filePath of required) {
    try {
      await fsp.access(filePath);
    } catch {
      throw new Error(
        `Missing ${path.relative(frameworkRepositoryRoot, filePath)}. Build the framework runtime in TRADEJS_FRAMEWORK_REPOSITORY_ROOT first.`,
      );
    }
  }

  const freshnessChecks = [
    {
      output: aiModulePath,
      sources: [
        path.join(frameworkRepositoryRoot, 'packages/node/src/ai.ts'),
        path.join(frameworkRepositoryRoot, 'packages/node/src/aiMarketContext.ts'),
        path.join(frameworkRepositoryRoot, 'packages/node/src/aiShared.ts'),
        path.join(frameworkRepositoryRoot, 'packages/node/src/strategyAdapters'),
      ],
      command: 'yarn workspace @tradejs/node build',
    },
    {
      output: registryModulePath,
      sources: [
        path.join(frameworkRepositoryRoot, 'packages/node/src/strategy'),
      ],
      command: 'yarn workspace @tradejs/node build',
    },
    {
      output: pocketModulePath,
      sources: [
        path.join(
          frameworkRepositoryRoot,
          'packages/cli/src/lib/aiPocketSearch.ts',
        ),
      ],
      command: 'yarn workspace @tradejs/cli build',
    },
  ];
  for (const check of freshnessChecks) {
    const [outputStat, ...sourceMtimes] = await Promise.all([
      fsp.stat(check.output),
      ...check.sources.map(newestSourceMtime),
    ]);
    if (Math.max(0, ...sourceMtimes) > outputStat.mtimeMs) {
      throw new Error(
        `Stale ${path.relative(frameworkRepositoryRoot, check.output)} for current sources. Run ${check.command} in TRADEJS_FRAMEWORK_REPOSITORY_ROOT.`,
      );
    }
  }
  return { aiModulePath, registryModulePath, pocketModulePath };
};

const loadResearchRows = async ({
  projectRoot,
  sourceRepositoryRoot,
  frameworkRepositoryRoot,
  filePaths,
  variants,
  minQuality,
  includeGateContext,
  featurePattern,
}) => {
  const { aiModulePath, registryModulePath, pocketModulePath } =
    await ensureRuntimeBuild(frameworkRepositoryRoot);
  const aiModule = await import(pathToFileURL(aiModulePath).href);
  const registryModule = await import(pathToFileURL(registryModulePath).href);
  const require = createRequire(import.meta.url);
  const { collectAiPocketFeatures } = require(pocketModulePath);
  if (getSourceRepositoryKind(sourceRepositoryRoot) === 'strategy') {
    const { strategyEntries } = await loadStandaloneStrategyEntries(
      sourceRepositoryRoot,
    );
    registryModule.resetStrategyRegistryCache(projectRoot);
    registryModule.registerStrategyEntries(strategyEntries, projectRoot);
  } else {
    await registryModule.ensureStrategyPluginsLoaded(projectRoot);
  }

  const rows = [];
  const featureInventory = new Map();
  let sequence = 0;
  let failed = 0;
  for (const filePath of filePaths) {
    const reader = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });
    for await (const line of reader) {
      if (!line.trim()) continue;
      const source = JSON.parse(line);
      try {
        const signal = signalFromRow(source);
        const payload = aiModule.buildAiPayload(signal);
        const gateContext = aiModule.getDeterministicAiGateContext(payload);
        const analysis = await aiModule.runAiPromptLocal(signal, { payload });
        const features = collectAiPocketFeatures({
          payload,
          gateContext,
          includeGateContext,
          featureProfile: 'all',
        });
        features['derived.direction'] = String(source.direction).toUpperCase();
        updateFeatureInventory(featureInventory, features, featurePattern);
        const timestamp = Number(source.timestamp);
        const profit = Number(source.profit);
        const qualityValue = Number(analysis.quality);
        const quality = Number.isFinite(qualityValue)
          ? Math.round(qualityValue)
          : null;
        const finiteOrNull = (value) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : null;
        };
        const rawContext = payload.additionalIndicators?.baseContext?.raw ?? {};
        rows.push({
          sequence,
          signalId: source.signalId,
          timestamp: Number.isFinite(timestamp) ? timestamp : null,
          symbol: source.symbol,
          direction: source.direction,
          profit: Number.isFinite(profit) ? profit : 0,
          quality,
          directionMatches: analysis.direction === source.direction,
          baselineApproved:
            analysis.direction === source.direction &&
            quality != null &&
            quality >= minQuality,
          movingAverageSource: {
            provider: String(source.connectorName ?? '')
              .trim()
              .toLowerCase(),
            interval: finiteOrNull(payload.signal?.interval),
            currentPrice: finiteOrNull(payload.signal?.prices?.currentPrice),
            atr: finiteOrNull(rawContext.volatility?.atr),
            existingSma: {
              14: finiteOrNull(rawContext.trend?.maFast),
              49: finiteOrNull(rawContext.trend?.maMedium),
              50: finiteOrNull(rawContext.trend?.maSlow),
            },
          },
          variantMatches: variants.map((variant) =>
            evaluateRule(variant.rule, features),
          ),
        });
      } catch (error) {
        failed += 1;
        if (failed <= 5) {
          console.error(
            `row error ${source.symbol}/${source.signalId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      sequence += 1;
      if (sequence % 2500 === 0) {
        console.error(`evaluated ${sequence} rows`);
      }
    }
  }
  rows.sort(
    (left, right) =>
      (left.timestamp ?? Number.POSITIVE_INFINITY) -
        (right.timestamp ?? Number.POSITIVE_INFINITY) ||
      left.sequence - right.sequence,
  );
  if (rows.some((row) => row.timestamp == null)) {
    throw new Error('At least one evaluated row has no finite timestamp');
  }
  return {
    rows,
    failed,
    featureInventory: finalizeFeatureInventory(featureInventory),
  };
};

const MOVING_AVERAGE_FAMILIES = ['SMA', 'EMA', 'WMA'];
const MOVING_AVERAGE_SLOPE_BARS = 5;

const buildMovingAverageSql = () => {
  return `
    SELECT candle.symbol,
           extract(epoch from candle.ts) * 1000 AS timestamp_ms,
           candle.close::double precision AS close
    FROM candles candle
    WHERE candle.provider = $1
      AND candle.interval = $2
      AND candle.symbol = ANY($3::text[])
      AND candle.ts >= to_timestamp($4::bigint / 1000.0)
      AND candle.ts <= to_timestamp($5::bigint / 1000.0)
    ORDER BY candle.symbol ASC, candle.ts ASC
  `;
};

const movingAverageConnectionConfig = () => ({
  host: process.env.PG_HOST || '127.0.0.1',
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER || 'app',
  password: String(process.env.PG_PASSWORD ?? 'app'),
  database: process.env.PG_DATABASE || process.env.PG_DB || 'app',
  application_name: 'tradejs-ai-gate-ma-study',
});

const finiteArray = (value) =>
  Array.isArray(value)
    ? value.map((item) => {
        if (item == null) return null;
        const parsed = Number(item);
        return Number.isFinite(parsed) ? parsed : null;
      })
    : [];

const sumRange = (prefix, start, length) =>
  prefix[start + length] - prefix[start];

const lastIndexAtOrBefore = (candles, timestamp) => {
  let low = 0;
  let high = candles.length - 1;
  let answer = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].timestamp <= timestamp) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
};

export const calculateMovingAverageGrid = ({
  closes,
  periods,
  lookbackBars,
  slopeBars = MOVING_AVERAGE_SLOPE_BARS,
}) => {
  const values = finiteArray(closes);
  const prefix = [0];
  const weightedPrefix = [0];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    prefix.push(prefix[index] + value);
    weightedPrefix.push(weightedPrefix[index] + value * (index + 1));
  }
  const smaAt = (start, period) =>
    start + period <= values.length
      ? sumRange(prefix, start, period) / period
      : null;
  const wmaAt = (start, period) => {
    if (start + period > values.length) return null;
    const sum = sumRange(prefix, start, period);
    const globalWeighted = sumRange(weightedPrefix, start, period);
    const localWeighted = globalWeighted - start * sum;
    return ((period + 1) * sum - localWeighted) / ((period * (period + 1)) / 2);
  };
  const emaAt = (start, period) => {
    const count = Math.min(lookbackBars, values.length - start);
    if (count < period) return null;
    const decay = 1 - 2 / (period + 1);
    let weighted = 0;
    let weightTotal = 0;
    let weight = 1;
    for (let index = 0; index < count; index += 1) {
      weighted += values[start + index] * weight;
      weightTotal += weight;
      weight *= decay;
    }
    return weightTotal > 0 ? weighted / weightTotal : null;
  };
  return {
    SMA: Object.fromEntries(
      periods.map((period) => [
        period,
        { value: smaAt(0, period), previous5: smaAt(slopeBars, period) },
      ]),
    ),
    EMA: Object.fromEntries(
      periods.map((period) => [
        period,
        { value: emaAt(0, period), previous5: emaAt(slopeBars, period) },
      ]),
    ),
    WMA: Object.fromEntries(
      periods.map((period) => [
        period,
        { value: wmaAt(0, period), previous5: wmaAt(slopeBars, period) },
      ]),
    ),
  };
};

export const buildMovingAverageVariants = (periods) =>
  MOVING_AVERAGE_FAMILIES.flatMap((family) =>
    periods.flatMap((period) => {
      const feature = `derived.movingAverage.${family}.${period}`;
      return [
        {
          name: `${family}${period}-side`,
          mode: 'filter',
          quality: null,
          expression: `${feature}.directionalDistanceAtr >= 0`,
          match: (row) =>
            row.movingAverages?.[family]?.[period]?.directionalDistanceAtr >= 0,
        },
        {
          name: `${family}${period}-side-slope`,
          mode: 'filter',
          quality: null,
          expression: `${feature}.directionalDistanceAtr >= 0 && ${feature}.directionalSlopeAtr5 >= 0`,
          match: (row) => {
            const value = row.movingAverages?.[family]?.[period];
            return (
              value?.directionalDistanceAtr >= 0 &&
              value?.directionalSlopeAtr5 >= 0
            );
          },
        },
        {
          name: `${family}${period}-standalone`,
          mode: 'replace',
          quality: null,
          expression: `${feature}.directionalDistanceAtr >= 0 && ${feature}.directionalSlopeAtr5 >= 0`,
          match: (row) => {
            const value = row.movingAverages?.[family]?.[period];
            return (
              value?.directionalDistanceAtr >= 0 &&
              value?.directionalSlopeAtr5 >= 0
            );
          },
        },
      ];
    }),
  );

const relativeError = (actual, expected) =>
  actual == null || expected == null
    ? null
    : Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12);

const percentileValue = (values, percentile) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * percentile) - 1),
    )
  ];
};

const pearsonCorrelation = (left, right) => {
  const pairs = left
    .map((value, index) => [value, right[index]])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pairs.length < 2) return null;
  const leftMean =
    pairs.reduce((sum, [value]) => sum + value, 0) / pairs.length;
  const rightMean =
    pairs.reduce((sum, [, value]) => sum + value, 0) / pairs.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (const [leftValue, rightValue] of pairs) {
    const leftDiff = leftValue - leftMean;
    const rightDiff = rightValue - rightMean;
    covariance += leftDiff * rightDiff;
    leftVariance += leftDiff * leftDiff;
    rightVariance += rightDiff * rightDiff;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? covariance / denominator : null;
};

const summarizeCorrelations = (values) => ({
  pairs: values.filter(Number.isFinite).length,
  min: values.filter(Number.isFinite).length
    ? Math.min(...values.filter(Number.isFinite))
    : null,
  median: percentileValue(values, 0.5),
  p95: percentileValue(values, 0.95),
});

export const summarizeMovingAverageRedundancy = (rows, periods) => {
  const series = (family, period, field = 'directionalDistanceAtr') =>
    rows.map((row) => row.movingAverages?.[family]?.[period]?.[field] ?? null);
  const adjacent = [];
  for (const family of MOVING_AVERAGE_FAMILIES) {
    for (let index = 1; index < periods.length; index += 1) {
      adjacent.push(
        pearsonCorrelation(
          series(family, periods[index - 1]),
          series(family, periods[index]),
        ),
      );
    }
  }
  const crossFamily = [];
  for (const period of periods) {
    crossFamily.push(
      pearsonCorrelation(series('SMA', period), series('EMA', period)),
      pearsonCorrelation(series('SMA', period), series('WMA', period)),
      pearsonCorrelation(series('EMA', period), series('WMA', period)),
    );
  }
  return {
    adjacentPeriods: summarizeCorrelations(adjacent),
    samePeriodAcrossFamilies: summarizeCorrelations(crossFamily),
  };
};

export const loadMovingAverageStudyFeatures = async ({
  projectRoot,
  rows,
  periods,
  lookbackBars,
  batchSize,
  sqlTimeoutMs,
}) => {
  const sources = new Set(
    rows.map(
      (row) =>
        `${row.movingAverageSource?.provider}:${row.movingAverageSource?.interval}`,
    ),
  );
  if (sources.size !== 1) {
    throw new Error(
      `Moving-average study requires one provider/interval, got: ${[...sources].join(', ')}`,
    );
  }
  const sample = rows[0].movingAverageSource;
  if (!sample?.provider || !Number.isFinite(sample.interval)) {
    throw new Error('Moving-average study source provider/interval is missing');
  }
  const maxPeriod = Math.max(...periods);
  if (lookbackBars < maxPeriod + MOVING_AVERAGE_SLOPE_BARS) {
    throw new Error(
      `--maLookbackBars must be at least ${maxPeriod + MOVING_AVERAGE_SLOPE_BARS}`,
    );
  }
  const require = createRequire(import.meta.url);
  const { Client } = require('pg');
  const client = new Client(movingAverageConnectionConfig());
  const query = buildMovingAverageSql();
  const limit = lookbackBars + MOVING_AVERAGE_SLOPE_BARS;
  const lookbackMs = limit * sample.interval * 60_000;
  const parityErrors = { 14: [], 49: [], 50: [] };
  let covered = 0;
  let insufficientBars = 0;
  const attachMovingAverages = (row, closes) => {
    const bars = closes.length;
    if (bars < maxPeriod + MOVING_AVERAGE_SLOPE_BARS) {
      insufficientBars += 1;
      return;
    }
    const currentPrice = row.movingAverageSource.currentPrice;
    const atr = row.movingAverageSource.atr;
    if (!Number.isFinite(currentPrice) || !Number.isFinite(atr) || atr <= 0) {
      return;
    }
    const calculated = calculateMovingAverageGrid({
      closes,
      periods: [...new Set([...periods, 14, 49, 50])],
      lookbackBars,
    });
    const directionSign = row.direction === 'SHORT' ? -1 : 1;
    row.movingAverages = Object.fromEntries(
      MOVING_AVERAGE_FAMILIES.map((family) => [
        family,
        Object.fromEntries(
          periods.map((period) => {
            const value = calculated[family][period].value;
            const prior = calculated[family][period].previous5;
            return [
              period,
              {
                value,
                previous5: prior,
                directionalDistanceAtr:
                  value == null
                    ? null
                    : (directionSign * (currentPrice - value)) / atr,
                directionalSlopeAtr5:
                  value == null || prior == null
                    ? null
                    : (directionSign * (value - prior)) / atr,
              },
            ];
          }),
        ),
      ]),
    );
    [14, 49, 50].forEach((period) => {
      const error = relativeError(
        calculated.SMA[period].value,
        row.movingAverageSource.existingSma[period],
      );
      if (error != null) parityErrors[period].push(error);
    });
    covered += 1;
  };
  await client.connect();
  try {
    await client.query(`SET statement_timeout = ${Math.trunc(sqlTimeoutMs)}`);
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const symbols = [...new Set(batch.map((row) => row.symbol))];
      const fromTimestamp = batch[0].timestamp - lookbackMs;
      const toTimestamp = batch.at(-1).timestamp;
      const result = await client.query(query, [
        sample.provider,
        sample.interval,
        symbols,
        fromTimestamp,
        toTimestamp,
      ]);
      const candlesBySymbol = new Map();
      for (const resultRow of result.rows) {
        const symbol = String(resultRow.symbol);
        const candles = candlesBySymbol.get(symbol) ?? [];
        const timestamp = Number(resultRow.timestamp_ms);
        const close = Number(resultRow.close);
        if (Number.isFinite(timestamp) && Number.isFinite(close)) {
          candles.push({ timestamp, close });
          candlesBySymbol.set(symbol, candles);
        }
      }
      for (const row of batch) {
        const candles = candlesBySymbol.get(row.symbol) ?? [];
        const currentIndex = lastIndexAtOrBefore(candles, row.timestamp);
        if (currentIndex < 0) {
          insufficientBars += 1;
          continue;
        }
        const firstIndex = Math.max(0, currentIndex - limit + 1);
        const closes = [];
        for (let index = currentIndex; index >= firstIndex; index -= 1) {
          closes.push(candles[index].close);
        }
        attachMovingAverages(row, closes);
      }
      console.error(
        `moving-average candles ${Math.min(start + batch.length, rows.length)}/${rows.length}`,
      );
    }
  } finally {
    await client.end();
  }
  return {
    provider: sample.provider,
    interval: sample.interval,
    rows: rows.length,
    covered,
    coverage: covered / Math.max(1, rows.length),
    insufficientBars,
    periods,
    lookbackBars,
    emaResidualAtMaxPeriod: Math.pow(1 - 2 / (maxPeriod + 1), lookbackBars),
    parity: Object.fromEntries(
      [14, 49, 50].map((period) => [
        period,
        {
          samples: parityErrors[period].length,
          medianRelativeError: percentileValue(parityErrors[period], 0.5),
          p95RelativeError: percentileValue(parityErrors[period], 0.95),
          maxRelativeError: parityErrors[period].length
            ? Math.max(...parityErrors[period])
            : null,
        },
      ]),
    ),
    projectRoot,
  };
};

export const summarizeMovingAverageStudy = ({
  rows,
  periods,
  variants,
  report,
  coverage,
}) => {
  const ranked = report.variants
    .map((variantReport, index) => ({
      index,
      name: variantReport.name,
      mode: variantReport.mode,
      expression: variantReport.expression,
      train: variantReport.train,
      tuning: variantReport.tuning,
      test: variantReport.test,
      full: variantReport.periods.full,
      terminal30d: variantReport.periods['30d'],
      terminal7d: variantReport.periods['7d'],
    }))
    .filter(
      (candidate) =>
        candidate.train.events >= 25 && candidate.tuning.events >= 25,
    )
    .sort((left, right) => {
      const leftPf = left.tuning.profitFactor ?? Number.NEGATIVE_INFINITY;
      const rightPf = right.tuning.profitFactor ?? Number.NEGATIVE_INFINITY;
      return (
        rightPf - leftPf ||
        right.tuning.totalProfit - left.tuning.totalProfit ||
        right.tuning.events - left.tuning.events
      );
    });
  return {
    coverage,
    redundancy: summarizeMovingAverageRedundancy(rows, periods),
    variants: variants.length,
    eligibleVariants: ranked.length,
    topTuningCandidates: ranked.slice(0, 20),
  };
};

const CROSS_BASE_PREFIX = 'additionalIndicators.baseContext.';
const CROSS_BASE_SECTIONS = new Set([
  'derivatives',
  'gateFeatures',
  'mtf',
  'participation',
  'raw',
  'regime',
  'relative',
  'structure',
]);
const CROSS_DERIVED_FEATURES = new Set([
  'derived.maFastAligned',
  'derived.maSlowAligned',
  'derived.maStackAligned',
  'derived.macdHistogramAligned',
  'derived.macdHistogramSlopeAligned',
  'derived.obvSlopeAligned',
  'derived.obvTrendAligned',
  'derived.priceMaFastDistanceBps',
  'derived.priceMaSlowDistanceBps',
  'derived.stopDistanceBps',
  'derived.takeProfitDistanceBps',
]);
const CROSS_DATA_QUALITY_LEAVES = new Set([
  'available',
  'availablecount',
  'agems',
  'asofts',
  'coverage',
  'coveragecount',
  'coveragepct',
  'coverageratio',
  'coveragesufficient',
  'coveredcount',
  'coveredwhales',
  'expectedcount',
  'expectedwhales',
  'intervalcount',
  'latestindex',
  'length',
  'loadedcount',
  'points',
  'present',
  'rowcount',
  'rows',
  'shardcount',
  'sourcecount',
  'stale',
  'symbolscount',
  'timestamp',
  'windowendts',
]);
const CROSS_METADATA_LEAVES = new Set([
  'compact',
  'interval',
  'primaryreferencesymbol',
  'provider',
  'referencesymbol',
  'secondaryreferencesymbol',
  'source',
  'sourcesymbol',
  'symbol',
  'targetsymbol',
  'universe',
  'universefingerprint',
  'whaleregistryfingerprint',
]);
const CROSS_RAW_VALUE_LEAVES = new Set([
  'atr',
  'atrslope',
  'baseline',
  'bbbasis',
  'bblower',
  'bbmiddle',
  'bbupper',
  'bottom',
  'buybasevolume',
  'buyquotevolume',
  'buyvolume',
  'centerline',
  'centerlineslope',
  'close',
  'current',
  'currentprice',
  'deltaslope',
  'emafilter',
  'fastma',
  'floor',
  'high',
  'highlevel',
  'highprice1h',
  'highprice24h',
  'last',
  'lastpivothigh',
  'lastpivotlow',
  'lastprice',
  'lastswinghigh',
  'lastswinglow',
  'level',
  'liqlong',
  'liqshort',
  'liqtotal',
  'low',
  'lower',
  'lowerboundary',
  'lowlevel',
  'lowprice1h',
  'lowprice24h',
  'mafast',
  'mamedium',
  'maslow',
  'macd',
  'macdhistogram',
  'macdhistogramslope',
  'macdsignal',
  'mid',
  'netbasedelta',
  'open',
  'openinterest',
  'netdelta',
  'netquotedelta',
  'obv',
  'obvslope',
  'obvsma',
  'pointofcontrol',
  'pocindex',
  'prevclose',
  'price',
  'roof',
  'sellbasevolume',
  'sellquotevolume',
  'sellvolume',
  'signedvolume',
  'slowma',
  'stepusd',
  'top',
  'totalmarketcapusd',
  'trailstop',
  'turnover',
  'upper',
  'upperboundary',
  'volume',
  'volume1h',
  'volume24h',
  'volumetrendslope',
]);
const CROSS_RAW_ACTIVITY_COUNT_LEAVES = new Set([
  'activecryptocurrencies',
  'activeexchanges',
  'activemarketpairs',
  'advancers',
  'decliners',
  'exchangescount',
  'positionawarewhalesides',
  'trades',
  'unchanged',
  'uniquewhales',
  'whalesides',
]);
const CROSS_SEARCH_PROFILE_NAMES = ['universal', 'benchmarkReference'];
const CROSS_AUDIT_PROFILE_NAMES = [
  'dataQuality',
  'rawNonstationary',
  'derivedPolicy',
  'metadata',
];
const CROSS_OUTCOME_SEGMENTS = new Set([
  'actual',
  'aiapproved',
  'approvalallowednow',
  'backtestexecution',
  'closedat',
  'closedpnl',
  'deterministicquality',
  'entrydelaybars',
  'entrydelaymovebps',
  'executionprice',
  'exitprice',
  'exitreason',
  'exittimestamp',
  'fillprice',
  'future',
  'futuremove',
  'futureprofit',
  'hardblockreasons',
  'label',
  'maxallowedquality',
  'maxquality',
  'modeldirection',
  'modeldirectionmatches',
  'outcome',
  'pnl',
  'profit',
  'profitabletrade',
  'quality',
  'rawaiapproved',
  'rejectreason',
  'result',
  'traderesult',
]);

const inferCrossFeatureScope = (feature) => {
  const normalized = feature.toLowerCase();
  if (normalized.startsWith('derived.')) return 'target-setup';
  if (normalized.includes('.derivatives.targetcontext.')) return 'target';
  if (normalized.includes('.derivatives.targetderived.')) {
    return /referencepressure|referencedirectionaligned/.test(normalized)
      ? 'benchmark'
      : 'target-vs-benchmark';
  }
  if (
    /\.relative\.(?:cmc|marketbreadth|marketbreadths|btcaltregime)/.test(
      normalized,
    ) ||
    /\.gatefeatures\.relative\.(?:cmc|marketbreadth|btcaltregime)/.test(
      normalized,
    )
  ) {
    return 'global';
  }
  if (
    normalized.includes('.derivatives.') ||
    normalized.includes('.relative.referencetradeflow.') ||
    normalized.includes('.relative.referencepsychologicallevels.') ||
    normalized.includes('.relative.execution.') ||
    normalized.includes('.gatefeatures.execution.') ||
    normalized.includes('.participation.referencetradeflow')
  ) {
    return 'benchmark';
  }
  if (/targetvsbtc|targetvseth|relativestrength/.test(normalized)) {
    return 'target-vs-benchmark';
  }
  return 'target-setup';
};

const crossRawTransform = (feature) => {
  const normalized = feature.toLowerCase();
  if (/openinterest/.test(normalized))
    return 'pct-change / acceleration / z-score';
  if (/liq(?:long|short|total)/.test(normalized))
    return 'imbalance / spike ratio';
  if (/marketcap|volumeusd|reportedusd/.test(normalized)) {
    return 'change / dominance / share / ratio';
  }
  if (/notionalusd/.test(normalized)) return 'turnover ratio / rolling z-score';
  if (/volume|delta|obv/.test(normalized))
    return 'relative share / z-score / direction';
  if (
    /price|level|pointofcontrol|boundary|trailstop|pivot|swing/.test(normalized)
  ) {
    return 'BPS / ATR distance / return / range position';
  }
  if (/cmc(?:20|100)value/.test(normalized))
    return 'index change / relative ratio';
  return 'causal normalized sibling computed from full signal-time history';
};

const isCrossRawNonstationary = (normalizedSegments) => {
  const section = normalizedSegments[0];
  const leaf = normalizedSegments.at(-1) ?? '';
  if (section === 'raw') {
    return ![
      'atrpct',
      'bbwidthpct',
      'btccorrelation',
      'price1hpct',
      'price24hpct',
    ].includes(leaf);
  }
  return (
    CROSS_RAW_VALUE_LEAVES.has(leaf) ||
    CROSS_RAW_ACTIVITY_COUNT_LEAVES.has(leaf) ||
    leaf.endsWith('marketcapusd') ||
    leaf.endsWith('notionalusd') ||
    leaf.endsWith('openinterestusd') ||
    leaf.endsWith('reportedusd') ||
    leaf.endsWith('volumeusd') ||
    (normalizedSegments.includes('psar') && leaf === 'value') ||
    (normalizedSegments.includes('cmcindexes') && leaf.endsWith('value')) ||
    (leaf.endsWith('price') &&
      !leaf.endsWith('pricechange') &&
      !leaf.endsWith('pricechangepct'))
  );
};

export const classifyCrossStrategyFeature = (feature) => {
  if (CROSS_DERIVED_FEATURES.has(feature)) {
    return {
      profile: 'universal',
      scope: 'target-setup',
      role: 'normalized-derived',
      searchable: true,
      reason: 'directional or BPS-normalized signal-time derivative',
    };
  }
  if (!feature.startsWith(CROSS_BASE_PREFIX)) return null;
  const relativePath = feature.slice(CROSS_BASE_PREFIX.length);
  const segments = relativePath.split('.');
  if (!CROSS_BASE_SECTIONS.has(segments[0])) return null;
  const normalizedSegments = segments.map((segment) => segment.toLowerCase());
  const normalizedPath = normalizedSegments.join('.');
  const leaf = normalizedSegments.at(-1) ?? '';
  const scope = inferCrossFeatureScope(feature);

  if (
    CROSS_DATA_QUALITY_LEAVES.has(leaf) ||
    leaf.endsWith('stale') ||
    leaf.endsWith('coveragepct') ||
    leaf.endsWith('coveragesufficient') ||
    leaf.endsWith('coveredcount') ||
    leaf.endsWith('expectedcount') ||
    leaf === 'calcbars'
  ) {
    return {
      profile: 'dataQuality',
      scope,
      role: 'eligibility-guard',
      searchable: false,
      reason: 'freshness, coverage, or calculation-history evidence',
    };
  }
  if (
    CROSS_METADATA_LEAVES.has(leaf) ||
    leaf.endsWith('symbol') ||
    normalizedPath === 'gatefeatures.direction'
  ) {
    return {
      profile: 'metadata',
      scope,
      role: 'lineage-metadata',
      searchable: false,
      reason: 'provider, symbol, interval, universe, or stratifier metadata',
    };
  }
  if (isCrossRawNonstationary(normalizedSegments)) {
    return {
      profile: 'rawNonstationary',
      scope,
      role: 'transform-source',
      searchable: false,
      reason:
        'causal but raw, scale-dependent, or slowly drifting absolute value',
      transform: crossRawTransform(feature),
    };
  }
  if (
    normalizedSegments[0] === 'gatefeatures' &&
    ['scores', 'risk', 'decisionhints', 'confirmations', 'conflicts'].includes(
      normalizedSegments[1],
    )
  ) {
    return {
      profile: 'derivedPolicy',
      scope: 'mixed',
      role: 'existing-policy-composite',
      searchable: false,
      reason: 'hard-coded composite can rediscover the current heuristic',
    };
  }

  let profile = 'universal';
  if (normalizedSegments[0] === 'derivatives') {
    profile =
      normalizedSegments[1] === 'targetcontext' ||
      (normalizedSegments[1] === 'targetderived' &&
        !['referencepressure', 'referencedirectionaligned'].includes(leaf))
        ? 'universal'
        : 'benchmarkReference';
  } else if (normalizedSegments[0] === 'relative') {
    profile =
      normalizedSegments[1]?.startsWith('targetvs') ||
      (normalizedSegments[1] === 'benchmark' &&
        /relativestrength|trendalignment/.test(leaf))
        ? 'universal'
        : 'benchmarkReference';
  } else if (normalizedSegments[0] === 'gatefeatures') {
    if (
      normalizedSegments[1] === 'execution' ||
      (normalizedSegments[1] === 'participation' &&
        normalizedSegments[2]?.startsWith('referencetradeflow')) ||
      (normalizedSegments[1] === 'relative' &&
        !/targetvsbtc|targetvseth|relativestrength/.test(normalizedPath))
    ) {
      profile = 'benchmarkReference';
    }
  }
  return {
    profile,
    scope:
      profile === 'benchmarkReference' && scope === 'target-setup'
        ? 'benchmark'
        : scope,
    role:
      profile === 'universal'
        ? 'normalized-target-setup'
        : 'normalized-benchmark-reference',
    searchable: true,
    reason:
      profile === 'universal'
        ? 'portable target/setup market state'
        : 'portable benchmark, reference, or global market state',
  };
};

const CROSS_MISSING_VALUE =
  /^(?:missing(?:[_ -].*)?|n\/a|stale|unavailable|unknown)$/i;

const isCrossSearchValue = (value) =>
  value != null &&
  (typeof value !== 'string' || !CROSS_MISSING_VALUE.test(value.trim()));

const isCrossFeatureFresh = (features, feature) => {
  const segments = feature.split('.');
  for (let length = segments.length - 1; length >= 3; length -= 1) {
    const prefix = segments.slice(0, length).join('.');
    if (features[`${prefix}.stale`] === true) return false;
    if (features[`${prefix}.available`] === false) return false;
    if (features[`${prefix}.coverageSufficient`] === false) return false;
  }
  const gatePrefix = `${CROSS_BASE_PREFIX}gateFeatures`;
  const normalized = feature.toLowerCase();
  const namedGuards = [
    ['cmcaltliquidity', `${gatePrefix}.relative.cmcAltLiquidityStale`],
    ['cmcethbtc', `${gatePrefix}.relative.cmcEthBtcStale`],
    [
      'cmcexchangeliquidity',
      `${gatePrefix}.relative.cmcExchangeLiquidityStale`,
    ],
    ['cmcfeargreed', `${gatePrefix}.relative.cmcFearGreedStale`],
    ['cmcindex', `${gatePrefix}.relative.cmcIndexStale`],
    ['marketbreadth', `${gatePrefix}.relative.marketBreadthStale`],
    ['btcaltregime', `${gatePrefix}.relative.btcAltRegimeStale`],
  ];
  return !namedGuards.some(
    ([needle, guard]) =>
      normalized.includes(needle) && features[guard] === true,
  );
};

export const partitionCrossStrategyFeatures = (features) => {
  const profiles = Object.fromEntries(
    [...CROSS_SEARCH_PROFILE_NAMES, ...CROSS_AUDIT_PROFILE_NAMES].map(
      (profile) => [profile, {}],
    ),
  );
  for (const [feature, value] of Object.entries(features)) {
    const classification = classifyCrossStrategyFeature(feature);
    if (!classification) continue;
    if (classification.searchable) {
      if (
        !isCrossSearchValue(value) ||
        !isCrossFeatureFresh(features, feature)
      ) {
        continue;
      }
    }
    profiles[classification.profile][feature] = value;
  }
  return profiles;
};

export const filterSharedCrossStrategyFeatures = (features) => {
  const profiles = partitionCrossStrategyFeatures(features);
  return { ...profiles.universal, ...profiles.benchmarkReference };
};

const flattenCrossFeatureBranch = ({ output, value, segments }) => {
  if (
    segments.length > 10 ||
    segments.some((segment) =>
      CROSS_OUTCOME_SEGMENTS.has(segment.toLowerCase()),
    ) ||
    Array.isArray(value)
  ) {
    return;
  }
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    output[segments.join('.')] = value;
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (!key || key.startsWith('_')) continue;
    flattenCrossFeatureBranch({
      output,
      value: child,
      segments: [...segments, key],
    });
  }
};

export const collectSavedCrossStrategyFeatures = (payload) => {
  const output = {};
  const baseContext = payload?.additionalIndicators?.baseContext;
  if (!baseContext || typeof baseContext !== 'object') return output;
  for (const section of CROSS_BASE_SECTIONS) {
    if (!(section in baseContext)) continue;
    flattenCrossFeatureBranch({
      output,
      value: baseContext[section],
      segments: ['additionalIndicators', 'baseContext', section],
    });
  }

  const signal = payload.signal ?? {};
  const finiteNumber = (value) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const currentPrice = finiteNumber(signal.prices?.currentPrice);
  const stopLossPrice = finiteNumber(signal.prices?.stopLossPrice);
  const takeProfitPrice = finiteNumber(signal.prices?.takeProfitPrice);
  const direction = String(signal.direction ?? '').toUpperCase();
  const directionSign =
    direction === 'LONG' ? 1 : direction === 'SHORT' ? -1 : 0;
  if (currentPrice != null && currentPrice !== 0) {
    if (stopLossPrice != null) {
      output['derived.stopDistanceBps'] =
        (Math.abs(currentPrice - stopLossPrice) / Math.abs(currentPrice)) *
        10_000;
    }
    if (takeProfitPrice != null) {
      output['derived.takeProfitDistanceBps'] =
        (Math.abs(takeProfitPrice - currentPrice) / Math.abs(currentPrice)) *
        10_000;
    }
    const maFast = finiteNumber(baseContext.raw?.trend?.maFast);
    const maSlow = finiteNumber(baseContext.raw?.trend?.maSlow);
    if (directionSign && maFast != null) {
      const distance =
        ((currentPrice - maFast) / Math.abs(currentPrice)) *
        10_000 *
        directionSign;
      output['derived.maFastAligned'] = distance >= 0;
      output['derived.priceMaFastDistanceBps'] = distance;
    }
    if (directionSign && maSlow != null) {
      const distance =
        ((currentPrice - maSlow) / Math.abs(currentPrice)) *
        10_000 *
        directionSign;
      output['derived.maSlowAligned'] = distance >= 0;
      output['derived.priceMaSlowDistanceBps'] = distance;
    }
    if (directionSign && maFast != null && maSlow != null) {
      output['derived.maStackAligned'] = (maFast - maSlow) * directionSign >= 0;
    }
  }
  const macdHistogram = finiteNumber(baseContext.raw?.momentum?.macdHistogram);
  if (directionSign && macdHistogram != null) {
    output['derived.macdHistogramAligned'] = macdHistogram * directionSign >= 0;
  }
  const macdHistogramSlope = finiteNumber(
    baseContext.regime?.momentum?.macdHistogramSlope,
  );
  if (directionSign && macdHistogramSlope != null) {
    output['derived.macdHistogramSlopeAligned'] =
      macdHistogramSlope * directionSign >= 0;
  }
  const obvSlope = finiteNumber(baseContext.participation?.volume?.obvSlope);
  if (directionSign && obvSlope != null) {
    output['derived.obvSlopeAligned'] = obvSlope * directionSign >= 0;
  }
  return output;
};

const readFirstNonEmptyLine = async (filePath) => {
  const input = fs.createReadStream(filePath);
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (line.trim()) return line;
    }
  } finally {
    reader.close();
    input.destroy();
  }
  return null;
};

const readLastNonEmptyLine = async (filePath) => {
  const handle = await fsp.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const chunkSize = 64 * 1024;
    let position = size;
    let suffix = '';
    while (position > 0) {
      const bytes = Math.min(chunkSize, position);
      position -= bytes;
      const buffer = Buffer.allocUnsafe(bytes);
      await handle.read(buffer, 0, bytes, position);
      suffix = `${buffer.toString('utf8')}${suffix}`;
      const lines = suffix.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length >= 2 || position === 0) return lines.at(-1) ?? null;
    }
    return null;
  } finally {
    await handle.close();
  }
};

const readTimestampBoundary = async (filePath, readLine) => {
  const line = await readLine(filePath);
  if (!line) throw new Error(`Empty export shard: ${filePath}`);
  const timestamp = Number(JSON.parse(line).timestamp);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`No finite timestamp at boundary of ${filePath}`);
  }
  return timestamp;
};

const getCrossDatasetRanges = async (groups) => {
  const ranges = [];
  for (const group of groups) {
    const firstTimestamps = [];
    const lastTimestamps = [];
    for (const filePath of group.files) {
      firstTimestamps.push(
        await readTimestampBoundary(filePath, readFirstNonEmptyLine),
      );
      lastTimestamps.push(
        await readTimestampBoundary(filePath, readLastNonEmptyLine),
      );
    }
    ranges.push({
      strategy: group.strategyToken,
      minTimestamp: Math.min(...firstTimestamps, ...lastTimestamps),
      maxTimestamp: Math.max(...firstTimestamps, ...lastTimestamps),
    });
  }
  return ranges;
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const getTimestampPartition = (timestamps, validationSplit, testSplit) => {
  const placeholders = timestamps.map((timestamp) => ({ timestamp }));
  const split = splitRowsByTimestamp(placeholders, validationSplit, testSplit);
  return {
    train: new Set(split.train.map((row) => row.timestamp)),
    tuning: new Set(split.tuning.map((row) => row.timestamp)),
    test: new Set(split.test.map((row) => row.timestamp)),
  };
};

const getPartitionName = (timestamp, partition) => {
  if (partition.train.has(timestamp)) return 'train';
  if (partition.tuning.has(timestamp)) return 'tuning';
  if (partition.test.has(timestamp)) return 'test';
  return null;
};

const evenlySampleRows = (rows, limit) => {
  if (rows.length <= limit) return rows;
  const output = [];
  const selected = new Set();
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.min(
      rows.length - 1,
      Math.floor(((index + 0.5) * rows.length) / limit),
    );
    if (!selected.has(sourceIndex)) {
      selected.add(sourceIndex);
      output.push(rows[sourceIndex]);
    }
  }
  return output;
};

const stableCrossRowHash = (row) => {
  const input = `${row.timestamp ?? ''}|${row.signalId ?? ''}|${row.symbol ?? ''}|${row.sequence ?? ''}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const balanceCrossStrategyRows = (
  rows,
  { maxRowsPerStrategy = 2_500, maxRowsPerEvent = 1 } = {},
) => {
  const byStrategy = new Map();
  for (const row of rows) {
    const strategyRows = byStrategy.get(row.strategy) ?? [];
    strategyRows.push(row);
    byStrategy.set(row.strategy, strategyRows);
  }
  const output = [];
  for (const strategyRows of byStrategy.values()) {
    const byTimestamp = new Map();
    for (const row of strategyRows) {
      const eventRows = byTimestamp.get(row.timestamp) ?? [];
      eventRows.push(row);
      byTimestamp.set(row.timestamp, eventRows);
    }
    const eventCapped = [...byTimestamp.values()]
      .flatMap((eventRows) =>
        eventRows
          .sort(
            (left, right) =>
              stableCrossRowHash(left) - stableCrossRowHash(right) ||
              left.sequence - right.sequence,
          )
          .slice(0, maxRowsPerEvent),
      )
      .sort(
        (left, right) =>
          left.timestamp - right.timestamp || left.sequence - right.sequence,
      );
    output.push(...evenlySampleRows(eventCapped, maxRowsPerStrategy));
  }
  return output.sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.sequence - right.sequence,
  );
};

const matchesPocketPredicate = (features, predicate) => {
  if (!Object.prototype.hasOwnProperty.call(features, predicate.featureKey)) {
    return false;
  }
  const value = features[predicate.featureKey];
  if (predicate.op === '==') return value === predicate.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return predicate.op === '<='
    ? value <= predicate.threshold
    : value >= predicate.threshold;
};

export const matchesPocket = (row, predicates) =>
  predicates.every((predicate) =>
    matchesPocketPredicate(row.features, predicate),
  );

const summarizeCrossComparison = (rows, sourceRows) => {
  const summary = summarizeRows(rows, getPeriodDays(sourceRows), {
    calendarDays: getCalendarDays(sourceRows),
  });
  return {
    rows: summary.trades,
    events: summary.events,
    winRate: summary.winRate,
    profitFactor: summary.profitFactor,
    normalizedProfit: summary.totalProfit,
    profitPerEvent: summary.events
      ? summary.totalProfit / summary.events
      : null,
    maxDrawdown: summary.maxDrawdown,
    maxLossStreak: summary.maxLossStreak,
    losingMonths: summary.losingMonths,
  };
};

const summarizeCrossSlice = (sourceRows, predicates, expectedSign) => {
  const rows = sourceRows.filter((row) => matchesPocket(row, predicates));
  const complementRows = sourceRows.filter(
    (row) => !matchesPocket(row, predicates),
  );
  const summary = summarizeRows(rows, getPeriodDays(sourceRows), {
    calendarDays: getCalendarDays(sourceRows),
  });
  const byStrategy = [...new Set(rows.map((row) => row.strategy))]
    .sort()
    .map((strategy) => {
      const strategyRows = rows.filter((row) => row.strategy === strategy);
      const strategySummary = summarizeRows(
        strategyRows,
        getPeriodDays(sourceRows),
        { calendarDays: getCalendarDays(sourceRows) },
      );
      return {
        strategy,
        rows: strategyRows.length,
        events: new Set(strategyRows.map((row) => row.timestamp)).size,
        winRate: strategySummary.winRate,
        profitFactor: strategySummary.profitFactor,
        normalizedProfit: strategySummary.totalProfit,
        rawProfit: strategyRows.reduce((sum, row) => sum + row.rawProfit, 0),
      };
    });
  const supportedStrategies = byStrategy.filter((entry) => entry.events >= 5);
  const signCorrectStrategies = supportedStrategies.filter((entry) =>
    expectedSign > 0 ? entry.normalizedProfit > 0 : entry.normalizedProfit < 0,
  );
  const strategyCounts = byStrategy.map((entry) => entry.rows);
  const strategyAbsProfits = byStrategy.map((entry) =>
    Math.abs(entry.normalizedProfit),
  );
  const events = new Map();
  const months = new Map();
  const symbols = new Map();
  for (const row of rows) {
    const event = events.get(row.timestamp) ?? { rows: 0, profit: 0 };
    event.rows += 1;
    event.profit += row.profit;
    events.set(row.timestamp, event);
    const month = new Date(row.timestamp).toISOString().slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + row.profit);
    const symbol = symbols.get(row.symbol) ?? { rows: 0, profit: 0 };
    symbol.rows += 1;
    symbol.profit += row.profit;
    symbols.set(row.symbol, symbol);
  }
  const eventValues = [...events.values()];
  const absoluteEventProfit = eventValues.reduce(
    (sum, event) => sum + Math.abs(event.profit),
    0,
  );
  const expectedMonths = [...months.values()].filter((profit) =>
    expectedSign > 0 ? profit > 0 : profit < 0,
  ).length;
  const symbolValues = [...symbols.values()];
  const absoluteSymbolProfit = symbolValues.reduce(
    (sum, symbol) => sum + Math.abs(symbol.profit),
    0,
  );
  return {
    ...summary,
    rawProfit: rows.reduce((sum, row) => sum + row.rawProfit, 0),
    selectionRatio: sourceRows.length ? rows.length / sourceRows.length : null,
    baseline: summarizeCrossComparison(sourceRows, sourceRows),
    complement: summarizeCrossComparison(complementRows, sourceRows),
    strategies: byStrategy,
    supportedStrategies: supportedStrategies.length,
    signCorrectStrategies: signCorrectStrategies.length,
    signCorrectStrategyRatio: supportedStrategies.length
      ? signCorrectStrategies.length / supportedStrategies.length
      : null,
    topStrategyCountShare: rows.length
      ? Math.max(0, ...strategyCounts) / rows.length
      : null,
    topStrategyAbsProfitShare:
      strategyAbsProfits.reduce((sum, value) => sum + value, 0) > 0
        ? Math.max(0, ...strategyAbsProfits) /
          strategyAbsProfits.reduce((sum, value) => sum + value, 0)
        : null,
    topEventAbsProfitShare: absoluteEventProfit
      ? Math.max(0, ...eventValues.map((event) => Math.abs(event.profit))) /
        absoluteEventProfit
      : null,
    topSymbolCountShare: rows.length
      ? Math.max(0, ...symbolValues.map((symbol) => symbol.rows)) / rows.length
      : null,
    topSymbolAbsProfitShare: absoluteSymbolProfit
      ? Math.max(0, ...symbolValues.map((symbol) => Math.abs(symbol.profit))) /
        absoluteSymbolProfit
      : null,
    months: months.size,
    signCorrectMonths: expectedMonths,
    signCorrectMonthRatio: months.size ? expectedMonths / months.size : null,
  };
};

export const buildShiftedProfitLookups = (
  rows,
  { offsets = [17, 31, 47, 73, 101] } = {},
) => {
  const byStrategy = new Map();
  for (const row of rows) {
    const strategyRows = byStrategy.get(row.strategy) ?? [];
    strategyRows.push(row);
    byStrategy.set(row.strategy, strategyRows);
  }
  return offsets.map((offset) => {
    const lookup = new Map();
    for (const strategyRows of byStrategy.values()) {
      const byTimestamp = new Map();
      for (const row of strategyRows) {
        const eventRows = byTimestamp.get(row.timestamp) ?? [];
        eventRows.push(row);
        byTimestamp.set(row.timestamp, eventRows);
      }
      const events = [...byTimestamp.entries()]
        .sort(([left], [right]) => left - right)
        .map(([timestamp, eventRows]) => ({
          timestamp,
          rows: eventRows.sort((left, right) => left.sequence - right.sequence),
          profit: eventRows.reduce((sum, row) => sum + row.profit, 0),
        }));
      const shift = events.length > 1 ? offset % events.length || 1 : 0;
      events.forEach((event, index) => {
        const shiftedProfit = events[(index + shift) % events.length].profit;
        const profitPerRow = shiftedProfit / event.rows.length;
        for (const row of event.rows) lookup.set(row.sequence, profitPerRow);
      });
    }
    return lookup;
  });
};

const evaluateNegativeControl = (rows, predicates, expectedSign, lookups) => {
  const selected = rows.filter((row) => matchesPocket(row, predicates));
  const profits = lookups.map((lookup) =>
    selected.reduce((sum, row) => sum + (lookup.get(row.sequence) ?? 0), 0),
  );
  return {
    runs: profits.length,
    medianProfit: median(profits),
    signCorrectRuns: profits.filter((profit) =>
      expectedSign > 0 ? profit > 0 : profit < 0,
    ).length,
  };
};

export const evaluateCrossPocket = ({
  pocket,
  split,
  expectedSign,
  testShiftLookups,
  minSharedStrategies,
  portfolioCapacity,
}) => {
  const train = summarizeCrossSlice(
    split.train,
    pocket.predicates,
    expectedSign,
  );
  const tuning = summarizeCrossSlice(
    split.tuning,
    pocket.predicates,
    expectedSign,
  );
  const test = summarizeCrossSlice(split.test, pocket.predicates, expectedSign);
  const negativeControl = evaluateNegativeControl(
    split.test,
    pocket.predicates,
    expectedSign,
    testShiftLookups,
  );
  const signCorrect = (summary) =>
    expectedSign > 0 ? summary.totalProfit > 0 : summary.totalProfit < 0;
  const effectiveProfitFactor = (summary) =>
    summary.profitFactor ??
    (summary.normalizedProfit > 0 ? Number.POSITIVE_INFINITY : 0);
  const hasCrossStrategySupport = (summary) =>
    summary.supportedStrategies >= minSharedStrategies &&
    (summary.signCorrectStrategyRatio ?? 0) >= 0.6;
  const hasConcentrationControl = (summary) =>
    (summary.topEventCountShare ?? 1) <= 1 / 3 &&
    (summary.topEventAbsProfitShare ?? 1) <= 1 / 3 &&
    (summary.topStrategyCountShare ?? 1) <= 1 / 3 &&
    (summary.topStrategyAbsProfitShare ?? 1) <= 1 / 3;
  const hasTemporalStability = (summary) =>
    summary.months >= 2 && (summary.signCorrectMonthRatio ?? 0) >= 0.5;
  const approvalEdge = (summary) =>
    summary.events > 0 &&
    summary.complement.events > 0 &&
    summary.totalProfit / summary.events >
      (summary.complement.profitPerEvent ?? Number.NEGATIVE_INFINITY) &&
    effectiveProfitFactor({
      profitFactor: summary.profitFactor,
      normalizedProfit: summary.totalProfit,
    }) > effectiveProfitFactor(summary.complement);
  const blockEdge = (summary) =>
    summary.complement.events >= 25 &&
    (summary.selectionRatio ?? 1) <= 0.8 &&
    (summary.complement.profitPerEvent ?? Number.NEGATIVE_INFINITY) >
      (summary.baseline.profitPerEvent ?? Number.NEGATIVE_INFINITY) &&
    effectiveProfitFactor(summary.complement) >
      effectiveProfitFactor(summary.baseline) &&
    (summary.complement.profitPerEvent ?? Number.NEGATIVE_INFINITY) >
      (summary.events ? summary.totalProfit / summary.events : 0);
  const checks = {
    partitionSign:
      signCorrect(train) && signCorrect(tuning) && signCorrect(test),
    independentEventSupport:
      train.events >= 25 && tuning.events >= 25 && test.events >= 25,
    crossStrategySupport:
      hasCrossStrategySupport(train) &&
      hasCrossStrategySupport(tuning) &&
      hasCrossStrategySupport(test),
    eventConcentration:
      hasConcentrationControl(train) &&
      hasConcentrationControl(tuning) &&
      hasConcentrationControl(test),
    symbolConcentration: [train, tuning, test].every(
      (summary) =>
        (summary.topSymbolCountShare ?? 1) <= 1 / 3 &&
        (summary.topSymbolAbsProfitShare ?? 1) <= 1 / 3,
    ),
    temporalStability:
      hasTemporalStability(train) &&
      hasTemporalStability(tuning) &&
      hasTemporalStability(test),
    discriminatoryEdge:
      expectedSign > 0
        ? approvalEdge(train) && approvalEdge(tuning) && approvalEdge(test)
        : blockEdge(train) && blockEdge(tuning) && blockEdge(test),
    portfolioFanout:
      expectedSign < 0 ||
      [train, tuning, test].every(
        (summary) => (summary.maxBatch ?? Infinity) <= portfolioCapacity,
      ),
    negativeControl: negativeControl.signCorrectRuns < 4,
  };
  return {
    condition: pocket.condition,
    predicates: pocket.predicates,
    train,
    tuning,
    test,
    negativeControl,
    checks,
    passes: Object.values(checks).every(Boolean),
  };
};

const scanCrossDataset = async ({
  groups,
  minTimestamp,
  maxTimestamp,
  commonFeatures = null,
  collectFeatures = true,
  onRow,
}) => {
  let scanned = 0;
  let selected = 0;
  let failed = 0;
  for (const group of groups) {
    for (const filePath of group.files) {
      console.error(
        `cross scan ${group.strategyToken}: ${path.basename(filePath)}`,
      );
      const reader = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
      });
      for await (const line of reader) {
        if (!line.trim()) continue;
        scanned += 1;
        try {
          const source = JSON.parse(line);
          const timestamp = Number(source.timestamp);
          const rawProfit = Number(source.profit);
          const direction = String(source.direction ?? '').toUpperCase();
          if (
            !Number.isFinite(timestamp) ||
            !Number.isFinite(rawProfit) ||
            !['LONG', 'SHORT'].includes(direction) ||
            timestamp < minTimestamp ||
            timestamp > maxTimestamp ||
            !source.payload
          ) {
            continue;
          }
          const shared = collectFeatures
            ? collectSavedCrossStrategyFeatures(source.payload)
            : null;
          const profiles = shared
            ? partitionCrossStrategyFeatures(shared)
            : null;
          const features =
            shared && commonFeatures
              ? Object.fromEntries(
                  Object.entries({
                    ...profiles.universal,
                    ...profiles.benchmarkReference,
                  }).filter(([key]) => commonFeatures.has(key)),
                )
              : shared;
          onRow({
            source,
            timestamp,
            rawProfit,
            direction,
            strategy: group.strategyToken,
            features,
            profiles,
            scanned,
          });
          selected += 1;
        } catch (error) {
          failed += 1;
          if (failed <= 5) {
            console.error(
              `cross row error: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        if (scanned % 25_000 === 0) {
          console.error(`cross scanned ${scanned} rows, selected ${selected}`);
        }
      }
    }
  }
  return { scanned, selected, failed };
};

const createCrossCoverageStore = () =>
  Object.fromEntries(
    CROSS_SEARCH_PROFILE_NAMES.map((profile) => [
      profile,
      Object.fromEntries(
        ['LONG', 'SHORT'].map((direction) => [
          direction,
          Object.fromEntries(
            ['train', 'tuning', 'test'].map((partition) => [
              partition,
              new Map(),
            ]),
          ),
        ]),
      ),
    ]),
  );

const incrementCrossFeatureCoverage = (store, feature, strategy) => {
  const strategyCounts = store.get(feature) ?? new Map();
  strategyCounts.set(strategy, (strategyCounts.get(strategy) ?? 0) + 1);
  store.set(feature, strategyCounts);
};

const createCrossPartitionRowsStore = () =>
  Object.fromEntries(
    ['LONG', 'SHORT'].map((direction) => [
      direction,
      Object.fromEntries(
        ['train', 'tuning', 'test'].map((partition) => [partition, new Map()]),
      ),
    ]),
  );

const incrementCrossStrategyRows = (store, strategy) =>
  store.set(strategy, (store.get(strategy) ?? 0) + 1);

const createCrossAuditStore = () =>
  Object.fromEntries(
    CROSS_AUDIT_PROFILE_NAMES.map((profile) => [profile, new Map()]),
  );

const accumulateCrossAudit = ({
  store,
  profile,
  feature,
  value,
  strategy,
  partition,
}) => {
  const classification = classifyCrossStrategyFeature(feature);
  if (!classification) return;
  const entries = store[profile];
  const entry = entries.get(feature) ?? {
    feature,
    profile,
    scope: classification.scope,
    role: classification.role,
    reason: classification.reason,
    transform: classification.transform ?? null,
    observedRows: 0,
    presentRows: 0,
    nullRows: 0,
    trueRows: 0,
    falseRows: 0,
    numericRows: 0,
    numericMin: null,
    numericMax: null,
    categories: new Map(),
    strategies: new Map(),
    partitions: { train: 0, tuning: 0, test: 0 },
  };
  entry.observedRows += 1;
  if (value == null) {
    entry.nullRows += 1;
  } else {
    entry.presentRows += 1;
    entry.strategies.set(strategy, (entry.strategies.get(strategy) ?? 0) + 1);
    entry.partitions[partition] += 1;
    if (value === true) entry.trueRows += 1;
    else if (value === false) entry.falseRows += 1;
    else if (typeof value === 'number' && Number.isFinite(value)) {
      entry.numericRows += 1;
      entry.numericMin =
        entry.numericMin == null ? value : Math.min(entry.numericMin, value);
      entry.numericMax =
        entry.numericMax == null ? value : Math.max(entry.numericMax, value);
    } else if (typeof value === 'string') {
      entry.categories.set(value, (entry.categories.get(value) ?? 0) + 1);
    }
  }
  entries.set(feature, entry);
};

const finalizeCrossAudit = (store, overlapRows) =>
  Object.fromEntries(
    CROSS_AUDIT_PROFILE_NAMES.map((profile) => [
      profile,
      [...store[profile].values()]
        .map((entry) => ({
          feature: entry.feature,
          profile: entry.profile,
          scope: entry.scope,
          role: entry.role,
          reason: entry.reason,
          transform: entry.transform,
          observedRows: entry.observedRows,
          presentRows: entry.presentRows,
          coverage: entry.presentRows / Math.max(1, overlapRows),
          nullRows: entry.nullRows,
          trueRows: entry.trueRows,
          falseRows: entry.falseRows,
          trueRate:
            entry.trueRows + entry.falseRows
              ? entry.trueRows / (entry.trueRows + entry.falseRows)
              : null,
          numericRows: entry.numericRows,
          numericMin: entry.numericMin,
          numericMax: entry.numericMax,
          strategies: entry.strategies.size,
          partitions: entry.partitions,
          categories: [...entry.categories.entries()]
            .sort((left, right) => right[1] - left[1])
            .slice(0, 8)
            .map(([value, rows]) => ({ value, rows })),
        }))
        .sort(
          (left, right) =>
            right.strategies - left.strategies ||
            right.presentRows - left.presentRows ||
            left.feature.localeCompare(right.feature),
        ),
    ]),
  );

const getCrossFeatureEntries = ({
  profile,
  direction,
  coverageStore,
  partitionRows,
  minFeatureStrategies,
  minCoverage,
}) => {
  const trainCoverage = coverageStore[profile][direction].train;
  return [...trainCoverage.entries()]
    .map(([feature, strategyCounts]) => {
      const classification = classifyCrossStrategyFeature(feature);
      const partitionCoverage = Object.fromEntries(
        ['train', 'tuning', 'test'].map((partition) => {
          const coverage =
            coverageStore[profile][direction][partition].get(feature);
          const totalRows = [
            ...partitionRows[direction][partition].values(),
          ].reduce((sum, rows) => sum + rows, 0);
          const usableRows = coverage
            ? [...coverage.values()].reduce((sum, rows) => sum + rows, 0)
            : 0;
          return [
            partition,
            {
              usableRows,
              totalRows,
              coverage: usableRows / Math.max(1, totalRows),
            },
          ];
        }),
      );
      const strategyRatios = [...partitionRows[direction].train.entries()].map(
        ([strategy, rows]) =>
          (strategyCounts.get(strategy) ?? 0) / Math.max(1, rows),
      );
      const eligibleStrategies = strategyRatios.filter(
        (ratio) => ratio >= minCoverage,
      ).length;
      return {
        feature,
        profile,
        scope: classification?.scope ?? 'unknown',
        role: classification?.role ?? 'unknown',
        trainStrategies: eligibleStrategies,
        trainRows: [...strategyCounts.values()].reduce(
          (sum, rows) => sum + rows,
          0,
        ),
        minStrategyCoverage: strategyRatios.length
          ? Math.min(...strategyRatios)
          : null,
        medianStrategyCoverage: median(strategyRatios),
        partitionCoverage,
      };
    })
    .filter((entry) => entry.trainStrategies >= minFeatureStrategies)
    .sort(
      (left, right) =>
        right.trainStrategies - left.trainStrategies ||
        right.trainRows - left.trainRows ||
        left.feature.localeCompare(right.feature),
    );
};

const pickCrossFeatures = (features, eligibleFeatures) =>
  Object.fromEntries(
    Object.entries(features).filter(([feature]) =>
      eligibleFeatures.has(feature),
    ),
  );

const eventWeightCrossRows = (rows) => {
  const eventCounts = new Map();
  for (const row of rows) {
    eventCounts.set(row.timestamp, (eventCounts.get(row.timestamp) ?? 0) + 1);
  }
  return rows.map((row) => ({
    ...row,
    profit: row.profit / Math.max(1, eventCounts.get(row.timestamp) ?? 1),
  }));
};

const crossPrimitiveSignature = (value) => `${typeof value}:${String(value)}`;

const getCrossConsensusFeatures = (
  rows,
  { minConsensusRatio, featureKey = 'features' },
) => {
  const featureValues = new Map();
  for (const row of rows) {
    for (const [feature, value] of Object.entries(row[featureKey] ?? {})) {
      const signatures = featureValues.get(feature) ?? new Map();
      const signature = crossPrimitiveSignature(value);
      const bucket = signatures.get(signature) ?? {
        signature,
        value,
        votes: 0,
      };
      bucket.votes += 1;
      signatures.set(signature, bucket);
      featureValues.set(feature, signatures);
    }
  }
  const features = {};
  const results = new Map();
  for (const [feature, signatures] of featureValues.entries()) {
    const winner = [...signatures.values()].sort(
      (left, right) =>
        right.votes - left.votes ||
        left.signature.localeCompare(right.signature),
    )[0];
    const consensus = winner.votes / rows.length >= minConsensusRatio;
    if (consensus) features[feature] = winner.value;
    results.set(feature, {
      feature,
      consensus,
      winnerVotes: winner.votes,
      totalVotes: rows.length,
    });
  }
  return { features, results };
};

export const aggregateBenchmarkDiscoveryRows = (
  rows,
  { minConsensusRatio = 0.8 } = {},
) => {
  const byTimestamp = new Map();
  for (const row of rows) {
    const eventRows = byTimestamp.get(row.timestamp) ?? [];
    eventRows.push(row);
    byTimestamp.set(row.timestamp, eventRows);
  }
  const consistency = new Map();
  const output = [];
  for (const eventRows of byTimestamp.values()) {
    const rowsByStrategy = new Map();
    for (const row of eventRows) {
      const strategyEventRows = rowsByStrategy.get(row.strategy) ?? [];
      strategyEventRows.push(row);
      rowsByStrategy.set(row.strategy, strategyEventRows);
    }
    const strategySnapshots = [];
    const observedFeatures = new Set();
    const intraStrategyConflicts = new Set();
    for (const [strategy, strategyEventRows] of rowsByStrategy.entries()) {
      const snapshot = getCrossConsensusFeatures(strategyEventRows, {
        minConsensusRatio,
      });
      for (const [feature, result] of snapshot.results.entries()) {
        observedFeatures.add(feature);
        if (!result.consensus) intraStrategyConflicts.add(feature);
      }
      strategySnapshots.push({
        strategy,
        features: snapshot.features,
        profit:
          strategyEventRows.reduce((sum, row) => sum + row.profit, 0) /
          strategyEventRows.length,
      });
    }
    const eventConsensus = getCrossConsensusFeatures(strategySnapshots, {
      minConsensusRatio,
    });
    for (const feature of eventConsensus.results.keys()) {
      observedFeatures.add(feature);
    }
    for (const feature of observedFeatures) {
      const result = eventConsensus.results.get(feature);
      const hasIntraStrategyConflict = intraStrategyConflicts.has(feature);
      const hasCrossStrategyConflict = result != null && !result.consensus;
      const hasConsensus =
        result?.consensus === true && !hasIntraStrategyConflict;
      const stats = consistency.get(feature) ?? {
        feature,
        observedEvents: 0,
        consensusEvents: 0,
        conflictEvents: 0,
        intraStrategyConflictEvents: 0,
        crossStrategyConflictEvents: 0,
      };
      stats.observedEvents += 1;
      if (hasConsensus) {
        stats.consensusEvents += 1;
      } else {
        stats.conflictEvents += 1;
      }
      if (hasIntraStrategyConflict) stats.intraStrategyConflictEvents += 1;
      if (hasCrossStrategyConflict) stats.crossStrategyConflictEvents += 1;
      consistency.set(feature, stats);
    }
    const first = eventRows[0];
    output.push({
      ...first,
      strategy: '__benchmark_event__',
      symbol: '__benchmark_event__',
      profit:
        strategySnapshots.reduce((sum, entry) => sum + entry.profit, 0) /
        strategySnapshots.length,
      rawProfit: eventRows.reduce((sum, row) => sum + row.rawProfit, 0),
      features: eventConsensus.features,
    });
  }
  return {
    rows: output.sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.sequence - right.sequence,
    ),
    consistency: [...consistency.values()].sort(
      (left, right) =>
        right.conflictEvents - left.conflictEvents ||
        left.feature.localeCompare(right.feature),
    ),
  };
};

export const applyBenchmarkEventSnapshots = (rows, benchmarkEvents) => {
  const snapshots = new Map(
    benchmarkEvents.map((event) => [event.timestamp, event.features]),
  );
  return rows.map((row) => ({
    ...row,
    features: snapshots.get(row.timestamp) ?? {},
  }));
};

const hasValidationSign = (pocket, expectedSign, minValidationSupport) => {
  const summary = pocket.validationSummary;
  return (
    summary != null &&
    summary.support >= minValidationSupport &&
    (expectedSign > 0 ? summary.totalProfit > 0 : summary.totalProfit < 0)
  );
};

export const buildCrossStrategyReport = async ({
  projectRoot,
  sourceRepositoryRoot,
  frameworkRepositoryRoot,
  searchAiPockets: searchAiPocketsOverride,
  groups,
  validationSplit,
  testSplit,
  maxDepth,
  minSupport,
  minValidationSupport,
  maxAtomicPredicates,
  maxCombinations,
  top,
  maxRowsPerStrategy,
  maxRowsPerEvent,
  minFeatureStrategies,
  minFeatureCoverage,
  minBenchmarkFeatureCoverage,
  portfolioCapacity = 5,
}) => {
  if (groups.length < 2) {
    throw new Error('Cross-strategy research requires at least two exports');
  }
  if (testSplit <= 0 || validationSplit <= 0) {
    throw new Error(
      '--crossStrategy requires positive --validationSplit and --testSplit',
    );
  }
  let searchAiPockets = searchAiPocketsOverride;
  if (!searchAiPockets) {
    const require = createRequire(import.meta.url);
    const pocketModulePath = path.join(
      frameworkRepositoryRoot,
      'packages/cli/dist/lib/aiPocketSearch.js',
    );
    await fsp.access(pocketModulePath);
    ({ searchAiPockets } = require(pocketModulePath));
  }
  const ranges = await getCrossDatasetRanges(groups);
  const minTimestamp = Math.max(...ranges.map((entry) => entry.minTimestamp));
  const maxTimestamp = Math.min(...ranges.map((entry) => entry.maxTimestamp));
  if (!(maxTimestamp > minTimestamp)) {
    throw new Error('Latest exports have no common chronological overlap');
  }

  const manifest = new Map();
  for (const group of groups) {
    for (const filePath of group.files) {
      const stat = await fsp.stat(filePath);
      manifest.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  const metadata = [];
  const strategyRows = new Map();
  const firstPass = await scanCrossDataset({
    groups,
    minTimestamp,
    maxTimestamp,
    collectFeatures: false,
    onRow: ({ timestamp, rawProfit, direction, strategy }) => {
      metadata.push({ timestamp, rawProfit, direction, strategy });
      strategyRows.set(strategy, (strategyRows.get(strategy) ?? 0) + 1);
    },
  });
  const timestamps = [...new Set(metadata.map((row) => row.timestamp))].sort(
    (left, right) => left - right,
  );
  const partition = getTimestampPartition(
    timestamps,
    validationSplit,
    testSplit,
  );
  const lossValues = new Map();
  for (const row of metadata) {
    if (!partition.train.has(row.timestamp) || row.rawProfit >= 0) continue;
    const values = lossValues.get(row.strategy) ?? [];
    values.push(Math.abs(row.rawProfit));
    lossValues.set(row.strategy, values);
  }
  const lossScale = new Map(
    groups.map((group) => {
      const strategy = group.strategyToken;
      const value = median(lossValues.get(strategy) ?? []) ?? 1;
      return [strategy, value > 0 ? value : 1];
    }),
  );

  metadata.length = 0;
  const coverageStore = createCrossCoverageStore();
  const partitionRows = createCrossPartitionRowsStore();
  const auditStore = createCrossAuditStore();
  let sequence = 0;
  const rows = [];
  const secondPass = await scanCrossDataset({
    groups,
    minTimestamp,
    maxTimestamp,
    collectFeatures: true,
    onRow: ({
      source,
      timestamp,
      rawProfit,
      direction,
      strategy,
      profiles,
    }) => {
      const partitionName = getPartitionName(timestamp, partition);
      if (!partitionName || !profiles) return;
      incrementCrossStrategyRows(
        partitionRows[direction][partitionName],
        strategy,
      );
      for (const profile of CROSS_SEARCH_PROFILE_NAMES) {
        for (const feature of Object.keys(profiles[profile])) {
          incrementCrossFeatureCoverage(
            coverageStore[profile][direction][partitionName],
            feature,
            strategy,
          );
        }
      }
      for (const profile of CROSS_AUDIT_PROFILE_NAMES) {
        for (const [feature, value] of Object.entries(profiles[profile])) {
          accumulateCrossAudit({
            store: auditStore,
            profile,
            feature,
            value,
            strategy,
            partition: partitionName,
          });
        }
      }
      rows.push({
        sequence: sequence++,
        signalId: source.signalId,
        timestamp,
        symbol: source.symbol,
        direction,
        strategy,
        rawProfit,
        profit: rawProfit / (lossScale.get(strategy) ?? 1),
        profileFeatures: {
          universal: profiles.universal,
          benchmarkReference: profiles.benchmarkReference,
        },
      });
    },
  });
  for (const [filePath, before] of manifest.entries()) {
    const after = await fsp.stat(filePath);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`Export changed during cross-strategy scan: ${filePath}`);
    }
  }
  rows.sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.sequence - right.sequence,
  );
  const split = splitRowsByTimestamp(rows, validationSplit, testSplit);
  const minSharedStrategies = Math.min(
    groups.length,
    Math.max(5, Math.ceil(minFeatureStrategies * 0.6)),
  );
  const profiles = {};
  for (const profile of CROSS_SEARCH_PROFILE_NAMES) {
    const minCoverage =
      profile === 'universal'
        ? minFeatureCoverage
        : minBenchmarkFeatureCoverage;
    const profileDirections = {};
    for (const direction of ['LONG', 'SHORT']) {
      const featureEntries = getCrossFeatureEntries({
        profile,
        direction,
        coverageStore,
        partitionRows,
        minFeatureStrategies,
        minCoverage,
      });
      const eligibleFeatures = new Set(
        featureEntries.map((entry) => entry.feature),
      );
      const directionSplit = Object.fromEntries(
        Object.entries(split).map(([name, splitRows]) => [
          name,
          splitRows
            .filter((row) => row.direction === direction)
            .map((row) => {
              const { profileFeatures, ...baseRow } = row;
              return {
                ...baseRow,
                features: pickCrossFeatures(
                  profileFeatures[profile],
                  eligibleFeatures,
                ),
              };
            }),
        ]),
      );
      let discoveryTrain;
      let discoveryTuning;
      let evaluationSplit = directionSplit;
      let featureConsistency = null;
      if (profile === 'benchmarkReference') {
        const trainAggregation = aggregateBenchmarkDiscoveryRows(
          directionSplit.train,
        );
        const tuningAggregation = aggregateBenchmarkDiscoveryRows(
          directionSplit.tuning,
        );
        const testAggregation = aggregateBenchmarkDiscoveryRows(
          directionSplit.test,
        );
        discoveryTrain = trainAggregation.rows;
        discoveryTuning = tuningAggregation.rows;
        evaluationSplit = {
          train: applyBenchmarkEventSnapshots(
            directionSplit.train,
            trainAggregation.rows,
          ),
          tuning: applyBenchmarkEventSnapshots(
            directionSplit.tuning,
            tuningAggregation.rows,
          ),
          test: applyBenchmarkEventSnapshots(
            directionSplit.test,
            testAggregation.rows,
          ),
        };
        featureConsistency = {
          train: trainAggregation.consistency,
          tuning: tuningAggregation.consistency,
          test: testAggregation.consistency,
        };
      } else {
        discoveryTrain = eventWeightCrossRows(
          balanceCrossStrategyRows(directionSplit.train, {
            maxRowsPerStrategy,
            maxRowsPerEvent,
          }),
        );
        discoveryTuning = eventWeightCrossRows(
          balanceCrossStrategyRows(directionSplit.tuning, {
            maxRowsPerStrategy,
            maxRowsPerEvent,
          }),
        );
      }
      console.error(
        `cross search ${profile}/${direction}: features=${eligibleFeatures.size}, train=${discoveryTrain.length}, tuning=${discoveryTuning.length}`,
      );
      const candidatePoolSize = Math.max(200, top * 20);
      const search = searchAiPockets(discoveryTrain, {
        validationRows: discoveryTuning,
        minSupport,
        minValidationSupport,
        minProfitFactor: 1.05,
        minTotalProfit: 0,
        maxDepth,
        maxAtomicPredicates,
        maxCombinations,
        top: candidatePoolSize,
        progressInterval: 2_500,
        onProgress: (progress) => {
          if (progress.done || progress.phase === 'combinations') {
            console.error(
              `cross ${profile}/${direction} ${progress.phase} ${progress.current}/${progress.total}${progress.truncated ? ' truncated' : ''}`,
            );
          }
        },
      });
      const positivePockets = search.positivePockets
        .filter((pocket) => hasValidationSign(pocket, 1, minValidationSupport))
        .slice(0, top);
      const negativePockets = search.negativePockets
        .filter((pocket) => hasValidationSign(pocket, -1, minValidationSupport))
        .slice(0, top);
      const testShiftLookups = buildShiftedProfitLookups(evaluationSplit.test);
      profileDirections[direction] = {
        featureCoverageFloor: minCoverage,
        features: featureEntries,
        rows: Object.fromEntries(
          Object.entries(directionSplit).map(([name, splitRows]) => [
            name,
            splitRows.length,
          ]),
        ),
        events: Object.fromEntries(
          Object.entries(directionSplit).map(([name, splitRows]) => [
            name,
            new Set(splitRows.map((row) => row.timestamp)).size,
          ]),
        ),
        discoveryUnit:
          profile === 'benchmarkReference'
            ? 'strategy-consensus timestamp-direction benchmark event with macro strategy LU; acceptance selects whole events'
            : 'balanced signal rows with equal timestamp profit weight',
        discoveryRows: {
          train: discoveryTrain.length,
          tuning: discoveryTuning.length,
        },
        featureConsistency,
        searchStats: {
          ...search.stats,
          candidatePoolSize,
          positiveAfterTuningSign: positivePockets.length,
          negativeAfterTuningSign: negativePockets.length,
        },
        approve: positivePockets.map((pocket) =>
          evaluateCrossPocket({
            pocket,
            split: evaluationSplit,
            expectedSign: 1,
            testShiftLookups,
            minSharedStrategies,
            portfolioCapacity,
          }),
        ),
        block: negativePockets.map((pocket) =>
          evaluateCrossPocket({
            pocket,
            split: evaluationSplit,
            expectedSign: -1,
            testShiftLookups,
            minSharedStrategies,
            portfolioCapacity,
          }),
        ),
      };
    }
    profiles[profile] = {
      description:
        profile === 'universal'
          ? 'normalized target/setup market state'
          : 'normalized benchmark, reference, and global market state',
      directions: profileDirections,
    };

    // Each profile is searched independently. Release its per-row source maps
    // once both directions are complete so the next profile does not duplicate
    // two full feature universes while constructing its direction split.
    for (const row of rows) {
      delete row.profileFeatures[profile];
    }
  }

  const datasetOverlapRows = groups.reduce(
    (sum, group) => sum + (strategyRows.get(group.strategyToken) ?? 0),
    0,
  );
  if (datasetOverlapRows !== firstPass.selected) {
    throw new Error(
      `Dataset lineage invariant failed: ${datasetOverlapRows} != ${firstPass.selected}`,
    );
  }
  const partitionBoundary = (timestampsForPartition) => {
    const values = [...timestampsForPartition].sort(
      (left, right) => left - right,
    );
    return values.length
      ? {
          minTimestamp: new Date(values[0]).toISOString(),
          maxTimestamp: new Date(values.at(-1)).toISOString(),
          events: values.length,
        }
      : null;
  };

  return {
    generatedAt: new Date().toISOString(),
    run: {
      mode: 'profiled cross-strategy saved-snapshot feasibility',
      sourceRepositoryRoot,
      frameworkRepositoryRoot,
      evidenceStatus:
        'retrospective research-only; this report exposes the historical test tail',
      strategies: groups.length,
      overlap: {
        minTimestamp: new Date(minTimestamp).toISOString(),
        maxTimestamp: new Date(maxTimestamp).toISOString(),
      },
      scanned: firstPass.scanned,
      featureScanRows: secondPass.scanned,
      overlapRows: firstPass.selected,
      failed: {
        metadataPass: firstPass.failed,
        featurePass: secondPass.failed,
      },
      uniqueEvents: timestamps.length,
      partitions: {
        train: partitionBoundary(partition.train),
        tuning: partitionBoundary(partition.tuning),
        test: partitionBoundary(partition.test),
      },
      validationSplit,
      testSplit,
      minFeatureStrategies,
      acceptance: {
        minSharedStrategies,
        portfolioCapacity,
        selectionUnit: {
          universal: 'signal row',
          benchmarkReference: 'strategy-consensus timestamp-direction event',
        },
      },
      featureCoverage: {
        universal: minFeatureCoverage,
        benchmarkReference: minBenchmarkFeatureCoverage,
        eligibilityPartition: 'train only',
      },
      normalization: 'profit / median absolute train loss per strategy',
      discoveryBalance: { maxRowsPerStrategy, maxRowsPerEvent },
      search: {
        maxDepth,
        minSupport,
        minValidationSupport,
        maxAtomicPredicates,
        maxCombinations,
        top,
      },
    },
    datasets: groups.map((group) => ({
      strategy: group.strategyToken,
      mergeId: group.mergeId,
      parts: group.files.length,
      range: ranges.find((entry) => entry.strategy === group.strategyToken),
      overlapRows: strategyRows.get(group.strategyToken) ?? 0,
      trainLossScale: lossScale.get(group.strategyToken) ?? null,
      files: group.files.map((filePath) =>
        path.relative(projectRoot, filePath),
      ),
    })),
    profiles,
    audits: finalizeCrossAudit(auditStore, firstPass.selected),
  };
};

export const buildAblationReport = ({
  rows,
  variants,
  minQuality,
  qualityThresholds,
  terminalWindows,
  validationSplit,
  testSplit = 0,
  tuningSince = null,
  testSince = null,
  capacities = DEFAULT_CAPACITIES,
  maxLossValue = null,
  filePaths,
  sourceRepositoryRoot = null,
  frameworkRepositoryRoot = null,
  sourceRepositoryKind = null,
  failed = 0,
  featureInventory = [],
}) => {
  if (!rows.length) throw new Error('No rows were evaluated');
  const minTimestamp = rows[0].timestamp;
  const maxTimestamp = rows.at(-1).timestamp;
  if ((tuningSince == null) !== (testSince == null)) {
    throw new Error(
      'Exact calendar partitions require both tuningSince and testSince',
    );
  }
  const exactCalendarPartitions = tuningSince != null;
  const split = exactCalendarPartitions
    ? splitRowsByTimestampBounds(rows, tuningSince, testSince)
    : splitRowsByTimestamp(rows, validationSplit, testSplit);
  const partitionEvidence = (partitionRows) => ({
    rows: partitionRows.length,
    events: new Set(partitionRows.map((row) => row.timestamp)).size,
    startTimestamp: partitionRows.length
      ? new Date(partitionRows[0].timestamp).toISOString()
      : null,
    endTimestamp: partitionRows.length
      ? new Date(partitionRows.at(-1).timestamp).toISOString()
      : null,
  });
  const summaryOptions = { capacities, maxLossValue };
  const baselineSelector = (row) => baselineSelectedAt(row, minQuality);
  const baseline = {
    equity: buildEquitySeries(
      rows,
      baselineSelector,
      minTimestamp,
      maxTimestamp,
    ),
    periods: buildPeriodSummaries({
      rows,
      selector: baselineSelector,
      windows: terminalWindows,
      minTimestamp,
      maxTimestamp,
      summaryOptions,
    }),
    periodDirections: buildPeriodDirectionSummaries({
      rows,
      selector: baselineSelector,
      windows: terminalWindows,
      maxTimestamp,
      summaryOptions,
    }),
    train: summarizeSplit(split.train, baselineSelector, summaryOptions),
    tuning: summarizeSplit(split.tuning, baselineSelector, summaryOptions),
    test: summarizeSplit(split.test, baselineSelector, summaryOptions),
    qualityThresholds: Object.fromEntries(
      qualityThresholds.map((threshold) => [
        `q${threshold}+`,
        summarizeRows(
          selectRows(rows, (row) => baselineSelectedAt(row, threshold)),
          getPeriodDays(rows),
          summaryOptions,
        ),
      ]),
    ),
    directions: summarizeDirections(rows, baselineSelector, summaryOptions),
    months: summarizeMonths(rows, baselineSelector, summaryOptions),
  };
  const variantReports = variants.map((variant, variantIndex) => {
    const candidateSelector = (row) =>
      candidateSelectedAt(row, variant, variantIndex, minQuality, minQuality);
    const matchedSelector = (row) => row.variantMatches[variantIndex];
    const removedSelector = (row) =>
      baselineSelector(row) && !candidateSelector(row);
    const addedSelector = (row) =>
      !baselineSelector(row) && candidateSelector(row);
    return {
      name: variant.name,
      mode: variant.mode,
      quality: variant.quality,
      direction: variant.direction,
      expression: variant.expression,
      equity: buildEquitySeries(
        rows,
        candidateSelector,
        minTimestamp,
        maxTimestamp,
      ),
      periods: buildPeriodSummaries({
        rows,
        selector: candidateSelector,
        windows: terminalWindows,
        minTimestamp,
        maxTimestamp,
        summaryOptions,
      }),
      periodDirections: buildPeriodDirectionSummaries({
        rows,
        selector: candidateSelector,
        windows: terminalWindows,
        maxTimestamp,
        summaryOptions,
      }),
      train: summarizeSplit(split.train, candidateSelector, summaryOptions),
      tuning: summarizeSplit(split.tuning, candidateSelector, summaryOptions),
      test: summarizeSplit(split.test, candidateSelector, summaryOptions),
      qualityThresholds: Object.fromEntries(
        qualityThresholds.map((threshold) => [
          `q${threshold}+`,
          summarizeRows(
            selectRows(rows, (row) =>
              candidateSelectedAt(
                row,
                variant,
                variantIndex,
                threshold,
                minQuality,
              ),
            ),
            getPeriodDays(rows),
            summaryOptions,
          ),
        ]),
      ),
      directions: summarizeDirections(rows, candidateSelector, summaryOptions),
      months: summarizeMonths(rows, candidateSelector, summaryOptions),
      matchedAll: summarizeRows(
        selectRows(rows, matchedSelector),
        getPeriodDays(rows),
        summaryOptions,
      ),
      removed: summarizeRows(
        selectRows(rows, removedSelector),
        getPeriodDays(rows),
        summaryOptions,
      ),
      added: summarizeRows(
        selectRows(rows, addedSelector),
        getPeriodDays(rows),
        summaryOptions,
      ),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    run: {
      filePaths,
      sourceRepositoryRoot,
      frameworkRepositoryRoot,
      sourceRepositoryKind,
      rows: rows.length,
      failed,
      minQuality,
      qualityThresholds,
      terminalWindows,
      validationSplit,
      testSplit,
      partitionMode: exactCalendarPartitions ? 'exact-calendar' : 'ratio',
      tuningSince: exactCalendarPartitions
        ? new Date(tuningSince).toISOString()
        : null,
      testSince: exactCalendarPartitions
        ? new Date(testSince).toISOString()
        : null,
      capacities,
      maxLossValue,
      trainRows: split.train.length,
      tuningRows: split.tuning.length,
      testRows: split.test.length,
      trainEvents: new Set(split.train.map((row) => row.timestamp)).size,
      tuningEvents: new Set(split.tuning.map((row) => row.timestamp)).size,
      testEvents: new Set(split.test.map((row) => row.timestamp)).size,
      partitions: {
        train: partitionEvidence(split.train),
        tuning: partitionEvidence(split.tuning),
        test: partitionEvidence(split.test),
      },
      minTimestamp: new Date(minTimestamp).toISOString(),
      maxTimestamp: new Date(maxTimestamp).toISOString(),
      spanDays: (maxTimestamp - minTimestamp) / DAY_MS,
    },
    baseline,
    variants: variantReports,
    featureInventory,
  };
};

const formatNumber = (value, digits = 2) =>
  value == null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);
const formatPct = (value) =>
  value == null || !Number.isFinite(value)
    ? 'n/a'
    : `${(value * 100).toFixed(1)}%`;
const formatMetric = (summary) => ({
  n: summary.trades,
  wr: formatPct(summary.winRate),
  pnl: formatNumber(summary.totalProfit),
  pf: formatNumber(summary.profitFactor),
  sharpe: formatNumber(summary.sharpeRatio),
  sortino: formatNumber(summary.sortinoRatio),
  calmar: formatNumber(summary.calmarRatio),
  dd: formatNumber(summary.maxDrawdown),
  ddGross: formatPct(summary.maxDrawdownPctOfGrossProfit),
  ddPnl: formatPct(summary.maxDrawdownPctOfTotalProfit),
  strict: formatNumber(summary.largestLoss),
  streak: summary.maxLossStreak,
  losing: summary.losingMonths,
  cadence: formatNumber(summary.cadencePerDay, 3),
});

const escapeCell = (value) =>
  String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const markdownTable = (headers, rows) =>
  [
    `| ${headers.map(escapeCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');

const comparisonRow = (label, baseline, candidate) => {
  const left = formatMetric(baseline);
  const right = formatMetric(candidate);
  return [
    label,
    `${left.n} -> ${right.n}`,
    `${left.wr} -> ${right.wr}`,
    `${left.pnl} -> ${right.pnl}`,
    `${left.pf} -> ${right.pf}`,
    `${left.sharpe} -> ${right.sharpe}`,
    `${left.sortino} -> ${right.sortino}`,
    `${left.calmar} -> ${right.calmar}`,
    `${left.dd} -> ${right.dd}`,
    `${left.ddGross} -> ${right.ddGross}`,
    `${left.ddPnl} -> ${right.ddPnl}`,
    `${left.strict} -> ${right.strict}`,
    `${left.streak} -> ${right.streak}`,
    `${left.losing} -> ${right.losing}`,
    `${left.cadence} -> ${right.cadence}`,
  ];
};

const summaryRows = (summary) => {
  const value = formatMetric(summary);
  return [
    value.n,
    value.wr,
    value.pnl,
    value.pf,
    value.sharpe,
    value.sortino,
    value.calmar,
    value.dd,
    value.ddGross,
    value.ddPnl,
    value.strict,
    value.streak,
    value.losing,
    value.cadence,
    summary.uniqueTimestamps,
  ];
};

const fanoutRows = (periods) =>
  Object.entries(periods).map(([period, summary]) => [
    period,
    formatNumber(summary.cadencePerDay, 3),
    formatNumber(summary.eventsPerDay, 3),
    formatPct(summary.activeDayRatio),
    summary.events,
    formatNumber(summary.tradesPerEvent, 2),
    summary.p95Batch ?? 0,
    summary.maxBatch,
    formatPct(summary.topEventCountShare),
    formatPct(summary.topEventPnlShare),
  ]);

const capacityRows = (periods) =>
  Object.entries(periods).flatMap(([period, summary]) =>
    Object.values(summary.capacityStress).map((stress) => [
      period,
      stress.capacity,
      stress.accepted,
      stress.overflow,
      stress.overflowEvents,
      formatNumber(stress.maxSimultaneousStopRisk),
    ]),
  );

const fanoutComparisonRow = (label, baseline, candidate) => [
  label,
  `${formatNumber(baseline.cadencePerDay, 3)} -> ${formatNumber(candidate.cadencePerDay, 3)}`,
  `${formatNumber(baseline.eventsPerDay, 3)} -> ${formatNumber(candidate.eventsPerDay, 3)}`,
  `${formatPct(baseline.activeDayRatio)} -> ${formatPct(candidate.activeDayRatio)}`,
  `${baseline.events} -> ${candidate.events}`,
  `${formatNumber(baseline.tradesPerEvent)} -> ${formatNumber(candidate.tradesPerEvent)}`,
  `${baseline.p95Batch ?? 0} -> ${candidate.p95Batch ?? 0}`,
  `${baseline.maxBatch} -> ${candidate.maxBatch}`,
  `${formatPct(baseline.topEventCountShare)} -> ${formatPct(candidate.topEventCountShare)}`,
  `${formatPct(baseline.topEventPnlShare)} -> ${formatPct(candidate.topEventPnlShare)}`,
];

const validationSummaryRow = (label, sourceRows, sourceEvents, summary) => {
  const value = formatMetric(summary);
  return [
    label,
    sourceRows,
    sourceEvents,
    value.n,
    summary.events,
    value.wr,
    value.pnl,
    value.pf,
    value.dd,
    summary.maxBatch,
  ];
};

const validationComparisonRow = (label, baseline, candidate) => {
  const left = formatMetric(baseline);
  const right = formatMetric(candidate);
  return [
    label,
    `${left.n} -> ${right.n}`,
    `${baseline.events} -> ${candidate.events}`,
    `${left.wr} -> ${right.wr}`,
    `${left.pnl} -> ${right.pnl}`,
    `${left.pf} -> ${right.pf}`,
    `${left.sharpe} -> ${right.sharpe}`,
    `${left.sortino} -> ${right.sortino}`,
    `${left.calmar} -> ${right.calmar}`,
    `${left.dd} -> ${right.dd}`,
    `${left.ddGross} -> ${right.ddGross}`,
    `${left.ddPnl} -> ${right.ddPnl}`,
    `${left.strict} -> ${right.strict}`,
    `${left.streak} -> ${right.streak}`,
    `${left.losing} -> ${right.losing}`,
    `${left.cadence} -> ${right.cadence}`,
    `${baseline.maxBatch} -> ${candidate.maxBatch}`,
  ];
};

export const formatMarkdownReport = (report) => {
  const lines = [
    '# AI Gate Ablation Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Run',
    '',
    markdownTable(
      ['Field', 'Value'],
      [
        ['rows', report.run.rows],
        ['failed', report.run.failed],
        ['source_root', report.run.sourceRepositoryRoot ?? 'n/a'],
        ['source_kind', report.run.sourceRepositoryKind ?? 'n/a'],
        ['framework_root', report.run.frameworkRepositoryRoot ?? 'n/a'],
        ['range', `${report.run.minTimestamp} .. ${report.run.maxTimestamp}`],
        ['span_days', formatNumber(report.run.spanDays)],
        ['min_quality', report.run.minQuality],
        ['tuning_split', formatPct(report.run.validationSplit)],
        ['test_split', formatPct(report.run.testSplit)],
        ['train_rows', report.run.trainRows],
        ['tuning_rows', report.run.tuningRows],
        ['test_rows', report.run.testRows],
        ['train_events', report.run.trainEvents],
        ['tuning_events', report.run.tuningEvents],
        ['test_events', report.run.testEvents],
        ['capacities', report.run.capacities.join(',')],
        ['max_loss_value', formatNumber(report.run.maxLossValue)],
        [
          'terminal_windows',
          report.run.terminalWindows.map((value) => `${value}d`).join(','),
        ],
      ],
    ),
    '',
    '## Dataset Files',
    '',
    ...report.run.filePaths.map((filePath) => `- \`${filePath}\``),
    '',
  ];

  if (report.featureInventory.length) {
    lines.push(
      '## Feature Inventory',
      '',
      markdownTable(
        ['Feature', 'Count', 'Null', 'Numeric', 'Min', 'Max', 'Categories'],
        report.featureInventory.map((entry) => [
          entry.feature,
          entry.count,
          entry.nulls,
          entry.numericCount,
          formatNumber(entry.min, 6),
          formatNumber(entry.max, 6),
          entry.categories
            .map(({ value, count }) => `${value}:${count}`)
            .join(', '),
        ]),
      ),
      '',
    );
  }

  lines.push(
    '## Baseline',
    '',
    markdownTable(
      [
        'Period',
        'N',
        'WR',
        'PNL',
        'PF',
        'Sharpe',
        'Sortino',
        'Calmar',
        'MaxDD',
        'DD/Gross',
        'DD/PNL',
        'Strict Loss',
        'Loss Streak',
        'Losing Months',
        'Cadence/D',
      ],
      Object.entries(report.baseline.periods).map(([period, summary]) => [
        period,
        ...summaryRows(summary).slice(0, -1),
      ]),
    ),
    '',
    '### Baseline Cadence and Fan-out',
    '',
    markdownTable(
      [
        'Period',
        'Trades/D',
        'Events/D',
        'Active Days',
        'Events',
        'Trades/Event',
        'p95 Batch',
        'Max Batch',
        'Top Event Count',
        'Top Event PNL',
      ],
      fanoutRows(report.baseline.periods),
    ),
    '',
    '### Baseline Capacity Stress',
    '',
    markdownTable(
      [
        'Period',
        'Cap',
        'Accepted',
        'Overflow',
        'Overflow Events',
        'Max Stop Risk',
      ],
      capacityRows(report.baseline.periods),
    ),
    '',
    '### Baseline Validation',
    '',
    markdownTable(
      [
        'Partition',
        'Source Rows',
        'Source Events',
        'Approved N',
        'Approved Events',
        'WR',
        'PNL',
        'PF',
        'MaxDD',
        'Max Batch',
      ],
      [
        validationSummaryRow(
          'train',
          report.run.trainRows,
          report.run.trainEvents,
          report.baseline.train,
        ),
        validationSummaryRow(
          'tuning',
          report.run.tuningRows,
          report.run.tuningEvents,
          report.baseline.tuning,
        ),
        validationSummaryRow(
          'untouched test',
          report.run.testRows,
          report.run.testEvents,
          report.baseline.test,
        ),
      ],
    ),
    '',
  );

  for (const variant of report.variants) {
    lines.push(
      `## Variant: ${variant.name}`,
      '',
      `- mode: \`${variant.mode}${variant.quality == null ? '' : `@${variant.quality}`}\``,
      `- expression: \`${variant.expression}\``,
      '',
      '### Period Comparison',
      '',
      markdownTable(
        [
          'Period',
          'N',
          'WR',
          'PNL',
          'PF',
          'Sharpe',
          'Sortino',
          'Calmar',
          'MaxDD',
          'DD/Gross',
          'DD/PNL',
          'Strict Loss',
          'Loss Streak',
          'Losing Months',
          'Cadence/D',
        ],
        Object.keys(variant.periods).map((period) =>
          comparisonRow(
            period,
            report.baseline.periods[period],
            variant.periods[period],
          ),
        ),
      ),
      '',
      '### Cadence and Fan-out Comparison',
      '',
      markdownTable(
        [
          'Period',
          'Trades/D',
          'Events/D',
          'Active Days',
          'Events',
          'Trades/Event',
          'p95 Batch',
          'Max Batch',
          'Top Event Count',
          'Top Event PNL',
        ],
        Object.keys(variant.periods).map((period) =>
          fanoutComparisonRow(
            period,
            report.baseline.periods[period],
            variant.periods[period],
          ),
        ),
      ),
      '',
      '### Capacity Stress',
      '',
      markdownTable(
        [
          'Period',
          'Cap',
          'Accepted',
          'Overflow',
          'Overflow Events',
          'Max Stop Risk',
        ],
        capacityRows(variant.periods),
      ),
      '',
      '### Time Split',
      '',
      markdownTable(
        [
          'Split',
          'N',
          'Events',
          'WR',
          'PNL',
          'PF',
          'Sharpe',
          'Sortino',
          'Calmar',
          'MaxDD',
          'DD/Gross',
          'DD/PNL',
          'Strict Loss',
          'Loss Streak',
          'Losing Months',
          'Cadence/D',
          'Max Batch',
        ],
        [
          validationComparisonRow(
            'train',
            report.baseline.train,
            variant.train,
          ),
          validationComparisonRow(
            'tuning',
            report.baseline.tuning,
            variant.tuning,
          ),
          validationComparisonRow(
            'untouched test',
            report.baseline.test,
            variant.test,
          ),
        ],
      ),
      '',
      '### Quality Thresholds',
      '',
      markdownTable(
        [
          'Threshold',
          'N',
          'WR',
          'PNL',
          'PF',
          'Sharpe',
          'Sortino',
          'Calmar',
          'MaxDD',
          'DD/Gross',
          'DD/PNL',
          'Strict Loss',
          'Loss Streak',
          'Losing Months',
          'Cadence/D',
        ],
        Object.keys(variant.qualityThresholds).map((threshold) =>
          comparisonRow(
            threshold,
            report.baseline.qualityThresholds[threshold],
            variant.qualityThresholds[threshold],
          ),
        ),
      ),
      '',
      '### Direction',
      '',
      markdownTable(
        [
          'Direction',
          'N',
          'WR',
          'PNL',
          'PF',
          'Sharpe',
          'Sortino',
          'Calmar',
          'MaxDD',
          'DD/Gross',
          'DD/PNL',
          'Strict Loss',
          'Loss Streak',
          'Losing Months',
          'Cadence/D',
        ],
        Object.keys(variant.directions).map((direction) =>
          comparisonRow(
            direction,
            report.baseline.directions[direction] ?? summarizeRows([]),
            variant.directions[direction],
          ),
        ),
      ),
      '',
      '### Ablation Slices',
      '',
      markdownTable(
        [
          'Slice',
          'N',
          'WR',
          'PNL',
          'PF',
          'Sharpe',
          'Sortino',
          'Calmar',
          'MaxDD',
          'DD/Gross',
          'DD/PNL',
          'Strict Loss',
          'Loss Streak',
          'Losing Months',
          'Cadence/D',
          'Unique Timestamps',
        ],
        [
          ['rule matches', ...summaryRows(variant.matchedAll)],
          ['removed', ...summaryRows(variant.removed)],
          ['added', ...summaryRows(variant.added)],
        ],
      ),
      '',
      '### Monthly Stability',
      '',
      markdownTable(
        [
          'Month',
          'Baseline N',
          'Candidate N',
          'Baseline PNL',
          'Candidate PNL',
          'Candidate WR',
          'Candidate PF',
          'Candidate MaxDD',
        ],
        Object.keys(variant.months).map((month) => [
          month,
          report.baseline.months[month]?.trades ?? 0,
          variant.months[month].trades,
          formatNumber(report.baseline.months[month]?.totalProfit ?? 0),
          formatNumber(variant.months[month].totalProfit),
          formatPct(variant.months[month].winRate),
          formatNumber(variant.months[month].profitFactor),
          formatNumber(variant.months[month].maxDrawdown),
        ]),
      ),
      '',
      '### Slice Concentration',
      '',
      `- removed top symbols: ${variant.removed.topSymbols.map(({ symbol, count, pnl }) => `${symbol}:${count}/${formatNumber(pnl)}`).join(', ') || 'none'}`,
      `- added top symbols: ${variant.added.topSymbols.map(({ symbol, count, pnl }) => `${symbol}:${count}/${formatNumber(pnl)}`).join(', ') || 'none'}`,
      '',
    );
  }

  return `${lines.join('\n')}\n`;
};

const crossPartitionCell = (summary) =>
  `${summary.events}/${formatNumber(summary.totalProfit)}/${formatNumber(summary.profitFactor)}`;

const crossCandidateRows = (candidates) =>
  candidates
    .slice(0, 5)
    .map((candidate, index) => [
      index + 1,
      candidate.condition,
      crossPartitionCell(candidate.train),
      crossPartitionCell(candidate.tuning),
      candidate.test.trades,
      candidate.test.events,
      formatPct(candidate.test.winRate),
      formatNumber(candidate.test.profitFactor),
      formatNumber(candidate.test.totalProfit),
      formatPct(candidate.test.selectionRatio),
      `${candidate.test.complement.events}/${formatNumber(candidate.test.complement.normalizedProfit)}/${formatNumber(candidate.test.complement.profitFactor)}`,
      `${candidate.test.signCorrectStrategies}/${candidate.test.supportedStrategies}`,
      formatPct(candidate.test.topStrategyCountShare),
      formatPct(candidate.test.topEventCountShare),
      `${candidate.negativeControl.signCorrectRuns}/${candidate.negativeControl.runs}`,
      candidate.passes ? 'PASS' : 'FAIL',
    ]);

const crossCandidateTable = (candidates) =>
  candidates.length
    ? markdownTable(
        [
          '#',
          'Condition',
          'Train E/LU/PF',
          'Tuning E/LU/PF',
          'Test N',
          'Test events',
          'Test WR',
          'Test PF',
          'Test LU',
          'Selected',
          'Kept E/LU/PF',
          'Good/covered strategies',
          'Top strategy count',
          'Top event count',
          'Shift control',
          'Checks',
        ],
        crossCandidateRows(candidates),
      )
    : 'No candidates survived train/tuning search.';

const crossStrategyRows = (candidate) =>
  candidate.test.strategies.map((entry) => [
    entry.strategy,
    entry.rows,
    entry.events,
    formatPct(entry.winRate),
    formatNumber(entry.profitFactor),
    formatNumber(entry.normalizedProfit),
    formatNumber(entry.rawProfit),
  ]);

export const formatCrossStrategyMarkdown = (report) => {
  const lines = [
    '# Profiled Cross-Strategy Pocket Feasibility',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'This is retrospective saved-snapshot pocket discovery, not a current qN+ gate replay. PnL search values are normalized loss units (LU). The historical test tail is exposed by this report and is not future untouched evidence.',
    '',
    '## Run',
    '',
    markdownTable(
      ['Field', 'Value'],
      [
        ['strategies', report.run.strategies],
        [
          'overlap',
          `${report.run.overlap.minTimestamp} .. ${report.run.overlap.maxTimestamp}`,
        ],
        ['scanned_rows', report.run.scanned],
        ['feature_scan_rows', report.run.featureScanRows],
        ['overlap_rows', report.run.overlapRows],
        ['independent_events', report.run.uniqueEvents],
        [
          'failed_rows',
          `metadata=${report.run.failed.metadataPass}, features=${report.run.failed.featurePass}`,
        ],
        ['tuning_split', formatPct(report.run.validationSplit)],
        ['test_split', formatPct(report.run.testSplit)],
        ['feature_strategy_floor', report.run.minFeatureStrategies],
        [
          'shared_pocket_strategy_floor',
          report.run.acceptance.minSharedStrategies,
        ],
        [
          'approval_portfolio_capacity',
          report.run.acceptance.portfolioCapacity,
        ],
        [
          'universal_train_coverage_floor',
          formatPct(report.run.featureCoverage.universal),
        ],
        [
          'benchmark_train_coverage_floor',
          formatPct(report.run.featureCoverage.benchmarkReference),
        ],
        [
          'feature_eligibility',
          report.run.featureCoverage.eligibilityPartition,
        ],
        ['normalization', report.run.normalization],
        [
          'discovery_balance',
          `${report.run.discoveryBalance.maxRowsPerStrategy}/strategy, ${report.run.discoveryBalance.maxRowsPerEvent}/strategy-event`,
        ],
      ],
    ),
    '',
    '## Dataset Lineage',
    '',
    markdownTable(
      [
        'Strategy',
        'Merge',
        'Parts',
        'Rows in overlap',
        'Train loss scale',
        'Export range',
      ],
      report.datasets.map((dataset) => [
        dataset.strategy,
        dataset.mergeId,
        dataset.parts,
        dataset.overlapRows,
        formatNumber(dataset.trainLossScale),
        `${new Date(dataset.range.minTimestamp).toISOString()} .. ${new Date(dataset.range.maxTimestamp).toISOString()}`,
      ]),
    ),
    '',
    '## Global Time Partitions',
    '',
    markdownTable(
      ['Partition', 'Events', 'Range'],
      ['train', 'tuning', 'test'].map((partition) => {
        const value = report.run.partitions[partition];
        return [
          partition,
          value?.events ?? 0,
          value ? `${value.minTimestamp} .. ${value.maxTimestamp}` : 'n/a',
        ];
      }),
    ),
    '',
    '## Feature Policy',
    '',
    'Normalized target/setup fields and normalized benchmark/reference/global fields are searched separately. Freshness and coverage fields are eligibility guards only. Raw absolute levels remain visible in the audit with their required causal transform; derived policy composites are audited but not searched.',
    '',
    'Benchmark/reference snapshots use within-strategy consensus followed by cross-strategy consensus. Acceptance then applies the same snapshot to every signal in that timestamp-direction event; approval fan-out is capped by the configured portfolio capacity.',
    '',
    markdownTable(
      ['Bucket', 'Features', 'Search'],
      [
        ['universal', 'per direction below', 'yes'],
        ['benchmarkReference', 'per direction below', 'yes, event-level'],
        ['dataQuality', report.audits.dataQuality.length, 'guard only'],
        [
          'rawNonstationary',
          report.audits.rawNonstationary.length,
          'audit only',
        ],
        ['derivedPolicy', report.audits.derivedPolicy.length, 'audit only'],
        ['metadata', report.audits.metadata.length, 'lineage only'],
      ],
    ),
    '',
  ];

  for (const profile of CROSS_SEARCH_PROFILE_NAMES) {
    const profileResult = report.profiles[profile];
    lines.push(`## Profile: ${profile}`, '', profileResult.description, '');
    for (const direction of ['LONG', 'SHORT']) {
      const result = profileResult.directions[direction];
      lines.push(
        `### ${profile} / ${direction}`,
        '',
        markdownTable(
          ['Partition', 'Rows', 'Events'],
          ['train', 'tuning', 'test'].map((partition) => [
            partition,
            result.rows[partition],
            result.events[partition],
          ]),
        ),
        '',
        `Eligible train features: ${result.features.length}; discovery unit: ${result.discoveryUnit}. Discovery rows: train ${result.discoveryRows.train}, tuning ${result.discoveryRows.tuning}; predicates ${result.searchStats.predicates}, combinations ${result.searchStats.combinationsEvaluated}${result.searchStats.truncated ? ' (truncated)' : ''}.`,
        '',
        markdownTable(
          [
            'Feature',
            'Scope',
            'Train strategies',
            'Train rows',
            'Train coverage',
            'Tuning coverage',
            'Test coverage',
          ],
          result.features
            .slice(0, 80)
            .map((entry) => [
              entry.feature,
              entry.scope,
              entry.trainStrategies,
              entry.trainRows,
              formatPct(entry.partitionCoverage.train.coverage),
              formatPct(entry.partitionCoverage.tuning.coverage),
              formatPct(entry.partitionCoverage.test.coverage),
            ]),
        ),
        '',
        `#### ${direction} approval pockets`,
        '',
        crossCandidateTable(result.approve),
        '',
        `#### ${direction} block pockets`,
        '',
        crossCandidateTable(result.block),
        '',
      );

      if (result.featureConsistency) {
        const consistencyRows = Object.entries(
          result.featureConsistency,
        ).flatMap(([partition, entries]) =>
          entries
            .filter((entry) => entry.conflictEvents > 0)
            .slice(0, 20)
            .map((entry) => [
              partition,
              entry.feature,
              entry.observedEvents,
              entry.consensusEvents,
              entry.conflictEvents,
              entry.intraStrategyConflictEvents,
              entry.crossStrategyConflictEvents,
            ]),
        );
        lines.push(
          `#### ${direction} benchmark snapshot consistency`,
          '',
          markdownTable(
            [
              'Partition',
              'Feature',
              'Observed events',
              'Consensus',
              'Conflicts',
              'Intra-strategy conflicts',
              'Cross-strategy conflicts',
            ],
            consistencyRows,
          ),
          '',
        );
      }

      for (const [kind, candidates] of [
        ['approval', result.approve],
        ['block', result.block],
      ]) {
        const candidate = candidates[0];
        if (!candidate) continue;
        lines.push(
          `#### ${direction} top ${kind}: per-strategy historical test`,
          '',
          `Condition: \`${candidate.condition}\``,
          '',
          markdownTable(
            ['Slice', 'Rows', 'Events', 'WR', 'PF', 'LU', 'LU/event'],
            [
              [
                'selected',
                candidate.test.trades,
                candidate.test.events,
                formatPct(candidate.test.winRate),
                formatNumber(candidate.test.profitFactor),
                formatNumber(candidate.test.totalProfit),
                formatNumber(
                  candidate.test.events
                    ? candidate.test.totalProfit / candidate.test.events
                    : null,
                ),
              ],
              [
                'kept complement',
                candidate.test.complement.rows,
                candidate.test.complement.events,
                formatPct(candidate.test.complement.winRate),
                formatNumber(candidate.test.complement.profitFactor),
                formatNumber(candidate.test.complement.normalizedProfit),
                formatNumber(candidate.test.complement.profitPerEvent),
              ],
            ],
          ),
          '',
          markdownTable(
            ['Strategy', 'N', 'Events', 'WR', 'PF', 'LU', 'Raw PnL'],
            crossStrategyRows(candidate),
          ),
          '',
          'Acceptance checks:',
          '',
          markdownTable(
            ['Check', 'Status'],
            Object.entries(candidate.checks).map(([check, passed]) => [
              check,
              passed ? 'PASS' : 'FAIL',
            ]),
          ),
          '',
        );
      }
    }
  }

  lines.push(
    '## Data-Quality Guard Audit',
    '',
    markdownTable(
      ['Feature', 'Scope', 'Coverage', 'True rate', 'Min', 'Max'],
      report.audits.dataQuality
        .slice(0, 100)
        .map((entry) => [
          entry.feature,
          entry.scope,
          formatPct(entry.coverage),
          formatPct(entry.trueRate),
          formatNumber(entry.numericMin),
          formatNumber(entry.numericMax),
        ]),
    ),
    '',
    '## Raw / Nonstationary Audit',
    '',
    markdownTable(
      ['Feature', 'Scope', 'Coverage', 'Required transform'],
      report.audits.rawNonstationary
        .slice(0, 120)
        .map((entry) => [
          entry.feature,
          entry.scope,
          formatPct(entry.coverage),
          entry.transform,
        ]),
    ),
    '',
    '## Existing Derived-Policy Audit',
    '',
    markdownTable(
      ['Feature', 'Coverage', 'Reason'],
      report.audits.derivedPolicy
        .slice(0, 80)
        .map((entry) => [
          entry.feature,
          formatPct(entry.coverage),
          entry.reason,
        ]),
    ),
    '',
  );

  const passing = CROSS_SEARCH_PROFILE_NAMES.flatMap((profile) =>
    ['LONG', 'SHORT'].flatMap((direction) =>
      ['approve', 'block'].map((kind) => ({
        profile,
        direction,
        kind,
        count: report.profiles[profile].directions[direction][kind].filter(
          (candidate) => candidate.passes,
        ).length,
      })),
    ),
  );
  lines.push(
    '## Feasibility Verdict',
    '',
    markdownTable(
      ['Profile', 'Direction', 'Pocket type', 'Passing all checks'],
      passing.map((entry) => [
        entry.profile,
        entry.direction,
        entry.kind,
        entry.count,
      ]),
    ),
    '',
    'The five circular-shift checks are fixed-pocket diagnostics, not family-wise permutation proof. Any PASS remains research-only until the exact rule survives an export strictly after this report cutoff and live-env lineage checks.',
    '',
  );
  return `${lines.join('\n')}\n`;
};

const printGroups = (groups, projectRoot) => {
  for (const group of groups) {
    console.log(
      `${group.strategyToken} merge=${group.mergeId} shards=${group.files.length}`,
    );
    for (const filePath of group.files) {
      console.log(`  ${path.relative(projectRoot, filePath)}`);
    }
  }
};

export const main = async () => {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  const projectRoot = resolveArtifactProjectRoot();
  const outDir = path.resolve(projectRoot, options.outDir);
  if (options.list) {
    const groups = await listDatasetGroups(outDir);
    const strategyToken = normalizeStrategyToken(options.strategy);
    printGroups(
      strategyToken
        ? groups.filter(
            (group) =>
              normalizeStrategyToken(group.strategyToken) === strategyToken,
          )
        : groups,
      projectRoot,
    );
    return;
  }
  const sourceRepositoryRoot = findSourceRepositoryRoot();
  const sourceRepositoryKind = getSourceRepositoryKind(sourceRepositoryRoot);
  const frameworkRepositoryRoot = findFrameworkRepositoryRoot(
    sourceRepositoryRoot,
  );
  if (options.crossStrategy) {
    if (options.tuningSince != null || options.testSince != null) {
      throw new Error(
        '--tuningSince/--testSince are supported by candidate ablation only',
      );
    }
    const groups = latestDatasetGroupsByStrategy(
      await listDatasetGroups(outDir),
    );
    const report = await buildCrossStrategyReport({
      projectRoot,
      sourceRepositoryRoot,
      frameworkRepositoryRoot,
      groups,
      validationSplit: options.validationSplit,
      testSplit: options.testSplit,
      maxDepth: options.maxDepth,
      minSupport: options.minSupport,
      minValidationSupport: options.minValidationSupport,
      maxAtomicPredicates: options.maxAtomicPredicates,
      maxCombinations: options.maxCombinations,
      top: options.top,
      maxRowsPerStrategy: options.maxRowsPerStrategy,
      maxRowsPerEvent: options.maxRowsPerEvent,
      minFeatureStrategies: options.minFeatureStrategies,
      minFeatureCoverage: options.minFeatureCoverage,
      minBenchmarkFeatureCoverage: options.minBenchmarkFeatureCoverage,
      portfolioCapacity: options.portfolioCapacity,
    });
    const markdown = formatCrossStrategyMarkdown(report);
    const output = options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : markdown;
    if (options.output) {
      const outputPath = path.resolve(projectRoot, options.output);
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(
        outputPath,
        outputPath.endsWith('.json')
          ? `${JSON.stringify(report, null, 2)}\n`
          : markdown,
        'utf8',
      );
      console.error(`report: ${path.relative(projectRoot, outputPath)}`);
    }
    process.stdout.write(output);
    return;
  }
  let variants = await loadVariants(options.variants, options.spec);
  if (options.movingAverageStudy && variants.length) {
    throw new Error(
      '--movingAverageStudy cannot be combined with --variant or --spec',
    );
  }
  if (
    !variants.length &&
    !options.featurePattern &&
    !options.movingAverageStudy
  ) {
    console.error('No variants supplied; printing current baseline only.');
  }
  const filePaths = await resolveDatasetFiles({
    projectRoot,
    outDir: options.outDir,
    file: options.file,
    strategy: options.strategy,
  });
  let featurePattern = null;
  if (options.featurePattern) {
    try {
      featurePattern = new RegExp(options.featurePattern, 'i');
    } catch (error) {
      throw new Error(`Invalid --featurePattern: ${error.message}`);
    }
  }
  const loaded = await loadResearchRows({
    projectRoot,
    sourceRepositoryRoot,
    frameworkRepositoryRoot,
    filePaths,
    variants: options.movingAverageStudy ? [] : variants,
    minQuality: options.minQuality,
    includeGateContext: options.includeGateContext,
    featurePattern,
  });
  let movingAverageCoverage = null;
  if (options.movingAverageStudy) {
    movingAverageCoverage = await loadMovingAverageStudyFeatures({
      projectRoot,
      rows: loaded.rows,
      periods: options.maPeriods,
      lookbackBars: options.maLookbackBars,
      batchSize: options.maBatchSize,
      sqlTimeoutMs: options.maSqlTimeoutMs,
    });
    variants = buildMovingAverageVariants(options.maPeriods);
    for (const row of loaded.rows) {
      row.variantMatches = variants.map((variant) => variant.match(row));
    }
  }
  const report = buildAblationReport({
    ...loaded,
    variants,
    minQuality: options.minQuality,
    qualityThresholds: options.qualityThresholds,
    terminalWindows: options.terminalWindows,
    validationSplit: options.validationSplit,
    testSplit: options.testSplit,
    tuningSince: options.tuningSince,
    testSince: options.testSince,
    capacities: options.capacities,
    maxLossValue: options.maxLossValue,
    sourceRepositoryRoot,
    frameworkRepositoryRoot,
    sourceRepositoryKind,
    filePaths: filePaths.map((filePath) =>
      path.relative(projectRoot, filePath),
    ),
  });
  if (options.movingAverageStudy) {
    report.movingAverageStudy = summarizeMovingAverageStudy({
      rows: loaded.rows,
      periods: options.maPeriods,
      variants,
      report,
      coverage: movingAverageCoverage,
    });
  }
  const markdown = formatMarkdownReport(report);
  const output = options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : markdown;
  if (options.output) {
    const outputPath = path.resolve(projectRoot, options.output);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(
      outputPath,
      outputPath.endsWith('.json')
        ? `${JSON.stringify(report, null, 2)}\n`
        : markdown,
      'utf8',
    );
    console.error(`report: ${path.relative(projectRoot, outputPath)}`);
  }
  process.stdout.write(output);
};

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
