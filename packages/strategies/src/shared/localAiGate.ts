import type {
  AiPayload,
  Signal,
  SignalAnalysis,
  StrategyAiAdapter,
} from '@tradejs/types';

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

export type StrategyLocalAiGateRule = {
  id: string;
  approves: (params: Pick<LocalGateParams, 'signal' | 'payload'>) => boolean;
};

const normalizeQuality = (quality: unknown) => {
  const parsed = Number(quality);
  return Number.isFinite(parsed) ? Math.round(parsed) : 3;
};

const getPriorLocalAnalysis = (
  adapter: StrategyAiAdapter,
  params: LocalGateParams,
) =>
  (adapter.postProcessLocalAnalysis?.(params) ??
    params.analysis) as GateAnalysis;

const buildDecisionReason = (ruleId: string, approved: boolean) =>
  `ai_gate_rebuild_2026_08_10; rule=${ruleId}; decision=${
    approved ? 'approved' : 'rejected'
  }`;

const applyRuleDecision = (
  priorAnalysis: GateAnalysis,
  params: LocalGateParams,
  ruleId: string,
  approved: boolean,
): GateAnalysis => {
  const reason = buildDecisionReason(ruleId, approved);

  if (approved) {
    return {
      ...priorAnalysis,
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
    ...priorAnalysis,
    direction: null,
    quality: Math.min(3, normalizeQuality(priorAnalysis.quality)),
    approved: false,
    needRetest: true,
    takeProfitPrice: null,
    stopLossPrice: null,
    gateDecision: 'rejected',
    qualityReason: reason,
    rejectReason: reason,
  };
};

export const getAiPayloadValue = (payload: AiPayload, path: string): unknown =>
  path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, payload);

export const getAiPayloadNumber = (
  payload: AiPayload,
  path: string,
): number | null => {
  const rawValue = getAiPayloadValue(payload, path);
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? rawValue : null;
  }
  if (typeof rawValue !== 'string' || !rawValue.trim()) return null;

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getAiPayloadString = (
  payload: AiPayload,
  path: string,
): string | null => {
  const value = getAiPayloadValue(payload, path);
  return typeof value === 'string' ? value : null;
};

export const withStrategyLocalAiGate = (
  adapter: StrategyAiAdapter,
  rule: StrategyLocalAiGateRule,
): StrategyAiAdapter => ({
  ...adapter,
  postProcessLocalAnalysis: (params) =>
    applyRuleDecision(
      getPriorLocalAnalysis(adapter, params),
      params,
      rule.id,
      rule.approves(params),
    ),
});
