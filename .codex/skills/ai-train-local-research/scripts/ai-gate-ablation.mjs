#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOWS = [180, 90, 30, 7];
const DEFAULT_QUALITY_THRESHOLDS = [3, 4, 5];
const VARIANT_MODES = new Set(['filter', 'exclude', 'add', 'replace']);

const usage = `Usage:
  node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs [options]

Options:
  --file <path>                 Any shard from a merged AI export
  --strategy <name>            Latest merged export for this strategy token
  --outDir <path>              Dataset directory (default: data/ai/export)
  --variant <spec>             name::mode[@quality]::expression (repeatable)
  --spec <path>                JSON file with a { "variants": [...] } array
  --minQuality <n>             Main baseline threshold (default: 4)
  --qualityThresholds <list>   qN+ summaries (default: 3,4,5)
  --terminalWindows <list>     Terminal windows in days (default: 180,90,30,7)
  --validationSplit <ratio>    Trailing time holdout (default: 0.25)
  --featurePattern <regex>     Inventory matching causal feature paths
  --includeGateContext         Include current gate output fields for audits only
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
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.trunc(value));
  return values.length ? [...new Set(values)] : fallback;
};

export const parseCliArgs = (argv) => {
  const options = {
    outDir: 'data/ai/export',
    minQuality: 4,
    qualityThresholds: DEFAULT_QUALITY_THRESHOLDS,
    terminalWindows: DEFAULT_WINDOWS,
    validationSplit: 0.25,
    variants: [],
    includeGateContext: false,
    json: false,
    list: false,
    help: false,
  };
  const booleanOptions = new Set([
    'includeGateContext',
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

const findProjectRootFrom = (startPath) => {
  let current = path.resolve(startPath);
  while (true) {
    if (
      fs.existsSync(path.join(current, 'package.json')) &&
      fs.existsSync(path.join(current, 'packages', 'node')) &&
      fs.existsSync(path.join(current, 'packages', 'cli'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

export const findProjectRoot = () => {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const root =
    findProjectRootFrom(process.cwd()) ?? findProjectRootFrom(scriptDirectory);
  if (!root) {
    throw new Error(
      'TradeJS project root was not found. Run from the repository.',
    );
  }
  return root;
};

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
    const explicitPath = path.resolve(process.cwd(), file);
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
  const [mode, qualityInput] = modeInput.split('@');
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
    variants.push(
      parseVariant(
        `${entry.name}::${entry.mode}${qualitySuffix}::${entry.expression}`,
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

export const summarizeRows = (rows, denominatorDays = getPeriodDays(rows)) => {
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
  const timestamps = new Set();

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
    timestamps.add(row.timestamp);
  }

  const losingMonthValues = [...months.entries()]
    .filter(([, pnl]) => pnl < 0)
    .map(([month, pnl]) => ({ month, pnl }));
  const topSymbols = [...symbols.entries()]
    .map(([symbol, value]) => ({ symbol, ...value }))
    .sort((left, right) => right.count - left.count || right.pnl - left.pnl)
    .slice(0, 10);

  return {
    trades: rows.length,
    wins,
    losses,
    winRate: rows.length ? wins / rows.length : null,
    totalProfit,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averageTrade: rows.length ? totalProfit / rows.length : null,
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
    recoveryFactor: maxDrawdown > 0 ? totalProfit / maxDrawdown : null,
    ulcerIndex: rows.length ? Math.sqrt(drawdownSquares / rows.length) : null,
    largestLoss,
    maxLossStreak,
    losingMonths: losingMonthValues.length,
    losingMonthValues,
    cadencePerDay: rows.length / Math.max(denominatorDays, 1),
    cadencePerWeek: (rows.length / Math.max(denominatorDays, 1)) * 7,
    averageProfitPerDay: totalProfit / Math.max(denominatorDays, 1),
    averageProfitPerMonth:
      (totalProfit / Math.max(denominatorDays, 1)) * 30.4375,
    uniqueTimestamps: timestamps.size,
    directionCounts: Object.fromEntries(directions),
    topSymbols,
  };
};

export const isVariantSelected = ({
  variant,
  baselineSelected,
  matches,
  threshold,
  defaultQuality,
}) => {
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
}) => {
  const result = {
    full: summarizeRows(
      selectRows(rows, selector),
      Math.max((maxTimestamp - minTimestamp) / DAY_MS, 1),
    ),
  };
  for (const days of windows) {
    const from = maxTimestamp - days * DAY_MS;
    result[`${days}d`] = summarizeRows(
      selectRows(rows, (row) => row.timestamp >= from && selector(row)),
      days,
    );
  }
  return result;
};

const splitRows = (rows, validationSplit) => {
  if (validationSplit <= 0 || rows.length < 2) {
    return { train: rows, validation: [] };
  }
  const validationCount = Math.max(
    1,
    Math.min(rows.length - 1, Math.floor(rows.length * validationSplit)),
  );
  return {
    train: rows.slice(0, rows.length - validationCount),
    validation: rows.slice(rows.length - validationCount),
  };
};

const summarizeSplit = (rows, selector) =>
  summarizeRows(selectRows(rows, selector), getPeriodDays(rows));

const summarizeDirections = (rows, selector) =>
  Object.fromEntries(
    [...new Set(rows.map((row) => row.direction))].sort().map((direction) => [
      direction,
      summarizeRows(
        selectRows(rows, (row) => row.direction === direction && selector(row)),
        getPeriodDays(rows),
      ),
    ]),
  );

const summarizeMonths = (rows, selector) => {
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

const readDatasetStrategy = async (filePath) => {
  const reader = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    return row.payload?.signal?.strategy ?? row.strategyName ?? null;
  }
  return null;
};

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

const ensureRuntimeBuild = async (projectRoot, strategyName) => {
  const aiModulePath = path.join(projectRoot, 'packages/node/dist/ai.mjs');
  const pocketModulePath = path.join(
    projectRoot,
    'packages/cli/dist/lib/aiPocketSearch.js',
  );
  const strategiesModulePath = path.join(
    projectRoot,
    'packages/strategies/dist/index.mjs',
  );
  const required = [aiModulePath, pocketModulePath, strategiesModulePath];
  for (const filePath of required) {
    try {
      await fsp.access(filePath);
    } catch {
      throw new Error(
        `Missing ${path.relative(projectRoot, filePath)}. Run yarn build first.`,
      );
    }
  }

  const freshnessChecks = [
    {
      output: aiModulePath,
      sources: [
        path.join(projectRoot, 'packages/node/src/ai.ts'),
        path.join(projectRoot, 'packages/node/src/aiMarketContext.ts'),
        path.join(projectRoot, 'packages/node/src/aiShared.ts'),
        path.join(projectRoot, 'packages/node/src/strategyAdapters'),
      ],
      command: 'yarn workspace @tradejs/node build',
    },
    {
      output: pocketModulePath,
      sources: [
        path.join(projectRoot, 'packages/cli/src/lib/aiPocketSearch.ts'),
      ],
      command: 'yarn workspace @tradejs/cli build',
    },
  ];
  if (strategyName) {
    freshnessChecks.push({
      output: strategiesModulePath,
      sources: [
        path.join(projectRoot, 'packages/strategies/src', strategyName),
      ],
      command: 'yarn workspace @tradejs/strategies build',
    });
  }
  for (const check of freshnessChecks) {
    const [outputStat, ...sourceMtimes] = await Promise.all([
      fsp.stat(check.output),
      ...check.sources.map(newestSourceMtime),
    ]);
    if (Math.max(0, ...sourceMtimes) > outputStat.mtimeMs) {
      throw new Error(
        `Stale ${path.relative(projectRoot, check.output)} for current sources. Run ${check.command}.`,
      );
    }
  }
  return { aiModulePath, pocketModulePath };
};

const loadResearchRows = async ({
  projectRoot,
  filePaths,
  variants,
  minQuality,
  includeGateContext,
  featurePattern,
}) => {
  const strategyName = await readDatasetStrategy(filePaths[0]);
  const { aiModulePath, pocketModulePath } = await ensureRuntimeBuild(
    projectRoot,
    strategyName,
  );
  const aiModule = await import(pathToFileURL(aiModulePath).href);
  const require = createRequire(import.meta.url);
  const { collectAiPocketFeatures } = require(pocketModulePath);
  await aiModule.ensureAiStrategyPluginsLoaded();

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
        updateFeatureInventory(featureInventory, features, featurePattern);
        const timestamp = Number(source.timestamp);
        const profit = Number(source.profit);
        const qualityValue = Number(analysis.quality);
        const quality = Number.isFinite(qualityValue)
          ? Math.round(qualityValue)
          : null;
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

export const buildAblationReport = ({
  rows,
  variants,
  minQuality,
  qualityThresholds,
  terminalWindows,
  validationSplit,
  filePaths,
  failed = 0,
  featureInventory = [],
}) => {
  if (!rows.length) throw new Error('No rows were evaluated');
  const minTimestamp = rows[0].timestamp;
  const maxTimestamp = rows.at(-1).timestamp;
  const split = splitRows(rows, validationSplit);
  const baselineSelector = (row) => baselineSelectedAt(row, minQuality);
  const baseline = {
    periods: buildPeriodSummaries({
      rows,
      selector: baselineSelector,
      windows: terminalWindows,
      minTimestamp,
      maxTimestamp,
    }),
    train: summarizeSplit(split.train, baselineSelector),
    validation: summarizeSplit(split.validation, baselineSelector),
    qualityThresholds: Object.fromEntries(
      qualityThresholds.map((threshold) => [
        `q${threshold}+`,
        summarizeRows(
          selectRows(rows, (row) => baselineSelectedAt(row, threshold)),
          getPeriodDays(rows),
        ),
      ]),
    ),
    directions: summarizeDirections(rows, baselineSelector),
    months: summarizeMonths(rows, baselineSelector),
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
      expression: variant.expression,
      periods: buildPeriodSummaries({
        rows,
        selector: candidateSelector,
        windows: terminalWindows,
        minTimestamp,
        maxTimestamp,
      }),
      train: summarizeSplit(split.train, candidateSelector),
      validation: summarizeSplit(split.validation, candidateSelector),
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
          ),
        ]),
      ),
      directions: summarizeDirections(rows, candidateSelector),
      months: summarizeMonths(rows, candidateSelector),
      matchedAll: summarizeRows(
        selectRows(rows, matchedSelector),
        getPeriodDays(rows),
      ),
      removed: summarizeRows(
        selectRows(rows, removedSelector),
        getPeriodDays(rows),
      ),
      added: summarizeRows(
        selectRows(rows, addedSelector),
        getPeriodDays(rows),
      ),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    run: {
      filePaths,
      rows: rows.length,
      failed,
      minQuality,
      qualityThresholds,
      terminalWindows,
      validationSplit,
      trainRows: split.train.length,
      validationRows: split.validation.length,
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
        ['range', `${report.run.minTimestamp} .. ${report.run.maxTimestamp}`],
        ['span_days', formatNumber(report.run.spanDays)],
        ['min_quality', report.run.minQuality],
        ['validation_split', formatPct(report.run.validationSplit)],
        ['train_rows', report.run.trainRows],
        ['validation_rows', report.run.validationRows],
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
      '### Time Split',
      '',
      markdownTable(
        [
          'Split',
          'N',
          'WR',
          'PNL',
          'PF',
          'MaxDD',
          'DD/Gross',
          'DD/PNL',
          'Strict Loss',
          'Loss Streak',
          'Losing Months',
          'Cadence/D',
        ],
        [
          comparisonRow('train', report.baseline.train, variant.train),
          comparisonRow(
            'validation',
            report.baseline.validation,
            variant.validation,
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
  const projectRoot = findProjectRoot();
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
  const variants = await loadVariants(options.variants, options.spec);
  if (!variants.length && !options.featurePattern) {
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
    filePaths,
    variants,
    minQuality: options.minQuality,
    includeGateContext: options.includeGateContext,
    featurePattern,
  });
  const report = buildAblationReport({
    ...loaded,
    variants,
    minQuality: options.minQuality,
    qualityThresholds: options.qualityThresholds,
    terminalWindows: options.terminalWindows,
    validationSplit: options.validationSplit,
    filePaths: filePaths.map((filePath) =>
      path.relative(projectRoot, filePath),
    ),
  });
  const markdown = formatMarkdownReport(report);
  const output = options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : markdown;
  if (options.output) {
    const outputPath = path.resolve(process.cwd(), options.output);
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
