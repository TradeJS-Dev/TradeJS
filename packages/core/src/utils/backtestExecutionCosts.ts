import type {
  BacktestExecutionCosts,
  ExecutionCostModel,
} from '@tradejs/types';

export const LEGACY_EXECUTION_CONFIG_FIELDS = [
  'MAKER_FEE_RATE',
  'TAKER_FEE_RATE',
  'FUNDING_ENABLED',
  'SLIPPAGE_BASE_BPS',
  'SLIPPAGE_SPREAD_MULTIPLIER',
  'SLIPPAGE_MARKET_IMPACT_BPS',
  'SLIPPAGE_DELAY_RISK_MULTIPLIER',
  'EXECUTION_COSTS_CACHE_ONLY',
] as const;

export const assertStrategyExecutionIsolation = (
  config: Record<string, unknown>,
) => {
  for (const key of LEGACY_EXECUTION_CONFIG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      throw new Error(
        `${key} is an execution setting: use executionCosts separately; strategy estimates use RISK_FEE_RATE and RISK_SLIPPAGE_BPS`,
      );
    }
  }
};

/** Validate JSON at ingestion, including explicit zero rates. Never coerce null. */
export const parseBacktestExecutionCosts = (
  input: unknown,
): BacktestExecutionCosts => {
  const record = (value: unknown, label: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
  };
  const root = record(input, 'executionCosts');
  const fees = record(root.fees, 'executionCosts.fees');
  const slippage = record(root.slippage, 'executionCosts.slippage');
  const funding = record(root.funding, 'executionCosts.funding');
  const number = (value: unknown, label: string, min = 0, max = Infinity) => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value >= max
    )
      throw new Error(`${label} must be a finite number in [${min}, ${max})`);
    return value;
  };
  if (typeof funding.enabled !== 'boolean')
    throw new Error('executionCosts.funding.enabled must be boolean');
  for (const [value, keys, label] of [
    [root, ['fees', 'slippage', 'funding'], 'executionCosts'],
    [fees, ['makerRate', 'takerRate'], 'fees'],
    [
      slippage,
      ['baseBps', 'spreadMultiplier', 'marketImpactBps', 'delayRiskMultiplier'],
      'slippage',
    ],
    [funding, ['enabled'], 'funding'],
  ] as const) {
    for (const key of Object.keys(value))
      if (!(keys as readonly string[]).includes(key))
        throw new Error(`Unknown ${label}.${key}`);
  }
  return {
    fees: {
      makerRate: number(fees.makerRate, 'makerRate', -1, 1),
      takerRate: number(fees.takerRate, 'takerRate', -1, 1),
    },
    slippage: {
      baseBps: number(slippage.baseBps, 'baseBps', 0, 10000),
      spreadMultiplier: number(slippage.spreadMultiplier, 'spreadMultiplier'),
      marketImpactBps: number(
        slippage.marketImpactBps,
        'marketImpactBps',
        0,
        10000,
      ),
      delayRiskMultiplier: number(
        slippage.delayRiskMultiplier,
        'delayRiskMultiplier',
      ),
    },
    funding: { enabled: funding.enabled },
  };
};

/** Stable economic fields only: timestamps and provenance are separate evidence. */
export const executionCostsFromModel = (
  model: ExecutionCostModel,
): BacktestExecutionCosts =>
  parseBacktestExecutionCosts({
    fees: { makerRate: model.fees.makerRate, takerRate: model.fees.takerRate },
    slippage: {
      baseBps: model.slippage.baseBps,
      spreadMultiplier: model.slippage.spreadMultiplier,
      marketImpactBps: model.slippage.marketImpactBps,
      delayRiskMultiplier: model.slippage.delayRiskMultiplier,
    },
    funding: { enabled: model.funding.enabled },
  });
