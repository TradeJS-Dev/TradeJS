import type { StrategyResearchSpec } from './types';
import { validateCoreResearchSpec, sha256Json } from '../coreResearch/io';
import type { CoreResearchSpec } from '../coreResearch/types';
import { classifyAiPocketFeaturePath } from '../aiPocketSearch';

export const createStrategyResearchSpec = (
  core: CoreResearchSpec,
): StrategyResearchSpec => ({
  schema: 'tradejs-strategy-research/v1',
  core: {
    ...core,
    variants: core.variants.map((variant) => {
      const resolvedConfig = {
        ...variant.resolvedConfig,
        ENV: 'BACKTEST',
        INTERVAL: core.execution.interval,
        MAKE_ORDERS: true,
        CLOSE_OPPOSITE_POSITIONS: false,
        BACKTEST_PRICE_MODE: 'open',
        BACKTEST_ENTRY_DELAY_BARS: core.execution.entryDelayBars ?? 1,
      };
      return {
        ...variant,
        command: undefined,
        files: variant.command?.length ? [] : variant.files,
        resolvedConfig,
        configSha256: sha256Json(resolvedConfig),
      };
    }),
  },
  history: 'retrospective',
  priorResearchIds: [],
  testSince: 0,
  minQuality: Number(
    core.variants.find((variant) => variant.role === 'control')?.resolvedConfig
      .MIN_AI_QUALITY ?? 4,
  ),
  budget: {
    maxVariants: 12,
    maxRows: 200_000,
    maxCombinations: 10_000,
    maxMinutes: 240,
    parallel: 2,
    minimumFreeMemoryMb: 1024,
  },
  selection: {
    minimumEvents: 50,
    minimumProfitFactor: 1.1,
    minimumCadencePerDay: 0.075,
    maximumDrawdown: 100,
    maximumLossStreak: 6,
    maximumEventShare: 0.15,
    maximumSymbolShare: 0.25,
    extraRoundTripBps: 20,
  },
  diagnostics: {
    samplePerSideAndOutcome: 3,
    horizons: [1, 4, 16],
    requiredPaths: ['regime.trend.bias', 'regime.volatility.state'],
    minimumContextCoverage: 0.95,
  },
  portfolio: { maxConcurrentPositions: 5, maxOpenRisk: 50 },
});

