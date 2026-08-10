import type {
  AiPayload,
  Signal,
  SignalAnalysis,
  StrategyAiAdapter,
} from '@tradejs/types';

export const AI_GATE_REBUILD_OBSERVATION_REASON =
  'ai_gate_rebuild_2026_08_10_observation_only';

type GateAnalysis = Partial<SignalAnalysis> & {
  approved?: boolean;
  gateDecision?: 'approved' | 'rejected';
  rejectReason?: string;
};

type LocalGateParams = {
  signal: Signal;
  payload: AiPayload;
  analysis: Partial<SignalAnalysis>;
};

export type RebuiltAiGateRule = {
  id: string;
  approves: (params: Pick<LocalGateParams, 'signal' | 'payload'>) => boolean;
};

const normalizeQuality = (quality: unknown) => {
  const parsed = Number(quality);
  return Number.isFinite(parsed) ? Math.round(parsed) : 3;
};

const getLegacyAnalysis = (
  adapter: StrategyAiAdapter,
  params: LocalGateParams,
) =>
  (adapter.postProcessLocalAnalysis?.(params) ??
    params.analysis) as GateAnalysis;

const buildRebuildReason = (ruleId: string, approved: boolean) =>
  `ai_gate_rebuild_2026_08_10; rule=${ruleId}; decision=${
    approved ? 'approved' : 'rejected'
  }`;

const applyRebuiltDecision = (
  legacyAnalysis: GateAnalysis,
  params: LocalGateParams,
  ruleId: string,
  approved: boolean,
): GateAnalysis => {
  const reason = buildRebuildReason(ruleId, approved);

  if (approved) {
    return {
      ...legacyAnalysis,
      direction: params.signal.direction,
      quality: 4,
      approved: true,
      needRetest: false,
      retestPrice: null,
      takeProfitPrice: params.signal.prices.takeProfitPrice,
      stopLossPrice: params.signal.prices.stopLossPrice,
      gateDecision: 'approved',
      qualityReason: reason,
      rejectReason: undefined,
    };
  }

  return {
    ...legacyAnalysis,
    direction: null,
    quality: Math.min(3, normalizeQuality(legacyAnalysis.quality)),
    approved: false,
    needRetest: true,
    takeProfitPrice: null,
    stopLossPrice: null,
    gateDecision: 'rejected',
    qualityReason: reason,
    rejectReason: reason,
  };
};

export const makeObservationOnlyAiAdapter = (
  adapter: StrategyAiAdapter = {},
): StrategyAiAdapter => ({
  ...adapter,
  postProcessLocalAnalysis: (params) => {
    const legacyAnalysis = getLegacyAnalysis(adapter, params);
    const legacyQuality = normalizeQuality(legacyAnalysis.quality);
    const legacyApproved =
      legacyAnalysis.approved === true ||
      (legacyAnalysis.direction != null && legacyQuality >= 4);
    const observationReason = [
      AI_GATE_REBUILD_OBSERVATION_REASON,
      `legacyApproved=${String(legacyApproved)}`,
      `legacyQuality=${String(legacyQuality)}`,
      `legacyDirection=${String(legacyAnalysis.direction ?? 'null')}`,
    ].join('; ');

    return {
      ...legacyAnalysis,
      direction: null,
      quality: Math.min(3, legacyQuality),
      approved: false,
      needRetest: true,
      takeProfitPrice: null,
      stopLossPrice: null,
      gateDecision: 'rejected',
      qualityReason: observationReason,
      rejectReason: observationReason,
    } as GateAnalysis;
  },
});

export const makePassThroughAiAdapter = (
  adapter: StrategyAiAdapter = {},
): StrategyAiAdapter => ({
  ...adapter,
  postProcessLocalAnalysis: (params) =>
    applyRebuiltDecision(
      getLegacyAnalysis(adapter, params),
      params,
      'pass_through',
      true,
    ),
});

export const makeRuleBasedAiAdapter = (
  adapter: StrategyAiAdapter = {},
  rule: RebuiltAiGateRule,
): StrategyAiAdapter => ({
  ...adapter,
  postProcessLocalAnalysis: (params) =>
    applyRebuiltDecision(
      getLegacyAnalysis(adapter, params),
      params,
      rule.id,
      rule.approves(params),
    ),
});
