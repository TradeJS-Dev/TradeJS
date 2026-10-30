import type { AiPayload, ResearchEntryPolicy, Signal } from '@tradejs/types';
import {
  buildAiPayload,
  runAiPromptLocal,
  getDeterministicAiGateContext,
} from './ai';

export const RESEARCH_ENTRY_POLICY_CAPABILITIES = {
  directionSelection: true,
} as const;

const forbidden =
  /(?:^|\.)(?:__proto__|prototype|constructor|profit|pnl|outcome|tradeResult|backtestExecution|quality|deterministicQuality|approvalAllowedNow|timestamp|knownAt|source|coverage|points|rows|length)(?:\.|$)/i;

/** Preserve the canonical signal-time snapshot even when an AI adapter emits
 * only its strategy-specific fields. Both discovery and execution use this. */
export const buildResearchEntryPayload = (
  signal: Signal,
  payload: AiPayload = buildAiPayload(signal),
): AiPayload => {
  const additional =
    payload.additionalIndicators &&
    typeof payload.additionalIndicators === 'object'
      ? (payload.additionalIndicators as Record<string, unknown>)
      : {};
  const raw = signal.additionalIndicators?.baseContext;
  const adapted = additional.baseContext;
  return {
    ...payload,
    additionalIndicators: {
      ...additional,
      ...(signal.additionalIndicators?.jev &&
      typeof signal.additionalIndicators.jev === 'object'
        ? { jev: signal.additionalIndicators.jev }
        : {}),
      baseContext: {
        ...(raw && typeof raw === 'object' ? raw : {}),
        ...(adapted && typeof adapted === 'object' ? adapted : {}),
      },
    },
  };
};

export const parseResearchEntryPolicy = (
  value: unknown,
): ResearchEntryPolicy => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid research entry policy');
  const policy = value as ResearchEntryPolicy;
  if (
    policy.schema !== 'tradejs-research-entry-policy/v1' ||
    typeof policy.strategy !== 'string' ||
    !policy.strategy.trim() ||
    !['current-gate', 'rules'].includes(policy.mode) ||
    !Number.isInteger(policy.minQuality) ||
    policy.minQuality < 1 ||
    policy.minQuality > 5 ||
    !policy.rules ||
    typeof policy.rules !== 'object'
  )
    throw new Error('Invalid research entry policy contract');
  if (
    policy.directions !== undefined &&
    (!Array.isArray(policy.directions) ||
      policy.directions.length > 2 ||
      new Set(policy.directions).size !== policy.directions.length ||
      policy.directions.some((side) => !['LONG', 'SHORT'].includes(side)))
  )
    throw new Error('Invalid research policy directions');
  for (const side of ['LONG', 'SHORT'] as const) {
    const predicates = policy.rules[side];
    if (predicates === null) continue;
    if (!Array.isArray(predicates) || predicates.length > 4)
      throw new Error(
        'Research policy needs bounded rules for both directions',
      );
    for (const predicate of predicates) {
      if (
        !predicate ||
        typeof predicate.path !== 'string' ||
        !/^additionalIndicators\.[a-zA-Z0-9_.]+$/.test(predicate.path) ||
        forbidden.test(predicate.path) ||
        !['<=', '>=', '=='].includes(predicate.op) ||
        (predicate.op === '=='
          ? !['string', 'boolean'].includes(typeof predicate.value)
          : typeof predicate.value !== 'number' ||
            !Number.isFinite(predicate.value))
      )
        throw new Error(
          'Research policy contains an unsupported or non-causal predicate',
        );
    }
  }
  return policy;
};

export const matchesResearchEntryRules = (
  payload: AiPayload,
  predicates: NonNullable<ResearchEntryPolicy['rules']['LONG']>,
): boolean =>
  predicates.every((predicate) => {
    const value = predicate.path
      .split('.')
      .reduce<unknown>(
        (current, key) =>
          current != null &&
          typeof current === 'object' &&
          Object.hasOwn(current, key)
            ? Reflect.get(current, key)
            : undefined,
        payload,
      );
    if (value == null) return false;
    if (predicate.op === '==') return value === predicate.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    return predicate.op === '<='
      ? value <= predicate.value
      : value >= predicate.value;
  });

export const evaluateResearchEntryPolicy = async (
  policy: ResearchEntryPolicy,
  signal: Signal,
  onDecision?: (
    decision: import('@tradejs/types').ResearchEntryDecision,
  ) => void,
) => {
  if (signal.strategy !== policy.strategy)
    throw new Error('Research policy strategy mismatch');
  if (
    (policy.directions && !policy.directions.includes(signal.direction)) ||
    (policy.mode === 'rules' && policy.rules[signal.direction] === null)
  ) {
    onDecision?.({
      mode: policy.mode,
      allowed: false,
      reason: 'DIRECTION_BLOCKED',
    });
    return false;
  }
  if (policy.mode === 'current-gate') {
    const analysis = await runAiPromptLocal(signal);
    const allowed =
      analysis.direction === signal.direction &&
      typeof analysis.quality === 'number' &&
      analysis.quality >= policy.minQuality;
    onDecision?.({
      mode: policy.mode,
      allowed,
      quality: analysis.quality ?? null,
      reason: allowed ? 'CURRENT_GATE_APPROVED' : 'CURRENT_GATE_REJECTED',
    });
    return allowed;
  }
  const original = buildAiPayload(signal);
  const gateContext = getDeterministicAiGateContext(original);
  if (
    Array.isArray(gateContext?.structuralHardBlockReasons) &&
    gateContext.structuralHardBlockReasons.length
  ) {
    onDecision?.({
      mode: policy.mode,
      allowed: false,
      reason: 'STRUCTURAL_HARD_BLOCK',
    });
    return false;
  }
  const rules = policy.rules[signal.direction];
  const payload = buildResearchEntryPayload(signal, original);
  const allowed = rules !== null && matchesResearchEntryRules(payload, rules);
  onDecision?.({
    mode: policy.mode,
    allowed,
    reason: allowed ? 'RULES_APPROVED' : 'PREDICATE_REJECTED',
    predicates: rules?.map((rule) => {
      const value = rule.path
        .split('.')
        .reduce<unknown>(
          (current, key) =>
            current &&
            typeof current === 'object' &&
            Object.hasOwn(current, key)
              ? Reflect.get(current, key)
              : undefined,
          payload,
        );
      return {
        path: rule.path,
        actual:
          (typeof value === 'number' && Number.isFinite(value)) ||
          typeof value === 'string' ||
          typeof value === 'boolean'
            ? value
            : null,
        passed: matchesResearchEntryRules(payload, [rule]),
      };
    }),
  });
  return allowed;
};
