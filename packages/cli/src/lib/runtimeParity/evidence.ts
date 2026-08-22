import type {
  RuntimeSignalEvaluationRecord,
  RuntimeTradeRecord,
  Signal,
} from '@tradejs/types';

export type RuntimeParityEvidenceContext = {
  userName: string;
  window: { start: number; end: number };
  strategy?: string;
  symbols: Set<string> | null;
};

type RuntimeEvidenceRange = {
  startTime: number;
  endTime: number;
};

export type RuntimeParityEvidenceAdapters = {
  loadRuntimeTrades(
    userName: string,
    range: RuntimeEvidenceRange,
  ): Promise<RuntimeTradeRecord[]>;
  loadRuntimeSignals(
    userName: string,
    range: RuntimeEvidenceRange,
  ): Promise<Signal[]>;
  loadRuntimeSignalEvaluations(
    userName: string,
    range: RuntimeEvidenceRange,
  ): Promise<RuntimeSignalEvaluationRecord[]>;
};

export type RuntimeParityEvidence = {
  runtimeTrades: RuntimeTradeRecord[];
  runtimeSignals: Signal[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
};

const matchesSelection = (
  context: RuntimeParityEvidenceContext,
  artifact: { strategy: string; symbol: string },
) =>
  (!context.strategy || artifact.strategy === context.strategy) &&
  (!context.symbols || context.symbols.has(artifact.symbol));

export const loadRuntimeParityEvidence = async (
  context: RuntimeParityEvidenceContext,
  adapters: RuntimeParityEvidenceAdapters,
): Promise<RuntimeParityEvidence> => {
  const range = {
    startTime: context.window.start,
    endTime: context.window.end,
  };
  const [allRuntimeTrades, allRuntimeSignals, allRuntimeSignalEvaluations] =
    await Promise.all([
      adapters.loadRuntimeTrades(context.userName, range),
      adapters.loadRuntimeSignals(context.userName, range),
      adapters.loadRuntimeSignalEvaluations(context.userName, range),
    ]);

  return {
    runtimeTrades: allRuntimeTrades.filter(
      (trade) =>
        trade.entryTimestamp >= context.window.start &&
        trade.entryTimestamp <= context.window.end &&
        matchesSelection(context, trade),
    ),
    runtimeSignals: allRuntimeSignals.filter(
      (signal) =>
        signal.timestamp >= context.window.start &&
        signal.timestamp <= context.window.end &&
        matchesSelection(context, signal),
    ),
    runtimeSignalEvaluations: allRuntimeSignalEvaluations.filter(
      (evaluation) =>
        evaluation.timestamp >= context.window.start &&
        evaluation.timestamp <= context.window.end &&
        matchesSelection(context, evaluation),
    ),
  };
};
