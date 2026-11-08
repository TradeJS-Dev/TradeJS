import type { KlineChartItem, Signal } from '@tradejs/types';

export type ReplayDecisionTraceTarget = {
  strategy: string;
  symbol: string;
  signalTimestamp: number;
};

type ReplayDecisionOutcome = {
  stage:
    | 'not_evaluated'
    | 'core'
    | 'evaluation'
    | 'entry_delay'
    | 'gate'
    | 'risk'
    | 'execution';
  reason: string;
  direction?: Signal['direction'];
  orderStatus?: Signal['orderStatus'];
  pattern?: string;
  patternCode?: string;
};

export type ReplayDecisionTrace = ReplayDecisionTraceTarget & {
  candle?: Pick<
    KlineChartItem,
    'timestamp' | 'open' | 'high' | 'low' | 'close' | 'volume'
  >;
  decision: ReplayDecisionOutcome;
  followUp?: ReplayDecisionOutcome & { candleTimestamp: number };
};

export const replayDecisionTraceKey = ({
  strategy,
  symbol,
  signalTimestamp,
}: ReplayDecisionTraceTarget) =>
  JSON.stringify([strategy, symbol, signalTimestamp]);

const describeOutcome = (
  result: Signal | string | undefined,
): ReplayDecisionOutcome => {
  if (typeof result === 'string') {
    return {
      stage: result.startsWith('BACKTEST_ENTRY_DELAY_')
        ? 'entry_delay'
        : /(?:NO_PATTERN|POSITION_EXISTS)$/.test(result)
          ? 'core'
          : 'evaluation',
      reason: result,
    };
  }
  if (!result) return { stage: 'evaluation', reason: 'NO_SIGNAL' };

  const reason =
    result.orderSkipReason ||
    result.orderFailureReason ||
    result.orderStatus ||
    'SIGNAL';
  const patternContext = result.additionalIndicators?.tradingPatternsContext as
    | { selectedPattern?: unknown; sourceCode?: unknown }
    | undefined;
  return {
    stage:
      result.riskDecision?.status === 'rejected' ||
      /^ENTRY_(?:RR_BELOW|RISK_EXCEEDS)/.test(reason)
        ? 'risk'
        : /^(?:AI_|ML_|HOOK_BEFORE_ENTRY_GATE|RESEARCH_ENTRY_POLICY)/.test(
              reason,
            )
          ? 'gate'
          : result.orderStatus
            ? 'execution'
            : 'evaluation',
    reason,
    direction: result.direction,
    orderStatus: result.orderStatus,
    ...(typeof patternContext?.selectedPattern === 'string'
      ? { pattern: patternContext.selectedPattern }
      : {}),
    ...(typeof patternContext?.sourceCode === 'string'
      ? { patternCode: patternContext.sourceCode }
      : {}),
  };
};

export const createReplayDecisionTrace = (
  targets: ReplayDecisionTraceTarget[] = [],
) => {
  const traces = new Map<string, ReplayDecisionTrace>();
  const symbols = new Set(targets.map(({ symbol }) => symbol));
  for (const target of targets) {
    traces.set(replayDecisionTraceKey(target), {
      ...target,
      decision: {
        stage: 'not_evaluated',
        reason: 'REPLAY_CANDLE_NOT_EVALUATED',
      },
    });
  }

  const record = (
    strategy: string,
    symbol: string,
    candle: KlineChartItem,
    result?: Signal | string,
    notEvaluatedReason?: string,
  ) => {
    if (!symbols.has(symbol)) return;
    const { timestamp, open, high, low, close, volume } = candle;
    const trace = traces.get(
      replayDecisionTraceKey({ strategy, symbol, signalTimestamp: timestamp }),
    );
    if (
      result &&
      typeof result !== 'string' &&
      result.timestamp !== timestamp
    ) {
      const original = traces.get(
        replayDecisionTraceKey({
          strategy,
          symbol,
          signalTimestamp: result.timestamp,
        }),
      );
      if (original)
        original.followUp = {
          ...describeOutcome(result),
          candleTimestamp: timestamp,
        };
      notEvaluatedReason = 'REPLAY_PROCESSED_DELAYED_ENTRY';
    }
    if (!trace) return;
    trace.candle = { timestamp, open, high, low, close, volume };
    trace.decision = notEvaluatedReason
      ? { stage: 'not_evaluated', reason: notEvaluatedReason }
      : describeOutcome(result);
  };

  return { record, values: () => [...traces.values()] };
};
