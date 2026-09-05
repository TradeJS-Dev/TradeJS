import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import {
  assertStrategyExecutionIsolation,
  parseBacktestExecutionCosts,
} from '@tradejs/core/backtest';
import path from 'node:path';
import {
  CORE_RESEARCH_LEDGER_SCHEMA,
  CORE_RESEARCH_SCHEMA,
  type CoreResearchLedgerRecord,
  type CoreResearchResult,
  type CoreResearchSpec,
  type CoreResearchStageIndex,
} from './types';

const RESEARCH_ID_RE = /^[a-z0-9][a-z0-9._-]{2,120}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

type CoreResearchManifest = {
  schema: 'tradejs-core-research-manifest/v1';
  researchId: string;
  specSha256: string;
  status: 'prepared' | 'completed';
  createdAt: string;
  completedAt?: string;
  artifactHashes: Record<string, string>;
  selection?: Record<string, unknown>;
};

export const canonicalJson = (value: unknown): string => {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (current && typeof current === 'object') {
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return current;
  };

  return JSON.stringify(normalize(value));
};

export const sha256Text = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export const sha256Json = (value: unknown) => sha256Text(canonicalJson(value));

export const sha256File = async (filePath: string) => {
  const hash = createHash('sha256');
  const input = createReadStream(filePath);
  for await (const chunk of input) hash.update(chunk);
  return hash.digest('hex');
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid core research spec: ${message}`);
}

const assertFinite = (value: unknown, name: string) => {
  assert(typeof value === 'number' && Number.isFinite(value), name);
};

export const validateCoreResearchSpec = (value: unknown): CoreResearchSpec => {
  assert(value && typeof value === 'object', 'root must be an object');
  const spec = value as CoreResearchSpec;
  assert(
    spec.schema === CORE_RESEARCH_SCHEMA,
    `schema must be ${CORE_RESEARCH_SCHEMA}`,
  );
  assert(
    RESEARCH_ID_RE.test(spec.researchId),
    'researchId must be filesystem-safe',
  );
  assert(
    ['screen', 'isolated_long', 'confirmation'].includes(spec.stage),
    'stage must be screen, isolated_long, or confirmation',
  );
  assert(
    spec.stage === 'screen' || (spec.parentResearchIds?.length ?? 0) > 0,
    'isolated_long and confirmation stages require parentResearchIds',
  );
  if (spec.parentResearchIds) {
    assert(
      spec.parentResearchIds.every((id) => RESEARCH_ID_RE.test(id)),
      'parentResearchIds must contain filesystem-safe research IDs',
    );
  }
  assert(Boolean(spec.strategy?.trim()), 'strategy is required');
  assert(
    !Number.isNaN(Date.parse(spec.createdAt)),
    'createdAt must be ISO-8601',
  );
  assert(
    Boolean(spec.hypothesis?.family?.trim()),
    'hypothesis.family is required',
  );
  assert(
    Boolean(spec.hypothesis?.claim?.trim()),
    'hypothesis.claim is required',
  );
  assert(
    Boolean(spec.hypothesis?.mechanism?.trim()),
    'hypothesis.mechanism is required',
  );
  assert(
    ['ALL', 'LONG', 'SHORT'].includes(spec.hypothesis?.target),
    'hypothesis.target must be ALL, LONG, or SHORT',
  );
  assert(
    Array.isArray(spec.universe?.symbols) && spec.universe.symbols.length > 0,
    'universe.symbols is required',
  );
  assert(
    new Set(spec.universe.symbols).size === spec.universe.symbols.length,
    'universe.symbols must be unique',
  );
  assert(
    sha256Json(spec.universe.symbols) === spec.universe.sha256,
    'universe.sha256 does not match the ordered symbol array',
  );
  assert(
    SHA256_RE.test(spec.universe.sha256),
    'universe.sha256 must be a lowercase SHA-256',
  );
  assertFinite(spec.window?.start, 'window.start must be finite');
  assertFinite(spec.window?.end, 'window.end must be finite');
  assert(spec.window.end > spec.window.start, 'window.end must be after start');
  assert(
    Array.isArray(spec.window.terminalDays) &&
      spec.window.terminalDays.every(
        (days) => Number.isInteger(days) && days > 0,
      ),
    'window.terminalDays must contain positive integers',
  );
  assert(
    Number.isInteger(spec.window.folds) && spec.window.folds >= 2,
    'window.folds must be >= 2',
  );
  assert(
    Array.isArray(spec.variants) && spec.variants.length >= 2,
    'at least two variants are required',
  );
  assert(
    spec.variants.filter((variant) => variant.role === 'control').length === 1,
    'exactly one control is required',
  );
  assert(
    spec.variants.some((variant) => variant.role === 'candidate'),
    'at least one candidate is required',
  );
  assert(
    new Set(spec.variants.map((variant) => variant.id)).size ===
      spec.variants.length,
    'variant ids must be unique',
  );
  for (const variant of spec.variants) {
    if (variant.resolvedConfig)
      assertStrategyExecutionIsolation(variant.resolvedConfig);
    assert(
      RESEARCH_ID_RE.test(variant.id),
      `variant id ${variant.id} is invalid`,
    );
    assert(
      Boolean(variant.configName?.trim()),
      `variant ${variant.id} configName is required`,
    );
    assert(
      variant.resolvedConfig &&
        typeof variant.resolvedConfig === 'object' &&
        !Array.isArray(variant.resolvedConfig) &&
        Object.keys(variant.resolvedConfig).length > 0,
      `variant ${variant.id} resolvedConfig must be a non-empty object`,
    );
    assert(
      sha256Json(variant.resolvedConfig) === variant.configSha256,
      `variant ${variant.id} configSha256 does not match resolvedConfig`,
    );
    assert(
      SHA256_RE.test(variant.configSha256),
      `variant ${variant.id} configSha256 must be a lowercase SHA-256`,
    );
    assert(
      Array.isArray(variant.files),
      `variant ${variant.id} files must be an array`,
    );
    assert(
      variant.files.length > 0 ||
        (Array.isArray(variant.command) && variant.command.length > 0),
      `variant ${variant.id} needs files or a command`,
    );
    if (variant.runId != null) {
      assert(
        Boolean(variant.runId.trim()),
        `variant ${variant.id} runId is empty`,
      );
    }
  }
  assert(
    Number.isInteger(spec.selection?.minimumTrades) &&
      spec.selection.minimumTrades >= 0,
    'selection.minimumTrades must be non-negative',
  );
  assertFinite(
    spec.selection?.minimumCadencePerDay,
    'selection.minimumCadencePerDay must be finite',
  );
  assert(
    spec.selection.minimumCadencePerDay >= 0,
    'selection.minimumCadencePerDay must be non-negative',
  );
  const allowedMetrics = new Set([
    'pnl',
    'pnlPerTrade',
    'profitFactor',
    'winRatePct',
    'realizedMaxDrawdown',
    'cadencePerDay',
  ]);
  const allowedComparisons = new Set(['gt', 'gte', 'lt', 'lte']);
  for (const [name, rules] of Object.entries({
    targetRules: spec.selection.targetRules,
    aggregateRules: spec.selection.aggregateRules,
    nonTargetRules: spec.selection.nonTargetRules,
    terminalRules: spec.selection.terminalRules ?? [],
    costStressRules: spec.selection.costStressRules ?? [],
  })) {
    assert(Array.isArray(rules), `selection.${name} must be an array`);
    for (const rule of rules) {
      assert(
        allowedMetrics.has(rule.metric),
        `selection.${name} contains an unsupported metric`,
      );
      assert(
        allowedComparisons.has(rule.comparison),
        `selection.${name} contains an unsupported comparison`,
      );
      if (rule.value != null) {
        assertFinite(rule.value, `selection.${name} value must be finite`);
      }
    }
  }
  parseBacktestExecutionCosts(spec.execution?.costs);
  assertFinite(
    spec.execution?.maxLossValue,
    'execution.maxLossValue must be finite',
  );
  assert(
    spec.execution.maxLossValue > 0,
    'execution.maxLossValue must be positive',
  );
  assert(
    Number.isInteger(spec.robustness?.bootstrapIterations) &&
      spec.robustness.bootstrapIterations >= 100,
    'robustness.bootstrapIterations must be >= 100',
  );
  assert(
    spec.robustness.confidenceLevel > 0 && spec.robustness.confidenceLevel < 1,
    'robustness.confidenceLevel must be in (0, 1)',
  );
  assert(
    Number.isInteger(spec.robustness.clusterDays) &&
      spec.robustness.clusterDays > 0,
    'robustness.clusterDays must be positive',
  );
  assert(
    Number.isInteger(spec.robustness.minimumFoldTrades) &&
      spec.robustness.minimumFoldTrades >= 0,
    'robustness.minimumFoldTrades must be a non-negative integer',
  );
  if (spec.selection.maximumPortfolioDrawdownRegressionPct != null) {
    assert(
      Number.isFinite(spec.selection.maximumPortfolioDrawdownRegressionPct) &&
        spec.selection.maximumPortfolioDrawdownRegressionPct >= 0,
      'selection.maximumPortfolioDrawdownRegressionPct must be non-negative',
    );
  }
  if (spec.selection.maximumHolmPValue != null) {
    assert(
      spec.selection.maximumHolmPValue >= 0 &&
        spec.selection.maximumHolmPValue <= 1,
      'selection.maximumHolmPValue must be in [0, 1]',
    );
  }
  if (spec.selection.minimumPositiveFoldPct != null) {
    assert(
      spec.selection.minimumPositiveFoldPct >= 0 &&
        spec.selection.minimumPositiveFoldPct <= 100,
      'selection.minimumPositiveFoldPct must be in [0, 100]',
    );
  }
  assert(
    Array.isArray(spec.robustness.costStressBps) &&
      spec.robustness.costStressBps.every(
        (entry) => Number.isFinite(entry) && entry >= 0,
      ),
    'robustness.costStressBps must contain non-negative finite values',
  );
  assert(
    Boolean(spec.artifacts?.rootDir?.trim()),
    'artifacts.rootDir is required',
  );
  assert(
    Boolean(spec.artifacts?.ledgerPath?.trim()),
    'artifacts.ledgerPath is required',
  );
  return spec;
};

export const loadCoreResearchSpec = async (specPath: string) => {
  const resolvedPath = path.resolve(specPath);
  const parsed = JSON.parse(await fs.readFile(resolvedPath, 'utf8')) as unknown;
  const spec = validateCoreResearchSpec(parsed);
  return { resolvedPath, spec, specSha256: sha256Json(spec) };
};

export const resolveCoreResearchPaths = (spec: CoreResearchSpec) => {
  const rootDir = path.resolve(spec.artifacts.rootDir);
  const researchDir = path.join(rootDir, spec.researchId);
  return {
    rootDir,
    researchDir,
    ledgerPath: path.resolve(spec.artifacts.ledgerPath),
    specPath: path.join(researchDir, 'spec.json'),
    manifestPath: path.join(researchDir, 'manifest.json'),
    resultPath: path.join(researchDir, 'result.json'),
    comparisonPath: path.join(researchDir, 'comparison.json'),
    matchesPath: path.join(researchDir, 'matches.csv'),
    tradesPath: path.join(researchDir, 'trades.jsonl'),
    reportPath: path.join(researchDir, 'report.html'),
    runLogDir: path.join(researchDir, 'runs'),
  };
};

export const writeJsonAtomic = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${canonicalJson(value)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
};

const buildLedgerRecordHash = (
  record: Omit<CoreResearchLedgerRecord, 'recordHash'>,
) => sha256Json(record);

export const readCoreResearchLedger = async (ledgerPath: string) => {
  let text = '';
  try {
    text = await fs.readFile(ledgerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as CoreResearchLedgerRecord;
      } catch (error) {
        throw new Error(
          `Invalid ledger JSON at line ${index + 1}: ${String(error)}`,
        );
      }
    });
};

export const verifyCoreResearchLedger = (
  records: CoreResearchLedgerRecord[],
) => {
  let previousHash: string | null = null;
  records.forEach((record, index) => {
    if (record.schema !== CORE_RESEARCH_LEDGER_SCHEMA) {
      throw new Error(`Ledger line ${index + 1} has unsupported schema`);
    }
    if (record.sequence !== index + 1) {
      throw new Error(`Ledger line ${index + 1} has invalid sequence`);
    }
    if (record.previousHash !== previousHash) {
      throw new Error(`Ledger line ${index + 1} breaks the hash chain`);
    }
    const { recordHash, ...payload } = record;
    if (buildLedgerRecordHash(payload) !== recordHash) {
      throw new Error(`Ledger line ${index + 1} has an invalid record hash`);
    }
    previousHash = recordHash;
  });
  return { records: records.length, head: previousHash };
};

export const appendCoreResearchLedger = async (params: {
  ledgerPath: string;
  researchId: string;
  event: CoreResearchLedgerRecord['event'];
  specSha256: string;
  hypothesisFamily: string;
  hypothesesInRecord?: number;
  artifactHashes?: Record<string, string>;
}) => {
  const { ledgerPath } = params;
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  const lockPath = `${ledgerPath}.lock`;
  let lock: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    lock = await fs.open(lockPath, 'wx');
    const records = await readCoreResearchLedger(ledgerPath);
    const verified = verifyCoreResearchLedger(records);
    const payload: Omit<CoreResearchLedgerRecord, 'recordHash'> = {
      schema: CORE_RESEARCH_LEDGER_SCHEMA,
      sequence: records.length + 1,
      recordedAt: new Date().toISOString(),
      researchId: params.researchId,
      event: params.event,
      specSha256: params.specSha256,
      hypothesisFamily: params.hypothesisFamily,
      hypothesesInRecord: params.hypothesesInRecord ?? 0,
      artifactHashes: params.artifactHashes ?? {},
      previousHash: verified.head,
    };
    const record: CoreResearchLedgerRecord = {
      ...payload,
      recordHash: buildLedgerRecordHash(payload),
    };
    await fs.appendFile(ledgerPath, `${canonicalJson(record)}\n`, 'utf8');
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Core research ledger is locked: ${ledgerPath}`);
    }
    throw error;
  } finally {
    await lock?.close();
    await fs.rm(lockPath, { force: true });
  }
};

