import type { Signal } from '@tradejs/types';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const findSetupKey = (value: unknown, depth = 0): string | null => {
  if (depth > 5) return null;
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ['setupIdentity', 'setupId', 'patternId', 'candidateId']) {
    const candidate = record[key];
    if (
      (typeof candidate === 'string' && candidate.trim()) ||
      (typeof candidate === 'number' && Number.isFinite(candidate))
    ) {
      return `${key}:${String(candidate)}`;
    }
  }
  for (const [key, nested] of Object.entries(record)) {
    if (
      /context|signal|setup|pattern|candidate|strategy/i.test(key) &&
      nested != null
    ) {
      const found = findSetupKey(nested, depth + 1);
      if (found) return found;
    }
  }
  return null;
};

export const resolveCoreResearchSetupIdentity = (signal: Signal) => {
  const strategyKey = findSetupKey(signal.additionalIndicators);
  return strategyKey
    ? {
        setupIdentity: `${signal.strategy}|${signal.symbol}|${signal.direction}|${strategyKey}`,
        setupIdentitySource: 'strategy-context' as const,
      }
    : {
        setupIdentity: `${signal.strategy}|${signal.symbol}|${signal.direction}|${signal.timestamp}`,
        setupIdentitySource: 'signal-time-fallback' as const,
      };
};
