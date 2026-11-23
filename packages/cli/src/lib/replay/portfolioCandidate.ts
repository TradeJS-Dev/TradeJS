import type {
  PortfolioEntryCandidate,
  StrategyCreatorParams,
} from '@tradejs/types';

export type PortfolioCapture = Parameters<
  NonNullable<StrategyCreatorParams['selectReplayEntry']>
>[0];

export function toPortfolioCandidate(
  { signal, decision, reason, approved }: PortfolioCapture,
  strategy: string,
  symbol: string,
): PortfolioEntryCandidate {
  const analysis = signal.aiAnalysis;
  return {
    id: signal.signalId,
    strategy,
    symbol,
    direction: decision.entryContext.direction,
    stop: decision.orderPlan.stopLossPrice,
    targets: decision.orderPlan.takeProfits.map(({ price }) => price),
    gate: {
      approved,
      reason,
      rawQuality: analysis?.quality ?? null,
      explicitHardBlock:
        Boolean(
          analysis &&
            'structuralHardBlockReasons' in analysis &&
            Array.isArray(analysis.structuralHardBlockReasons) &&
            analysis.structuralHardBlockReasons.length,
        ) ||
        /\bhard[- _]?block\b/i.test(
          JSON.stringify(analysis?.qualityReason ?? ''),
        ),
    },
  };
}