export const validateCoreResearchParentLineage = async (
  spec: CoreResearchSpec,
) => {
  if (spec.stage === 'screen') return;
  const expectedParentStage =
    spec.stage === 'isolated_long' ? 'screen' : 'isolated_long';
  const rootDir = path.resolve(spec.artifacts.rootDir);
  const passedParentCandidateConfigShas = new Set<string>();
  for (const parentResearchId of spec.parentResearchIds ?? []) {
    const parentDir = path.join(rootDir, parentResearchId);
    const [parentSpec, parentManifest, parentResult] = await Promise.all([
      fs
        .readFile(path.join(parentDir, 'spec.json'), 'utf8')
        .then((text) => JSON.parse(text) as CoreResearchSpec),
      fs
        .readFile(path.join(parentDir, 'manifest.json'), 'utf8')
        .then((text) => JSON.parse(text) as CoreResearchManifest),
      fs
        .readFile(path.join(parentDir, 'result.json'), 'utf8')
        .then((text) => JSON.parse(text) as CoreResearchResult),
    ]);
    validateCoreResearchSpec(parentSpec);
    if (parentManifest.status !== 'completed') {
      throw new Error(`Parent research ${parentResearchId} is not completed`);
    }
    if (parentSpec.stage !== expectedParentStage) {
      throw new Error(
        `${spec.stage} requires a ${expectedParentStage} parent, found ${parentSpec.stage}`,
      );
    }
    if (parentSpec.hypothesis.family !== spec.hypothesis.family) {
      throw new Error(
        `Parent research ${parentResearchId} belongs to a different hypothesis family`,
      );
    }
    if (
      !parentResult.comparisons.some(
        (comparison) => comparison.selection.passed,
      )
    ) {
      throw new Error(
        `Parent research ${parentResearchId} has no candidate that passed selection`,
      );
    }
    for (const comparison of parentResult.comparisons.filter(
      (entry) => entry.selection.passed,
    )) {
      const candidate = parentResult.variants.find(
        (entry) => entry.variant.id === comparison.candidateId,
      );
      if (candidate) {
        passedParentCandidateConfigShas.add(candidate.variant.configSha256);
      }
    }
  }
  if (
    !spec.variants.some(
      (variant) =>
        variant.role === 'candidate' &&
        passedParentCandidateConfigShas.has(variant.configSha256),
    )
  ) {
    throw new Error(
      `${spec.stage} does not carry forward a passed parent candidate config SHA`,
    );
  }
};

