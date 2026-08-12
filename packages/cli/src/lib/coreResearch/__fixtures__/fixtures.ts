/* istanbul ignore file -- deterministic values shared by public-seam tests */
import type { AiDatasetRow, Direction } from '@tradejs/types';
import { sha256Json } from '../io';
import type {
  CoreResearchSpec,
  CoreResearchTrade,
  CoreResearchVariant,
} from '../types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const START = Date.UTC(2026, 0, 1);
export const END = START + 10 * DAY_MS;

export const makeVariant = (
  overrides: Partial<CoreResearchVariant> &
    Pick<CoreResearchVariant, 'id' | 'role'>,
): CoreResearchVariant => {
  const resolvedConfig = overrides.resolvedConfig ?? {
    MODE: overrides.id,
    MAX_LOSS_VALUE: 10,
  };
  return {
    label: overrides.id,
    configName: `FixtureStrategy:${overrides.id}`,
    files: [`${overrides.id}.jsonl`],
    ...overrides,
    resolvedConfig,
    configSha256: overrides.configSha256 ?? sha256Json(resolvedConfig),
  };
};

export const makeSpec = (
  overrides: Partial<CoreResearchSpec> = {},
): CoreResearchSpec => {
  const symbols = overrides.universe?.symbols ?? ['AAAUSDT', 'BBBUSDT'];
  return {
    schema: 'tradejs-core-research/v1',
    researchId: 'fixture-research',
    stage: 'screen',
    strategy: 'FixtureStrategy',
    createdAt: '2026-01-01T00:00:00.000Z',
    hypothesis: {
      family: 'fixture-family',
      claim: 'Candidate improves a preregistered metric.',
      mechanism: 'A causal fixture mechanism.',
      target: 'ALL',
    },
    universe: { symbols, sha256: sha256Json(symbols) },
    window: { start: START, end: END, terminalDays: [5], folds: 2 },
    execution: {
      connector: 'Test',
      interval: '15',
      maxLossValue: 10,
      feeRate: 0.001,
      slippageBps: 10,
      entryDelayBars: 1,
    },
    variants: [
      makeVariant({ id: 'control', role: 'control' }),
      makeVariant({ id: 'candidate', role: 'candidate' }),
    ],
    selection: {
      minimumTrades: 1,
      minimumCadencePerDay: 0,
      targetRules: [],
      aggregateRules: [],
      nonTargetRules: [],
    },
    robustness: {
      bootstrapIterations: 100,
      confidenceLevel: 0.9,
      clusterDays: 1,
      minimumFoldTrades: 0,
      costStressBps: [],
    },
    artifacts: {
      rootDir: 'data/research/core',
      ledgerPath: 'data/research/core/trials.jsonl',
    },
    ...overrides,
  };
};

export const makeTrade = (
  overrides: Partial<CoreResearchTrade> = {},
): CoreResearchTrade => ({
  sourceFile: 'fixture.jsonl',
  sourceLine: 1,
  sourceSha256: 'a'.repeat(64),
  runId: 'fixture-run',
  configId: 'fixture-config',
  signalId: 'signal-1',
  setupIdentity: 'setup-1',
  setupIdentitySource: 'research.setupIdentity',
  strategy: 'FixtureStrategy',
  symbol: 'AAAUSDT',
  direction: 'LONG',
  signalTimestamp: START,
  entryTimestamp: START + 1_000,
  exitTimestamp: START + DAY_MS / 2,
  entryPrice: 100,
  exitPrice: 110,
  qty: 1,
  netProfit: 10,
  grossProfit: 12,
  totalFee: 2,
  totalSlippageCost: 0,
  exitReason: 'take_profit',
  regime: {
    trend: 'bull',
    volatility: 'normal',
    breadth: 'risk_on',
    derivatives: 'neutral',
    key: 'bull|normal|risk_on|neutral',
  },
  ...overrides,
});

export const makeDatasetRow = (
  params: {
    signalId?: string;
    setupIdentity?: string;
    symbol?: string;
    direction?: Direction;
    timestamp?: number;
    netProfit?: number;
    runId?: string;
    strategyContext?: Record<string, unknown>;
    includeTradeResult?: boolean;
  } = {},
): AiDatasetRow => {
  const direction = params.direction ?? 'LONG';
  const timestamp = params.timestamp ?? START;
  const netProfit = params.netProfit ?? 10;
  const signalId = params.signalId ?? 'signal-1';
  const symbol = params.symbol ?? 'AAAUSDT';
  return {
    signalId,
    strategyName: 'FixtureStrategy',
    symbol,
    direction,
    timestamp,
    profit: netProfit,
    configId: 'fixture-config',
    backtestRunId: params.runId ?? 'fixture-run',
    research: params.setupIdentity
      ? {
          schema: 'tradejs-core-research-row/v1',
          setupIdentity: params.setupIdentity,
          setupIdentitySource: 'strategy-context',
        }
      : undefined,
    payload: {
      signal: {
        symbol,
        signalId,
        interval: '15',
        direction,
        timestamp,
        strategy: 'FixtureStrategy',
        prices: {
          currentPrice: 100,
          takeProfitPrice: 110,
          stopLossPrice: 95,
        },
      },
      figures: {},
      indicators: {},
      additionalIndicators: {
        ...params.strategyContext,
        baseContext: {
          regime: {
            trend: { bias: 'bull' },
            volatility: { state: 'normal' },
          },
          relative: { btcAltRegime: { regime: 'risk_on' } },
          derivatives: { summary: { pressure: 'neutral' } },
        },
      },
    },
    tradeResult:
      params.includeTradeResult === false
        ? undefined
        : {
            signalId,
            direction,
            qty: 1,
            closedQty: 1,
            entryTimestamp: timestamp + 1_000,
            exitTimestamp: timestamp + DAY_MS / 2,
            exitReason: netProfit > 0 ? 'take_profit' : 'stop_loss',
            requestedEntryPrice: 100,
            entryPrice: 100,
            requestedExitPrice: netProfit > 0 ? 110 : 90,
            exitPrice: netProfit > 0 ? 110 : 90,
            grossProfit: netProfit + 2,
            netProfit,
            openFee: 1,
            closeFee: 1,
            fundingFee: null,
            totalFee: 2,
            entrySlippagePrice: 0,
            entrySlippageBps: 0,
            entryBaseSlippageBps: 0,
            entrySpreadBps: 0,
            entrySpreadSlippageBps: 0,
            entryMarketImpactBps: 0,
            entryDelayRiskBps: null,
            entrySlippageCost: 0,
            exitSlippagePrice: 0,
            exitSlippageBps: 0,
            exitBaseSlippageBps: 0,
            exitSpreadBps: 0,
            exitSpreadSlippageBps: 0,
            exitMarketImpactBps: 0,
            exitDelayRiskBps: null,
            exitSlippageCost: 0,
            totalSlippageCost: 0,
          },
  };
};