export const validateStrategyResearchSpec = (
  value: unknown,
): StrategyResearchSpec => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Research spec must be an object');
  const spec = value as StrategyResearchSpec;
  if (spec.schema !== 'tradejs-strategy-research/v1')
    throw new Error('Unsupported strategy research schema');
  if (!spec.core || !Array.isArray(spec.core.variants))
    throw new Error('A frozen core spec is required');
  if (!spec.core.variants.length)
    throw new Error('At least one control core is required');
  // The workflow owns native command construction; an empty file list means
  // execute this configuration, rather than an incomplete core artifact input.
  validateCoreResearchSpec({
    ...spec.core,
    variants: (spec.core.variants.length === 1
      ? [
          spec.core.variants[0],
          {
            ...spec.core.variants[0],
            id: 'validation-candidate',
            role: 'candidate' as const,
          },
        ]
      : spec.core.variants
    ).map((variant) => ({
      ...variant,
      files: variant.files?.length ? variant.files : ['native-export.jsonl'],
    })),
  });
  const { core } = spec;
  if (
    !/^[A-Za-z][A-Za-z0-9]*$/.test(core.strategy) ||
    core.researchId.length > 90 ||
    core.variants.some((variant) => variant.id.length > 40)
  )
    throw new Error(
      'Research strategy/id is not suitable for bounded artifact paths',
    );
  if (
    !['retrospective', 'unopened'].includes(spec.history) ||
    !Number.isSafeInteger(spec.testSince) ||
    (spec.testSince !== 0 && spec.testSince < core.window.start) ||
    (!spec.frozenFrom && spec.testSince === core.window.start) ||
    spec.testSince >= core.window.end
  )
    throw new Error(
      'Specify history exposure and a common chronological testSince inside the window',
    );
  if (
    !Array.isArray(spec.priorResearchIds) ||
    spec.priorResearchIds.some(
      (id) => !/^[a-z0-9][a-z0-9._-]{2,120}$/.test(id),
    ) ||
    spec.priorResearchIds.includes(core.researchId)
  )
    throw new Error('Invalid priorResearchIds');
  if (
    core.universe.symbols.some(
      (symbol) => typeof symbol !== 'string' || !/^[A-Z0-9]+USDT$/.test(symbol),
    )
  )
    throw new Error('Strategy research requires USDT contracts only');
  const positive = (
    number: unknown,
    name: string,
    max = Number.MAX_SAFE_INTEGER,
  ) => {
    if (
      !Number.isSafeInteger(number) ||
      Number(number) < 1 ||
      Number(number) > max
    )
      throw new Error(`Invalid research budget/criterion: ${name}`);
  };
  if (!spec.budget || !spec.selection || !spec.diagnostics)
    throw new Error('Missing research budgets or criteria');
  positive(spec.budget.maxVariants, 'maxVariants', 12);
  if (
    !Number.isInteger(spec.minQuality) ||
    spec.minQuality < 1 ||
    spec.minQuality > 5
  )
    throw new Error('minQuality must be 1 through 5');
  positive(spec.budget.maxRows, 'maxRows', 1_000_000);
  positive(spec.budget.maxCombinations, 'maxCombinations', 60_000);
  const discoverySearches =
    2 *
    spec.core.variants.reduce(
      (count, variant) => count + (variant.resolvedConfig.JEV ? 2 : 1),
      0,
    );
  if (spec.budget.maxCombinations < discoverySearches)
    throw new Error(
      'maxCombinations must cover every direction and Jev search arm',
    );
  positive(spec.budget.maxMinutes, 'maxMinutes', 1440);
  positive(spec.budget.parallel, 'parallel', 4);
  positive(spec.budget.minimumFreeMemoryMb, 'minimumFreeMemoryMb');
  if (!spec.portfolio)
    throw new Error('Explicit portfolio capacity is required');
  positive(spec.portfolio.maxConcurrentPositions, 'maxConcurrentPositions');
  positive(spec.portfolio.maxOpenRisk, 'maxOpenRisk');
  if (
    spec.frozenFrom != null &&
    !/^[a-z0-9][a-z0-9._-]{2,120}$/.test(spec.frozenFrom)
  )
    throw new Error('Invalid frozenFrom');
  if (
    core.variants.filter((variant) => variant.role === 'candidate').length >
    spec.budget.maxVariants
  )
    throw new Error('Core variants exceed the preregistered trial budget');
  for (const variant of core.variants) {
    const checkSecretFree = (value: unknown): void => {
      if (value && typeof value === 'object')
        for (const [key, entry] of Object.entries(value)) {
          if (
            /api.?key|password|secret|credential|access.?token|refresh.?token|authorization/i.test(
              key,
            ) &&
            entry != null &&
            entry !== ''
          )
            throw new Error(
              'Research configs must not contain credentials; use Account settings',
            );
          checkSecretFree(entry);
        }
    };
    checkSecretFree(variant.resolvedConfig);
    if (variant.command?.length)
      throw new Error(
        'research:strategy builds native commands; arbitrary command[] is not accepted',
      );
    if (variant.resolvedConfig.RESEARCH_ENTRY_POLICY != null)
      throw new Error('Raw core variants cannot contain a research gate');
    if (
      Number(variant.resolvedConfig.MAX_LOSS_VALUE) !==
        core.execution.maxLossValue ||
      core.execution.maxLossValue !== 10
    )
      throw new Error(
        'Research risk must be explicitly frozen at MAX_LOSS_VALUE=10',
      );
  }
  positive(spec.selection.minimumEvents, 'minimumEvents');
  positive(spec.selection.maximumLossStreak, 'maximumLossStreak');
  for (const key of [
    'minimumProfitFactor',
    'minimumCadencePerDay',
    'maximumDrawdown',
    'extraRoundTripBps',
  ] as const)
    if (
      typeof spec.selection[key] !== 'number' ||
      !Number.isFinite(spec.selection[key]) ||
      spec.selection[key] < 0
    )
      throw new Error(`Invalid selection.${key}`);
  if (
    spec.selection.minimumEvents < 25 ||
    spec.selection.minimumProfitFactor < 1 ||
    spec.selection.extraRoundTripBps <= 0
  )
    throw new Error(
      'Acceptance requires independent support, PF >= 1 and a positive cost stress',
    );
  for (const fraction of [
    spec.selection.maximumEventShare,
    spec.selection.maximumSymbolShare,
    spec.diagnostics.minimumContextCoverage,
  ])
    if (
      typeof fraction !== 'number' ||
      !Number.isFinite(fraction) ||
      fraction <= 0 ||
      fraction > 1
    )
      throw new Error('Invalid coverage/concentration fraction');
  positive(
    spec.diagnostics.samplePerSideAndOutcome,
    'samplePerSideAndOutcome',
    20,
  );
  if (
    !Array.isArray(spec.diagnostics.horizons) ||
    !spec.diagnostics.horizons.length ||
    spec.diagnostics.horizons.some(
      (horizon) => !Number.isInteger(horizon) || horizon < 1 || horizon > 96,
    )
  )
    throw new Error('Invalid event horizons');
  if (
    !Array.isArray(spec.diagnostics.requiredPaths) ||
    !spec.diagnostics.requiredPaths.length ||
    spec.diagnostics.requiredPaths.some(
      (path) =>
        !/^[a-zA-Z0-9_.]+$/.test(path) ||
        classifyAiPocketFeaturePath([
          'additionalIndicators',
          'baseContext',
          ...path.split('.'),
        ]) !== 'eligible',
    )
  )
    throw new Error('Required context paths must be causal market features');
  return spec;
};

export const policyVariant = (
  spec: StrategyResearchSpec,
  coreId: string,
  policy: import('@tradejs/types').ResearchEntryPolicy,
  id: string,
  jev?: 'enabled' | 'disabled',
) => {
  const core = spec.core.variants.find((variant) => variant.id === coreId);
  if (!core) throw new Error(`Unknown core ${coreId}`);
  const resolvedConfig = {
    ...core.resolvedConfig,
    RESEARCH_ENTRY_POLICY: policy,
  };
  if (jev === 'disabled') {
    delete (resolvedConfig as Record<string, unknown>).JEV;
    if (
      Object.values(policy.rules).some((rules) =>
        rules?.some((rule) => /jev|assessment/i.test(rule.path)),
      )
    )
      throw new Error('A no-Jev policy cannot depend on Jev assessments');
  }
  return {
    ...core,
    id,
    files: [],
    runId: undefined,
    command: undefined,
    resolvedConfig,
    configSha256: sha256Json(resolvedConfig),
  };
};