export const prepareCoreResearch = async (spec: CoreResearchSpec) => {
  validateCoreResearchSpec(spec);
  await validateCoreResearchParentLineage(spec);
  const specSha256 = sha256Json(spec);
  const paths = resolveCoreResearchPaths(spec);
  await fs.mkdir(paths.researchDir, { recursive: true });
  let existing: CoreResearchSpec | null = null;
  let existingManifest: CoreResearchManifest | null = null;
  try {
    existing = JSON.parse(
      await fs.readFile(paths.specPath, 'utf8'),
    ) as CoreResearchSpec;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing && sha256Json(existing) !== specSha256) {
    throw new Error(
      `Research ${spec.researchId} is immutable and already has a different spec`,
    );
  }
  if (existing) {
    try {
      existingManifest = JSON.parse(
        await fs.readFile(paths.manifestPath, 'utf8'),
      ) as CoreResearchManifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (existingManifest) {
      return { paths, specSha256, manifest: existingManifest };
    }
  }
  await writeJsonAtomic(paths.specPath, spec);
  const manifest: CoreResearchManifest = {
    schema: 'tradejs-core-research-manifest/v1',
    researchId: spec.researchId,
    specSha256,
    status: 'prepared',
    createdAt: spec.createdAt,
    artifactHashes: {
      'spec.json': await sha256File(paths.specPath),
    },
  };
  await writeJsonAtomic(paths.manifestPath, manifest);
  if (!existing) {
    await appendCoreResearchLedger({
      ledgerPath: paths.ledgerPath,
      researchId: spec.researchId,
      event: 'prepared',
      specSha256,
      hypothesisFamily: spec.hypothesis.family,
      hypothesesInRecord: spec.variants.filter(
        (variant) => variant.role === 'candidate',
      ).length,
      artifactHashes: manifest.artifactHashes,
    });
  }
  return { paths, specSha256, manifest };
};

export const verifyCoreResearchArtifacts = async (spec: CoreResearchSpec) => {
  const paths = resolveCoreResearchPaths(spec);
  const manifest = JSON.parse(
    await fs.readFile(paths.manifestPath, 'utf8'),
  ) as {
    specSha256: string;
    artifactHashes: Record<string, string>;
  };
  if (manifest.specSha256 !== sha256Json(spec)) {
    throw new Error('Manifest spec hash does not match the supplied spec');
  }
  for (const [relativePath, expectedHash] of Object.entries(
    manifest.artifactHashes,
  )) {
    const actualHash = await sha256File(
      path.join(paths.researchDir, relativePath),
    );
    if (actualHash !== expectedHash) {
      throw new Error(`Artifact hash mismatch: ${relativePath}`);
    }
  }
  const ledger = verifyCoreResearchLedger(
    await readCoreResearchLedger(paths.ledgerPath),
  );
  return {
    researchId: spec.researchId,
    artifacts: Object.keys(manifest.artifactHashes).length,
    ledger,
  };
};

const scanCoreResearchStages = async (rootDir: string) => {
  const resolvedRoot = path.resolve(rootDir);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(resolvedRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        experiments:
          [] as CoreResearchStageIndex['families'][number]['experiments'],
        familyByResearch: new Map<string, string>(),
      };
    }
    throw error;
  }
  const experiments: CoreResearchStageIndex['families'][number]['experiments'] =
    [];
  const familyByResearch = new Map<string, string>();
  for (const entry of entries.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const researchDir = path.join(resolvedRoot, entry);
    const stats = await fs.stat(researchDir);
    if (!stats.isDirectory()) continue;
    let spec: CoreResearchSpec;
    let manifest: CoreResearchManifest;
    try {
      [spec, manifest] = await Promise.all([
        fs
          .readFile(path.join(researchDir, 'spec.json'), 'utf8')
          .then((text) => JSON.parse(text) as CoreResearchSpec),
        fs
          .readFile(path.join(researchDir, 'manifest.json'), 'utf8')
          .then((text) => JSON.parse(text) as CoreResearchManifest),
      ]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    validateCoreResearchSpec(spec);
    if (manifest.specSha256 !== sha256Json(spec)) {
      throw new Error(`Stage index found a spec hash mismatch for ${entry}`);
    }
    const result =
      manifest.status === 'completed'
        ? await fs
            .readFile(path.join(researchDir, 'result.json'), 'utf8')
            .then((text) => JSON.parse(text) as CoreResearchResult)
        : null;
    familyByResearch.set(spec.researchId, spec.hypothesis.family);
    experiments.push({
      researchId: spec.researchId,
      stage: spec.stage,
      parentResearchIds: spec.parentResearchIds ?? [],
      specSha256: manifest.specSha256,
      manifestStatus: manifest.status,
      passedCandidates:
        result?.comparisons
          .filter((comparison) => comparison.selection.passed)
          .map((comparison) => comparison.candidateId) ?? [],
      evidence: result?.evidence ?? null,
    });
  }
  for (const experiment of experiments) {
    for (const parentId of experiment.parentResearchIds) {
      const parentFamily = familyByResearch.get(parentId);
      const family = familyByResearch.get(experiment.researchId);
      if (!parentFamily) {
        throw new Error(
          `Stage ${experiment.researchId} references missing parent ${parentId}`,
        );
      }
      if (parentFamily !== family) {
        throw new Error(
          `Stage ${experiment.researchId} crosses hypothesis families`,
        );
      }
    }
  }
  return { experiments, familyByResearch };
};

export const buildCoreResearchStageIndex = async (rootDir: string) =>
  (await scanCoreResearchStages(rootDir)).experiments;

export const writeCoreResearchStageIndex = async (rootDir: string) => {
  const resolvedRoot = path.resolve(rootDir);
  const { experiments, familyByResearch } =
    await scanCoreResearchStages(resolvedRoot);
  const grouped = new Map<string, typeof experiments>();
  for (const experiment of experiments) {
    const family = familyByResearch.get(experiment.researchId);
    if (!family) {
      throw new Error(`Stage index lost family for ${experiment.researchId}`);
    }
    const bucket = grouped.get(family) ?? [];
    bucket.push(experiment);
    grouped.set(family, bucket);
  }
  const index: CoreResearchStageIndex = {
    schema: 'tradejs-core-research-stage-index/v1',
    generatedAt: new Date().toISOString(),
    families: [...grouped.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([family, experiments]) => ({ family, experiments })),
  };
  await writeJsonAtomic(path.join(resolvedRoot, 'index.json'), index);
  return index;
};
